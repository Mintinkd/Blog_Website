import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/**
 * 管理端抓取管线（#33 / #34 / ADR 0003）
 *
 * Worker 只负责安全取回 HTML；本模块在管理员浏览器里把 HTML 提取成
 * 标题 + Markdown。原始 HTML 仅在惰性 DOMParser 文档中解析，绝不注入
 * 管理页 DOM。a/img/iframe/embed/object 地址按 final URL（或页面 <base>）
 * 绝对化，非白名单协议（javascript:/data:/vbscript:）就地剥除；嵌入内容
 * 安全时降级成链接，否则整体丢弃。提取默认走 Readability，无正文时回退
 * <body>；管理员可用手动 CSS selector 覆盖提取范围（本地重跑，不重新
 * 请求源站）。字节解码按 BOM → Content-Type → <meta charset> 嗅探，
 * 未知字符集回退 UTF-8 并给出警告。
 */

export interface ScrapeImageStats {
  /** 正文中的 <img> 总数 */
  total: number;
  /** src 缺失或协议不在白名单（草稿里不会渲染） */
  unresolved: number;
}

export type ScrapeWarning =
  "no_article" | "readability_failed" | "convert_failed" | "charset_fallback";

export interface ScrapeDraft {
  title: string;
  summary: string;
  /** 仅来自 og:image；缺失 / 非 http(s) 时留空 */
  coverImage: string;
  /** 只包含站点已有标签，未匹配的关键词直接丢弃 */
  tags: string[];
  /** 始终为空：slug 由现有创建接口生成并去重 */
  slug: string;
  /** 默认分类 id（未分类） */
  categoryId: number;
  status: "draft";
  markdown: string;
  /** 正文字数：CJK 逐字 + 拉丁文逐词，不含来源脚注 */
  wordCount: number;
  warnings: ScrapeWarning[];
  images: ScrapeImageStats;
}

export interface ScrapeOptions {
  /**
   * 手动 CSS selector。命中时跳过 Readability，按文档顺序拼接所有命中
   * 子树的 outerHTML；未命中或语法无效抛 ScrapeSelectorError。
   */
  selector?: string;
  /**
   * 站点已有标签名。抓取只保留精确命中的标签，不创建新标签；
   * 不传或为空时草稿不带标签。
   */
  existingTags?: readonly string[];
  /** 抓取日期，用于来源脚注；测试可注入固定日期 */
  scrapedAt?: Date;
}

export type ScrapeSelectorErrorCode = "selector_invalid" | "selector_no_match";

/** selector 重提取的可预期失败：由管理端映射成文案，调用方保留旧预览。 */
export class ScrapeSelectorError extends Error {
  readonly code: ScrapeSelectorErrorCode;

  constructor(code: ScrapeSelectorErrorCode) {
    super(code);
    this.name = "ScrapeSelectorError";
    this.code = code;
  }
}

export interface DecodedHtml {
  html: string;
  /** 实际采用的字符集标签（小写；未知声明已回退 utf-8） */
  charset: string;
  warnings: ScrapeWarning[];
}

function normalizeText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

const DEFAULT_CATEGORY_ID = 1;
const SUMMARY_FALLBACK_LENGTH = 120;
const TAG_LINK_SELECTOR = 'a[rel~="tag"], a[href*="/tag/"], a[href*="/tags/"]';

/** 按给定顺序返回第一个非空 meta content（DOMParser 已解码 HTML 实体）。 */
function metaContent(doc: Document, selectors: readonly string[]): string {
  for (const selector of selectors) {
    const value = normalizeText(
      doc.querySelector(selector)?.getAttribute("content")
    );
    if (value) return value;
  }
  return "";
}

/** 按 Unicode 码点截取，避免把代理对（emoji 等）切成半个字符。 */
function firstCharacters(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("");
}

/** meta 描述里可能混入字面量标签；摘要展示前一并剥掉。 */
function stripTags(value: string): string {
  return normalizeText(value.replace(/<[^>]*>/g, " "));
}

const CJK_CHAR =
  /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
const LATIN_WORD = /[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*/g;

/** CJK 按字符计，拉丁文按词计；用于预览字数与空正文判断。 */
function countWords(plainText: string): number {
  const cjk = plainText.match(CJK_CHAR)?.length || 0;
  const latin = plainText.replace(CJK_CHAR, " ").match(LATIN_WORD)?.length || 0;
  return cjk + latin;
}

/**
 * 标签候选：meta keywords + 正文 tag 链接（rel="tag" 或 /tag(s)/ 路径）。
 * 只保留站点已有标签的精确匹配，未匹配项直接丢弃；绝不创建新标签。
 */
function extractTags(doc: Document, existingTags: readonly string[]): string[] {
  const allowed = new Set(
    existingTags.map((name) => name.trim()).filter(Boolean)
  );
  if (allowed.size === 0) return [];

  const candidates = (
    doc.querySelector('meta[name="keywords"]')?.getAttribute("content") || ""
  )
    .split(/[,，]/)
    .concat(
      Array.from(doc.querySelectorAll(TAG_LINK_SELECTOR)).map((link) =>
        normalizeText(link.textContent)
      )
    );

  const matched: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    for (const raw of candidate.split(/[,，]/)) {
      const name = raw.trim();
      if (!name || seen.has(name) || !allowed.has(name)) continue;
      seen.add(name);
      matched.push(name);
    }
  }
  return matched;
}

/** 封面只认 og:image；缺失或协议不在 http(s) 白名单时留空。 */
function extractCoverImage(doc: Document, base: URL | null): string {
  const raw = metaContent(doc, [
    'meta[property="og:image"]',
    'meta[name="og:image"]',
  ]);
  const url = resolveUrl(raw, base);
  return isSafeMedia(url) ? url.href : "";
}

function formatScrapeDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeFootnoteLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
}

/** 来源脚注：原文链接 + 抓取日期。标题为空时用 final URL 作链接文字。 */
function appendSourceFootnote(
  markdown: string,
  title: string,
  finalUrl: string,
  scrapedAt: Date
): string {
  // 空正文不生成「只有脚注」的假草稿，保留 UI 的 scrape_empty 判定
  if (!markdown) return "";
  const label = escapeFootnoteLabel(title || finalUrl);
  const footnote = `> 原文：[${label}](${finalUrl})（抓取于 ${formatScrapeDate(scrapedAt)}）`;
  return `${markdown}\n\n---\n\n${footnote}`;
}

function resolveUrl(value: string, base: URL | null): URL | null {
  if (!value) return null;
  try {
    return new URL(value, base ?? undefined);
  } catch {
    return null;
  }
}

/** 链接可保留的协议；javascript:/data:/vbscript: 等一律剥掉 href */
const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);
/** 图片、嵌入内容与 base 只认 http/https（data: 会撑大草稿，其余协议无解析意义） */
const SAFE_MEDIA_SCHEMES = new Set(["http:", "https:"]);

function isSafeLink(url: URL | null): url is URL {
  return !!url && SAFE_LINK_SCHEMES.has(url.protocol);
}

function isSafeMedia(url: URL | null): url is URL {
  return !!url && SAFE_MEDIA_SCHEMES.has(url.protocol);
}

/** 懒加载图片的 src 常是 data: 占位图；真实地址在这些属性里。 */
const LAZY_SRC_ATTRIBUTES = [
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-actualsrc",
  "data-echo",
  "data-url",
  "data-image",
];
const LAZY_SRCSET_ATTRIBUTES = ["data-srcset", "data-lazy-srcset"];

function firstSrcsetUrl(value: string | null): string {
  if (!value) return "";
  const first = value.split(",")[0]?.trim() || "";
  return first.split(/\s+/)[0] || "";
}

function isPlaceholderSrc(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^(?:data|javascript|vbscript|about|blob):/i.test(trimmed);
}

/**
 * 懒加载图片：src 为 data: 占位图或为空时，把 data-src / srcset 里的真实
 * 地址提升到 src，并移除懒加载属性。必须在 URL 绝对化之前执行——
 * Readability 的 _fixLazyImages 在它自己的流程里才把 data-src 抄进 src，
 * 那时相对地址会按管理页 baseURI 解析，草稿图片会指向管理端域名。
 */
function promoteLazyImages(root: ParentNode): void {
  for (const img of Array.from(root.querySelectorAll("img"))) {
    let src = img.getAttribute("src") || "";
    if (isPlaceholderSrc(src)) src = "";

    if (!src) {
      for (const name of LAZY_SRC_ATTRIBUTES) {
        const value = img.getAttribute(name);
        if (value && !isPlaceholderSrc(value)) {
          src = value;
          break;
        }
      }
    }

    if (!src) {
      const srcset = [img.getAttribute("srcset")]
        .concat(LAZY_SRCSET_ATTRIBUTES.map((name) => img.getAttribute(name)))
        .find((value) => !!value);
      src = firstSrcsetUrl(srcset || null);
    }

    if (!src) {
      const source = img
        .closest("picture")
        ?.querySelector(
          "source[srcset], source[data-srcset], source[data-lazy-srcset]"
        );
      const srcset =
        source?.getAttribute("srcset") ||
        source?.getAttribute("data-srcset") ||
        source?.getAttribute("data-lazy-srcset");
      src = firstSrcsetUrl(srcset || null);
    }

    if (src) img.setAttribute("src", src);
    for (const name of [...LAZY_SRC_ATTRIBUTES, ...LAZY_SRCSET_ATTRIBUTES]) {
      img.removeAttribute(name);
    }
  }

  // picture/figure 上的 data-* 懒加载属性会被 Readability 复制回 img
  for (const element of Array.from(root.querySelectorAll("picture, figure"))) {
    for (const name of [...LAZY_SRC_ATTRIBUTES, ...LAZY_SRCSET_ATTRIBUTES]) {
      element.removeAttribute(name);
    }
  }
}

/**
 * 页面自带 <base> 优先、final URL 兜底，得到 URL 解析基准。
 * <base> 本身非 http/https（或解析失败）时忽略，退回 final URL。
 */
function resolveBaseUrl(doc: Document, finalUrl: string): URL | null {
  const finalBase = resolveUrl(finalUrl, null);
  const baseAttr = doc.querySelector("base[href]")?.getAttribute("href") || "";
  const docBase = resolveUrl(baseAttr, finalBase);
  return docBase && isSafeMedia(docBase) ? docBase : finalBase;
}

/**
 * iframe/embed/object 降级：src/data 可解析且为 http/https 时替换成
 * 指向该地址的普通链接，保留内容的可追溯性；其余（javascript:/data:、
 * 无地址）整体删除，不让危险 scheme 或空壳进入草稿。
 */
function downgradeEmbeds(root: ParentNode, base: URL | null): void {
  for (const embed of Array.from(
    root.querySelectorAll("iframe, embed, object")
  )) {
    const raw = embed.getAttribute("src") || embed.getAttribute("data") || "";
    const url = resolveUrl(raw, base);
    if (!isSafeMedia(url)) {
      embed.remove();
      continue;
    }

    const link = embed.ownerDocument.createElement("a");
    link.setAttribute("href", url.href);
    // 有 title 用 title，否则直接露出地址，避免生成无文字的空链接
    link.textContent = normalizeText(embed.getAttribute("title")) || url.href;
    embed.replaceWith(link);
  }
}

/**
 * 就地把文档里的 a[href] / img[src] 绝对化，非白名单协议直接剥掉属性
 * （链接文字保留），避免草稿里留下 javascript: 之类可点击的危险地址。
 * 嵌入内容先降级成链接，再与普通链接一起走同一套绝对化/协议校验。
 *
 * 必须在 Readability 之前对源文档执行：Readability 的 _fixRelativeUris
 * 用 document.baseURI 解析相对地址，而 DOMParser 文档的 baseURI 是管理页
 * 地址——不先绝对化，草稿里的相对链接会指向管理端域名。
 */
function resolveDocumentUrls(root: ParentNode, base: URL | null): void {
  downgradeEmbeds(root, base);

  for (const link of Array.from(root.querySelectorAll("a[href]"))) {
    const url = resolveUrl(link.getAttribute("href") || "", base);
    if (isSafeLink(url)) {
      link.setAttribute("href", url.href);
    } else {
      link.removeAttribute("href");
    }
  }

  for (const img of Array.from(root.querySelectorAll("img[src]"))) {
    const url = resolveUrl(img.getAttribute("src") || "", base);
    if (isSafeMedia(url)) {
      img.setAttribute("src", url.href);
    } else {
      img.removeAttribute("src");
    }
  }
}

/**
 * 把 <pre><code class="language-js"> 的语言标注搬到 pre[data-language]：
 * Readability 默认会清掉 class，但保留 data-*，高亮语言因此能活到转换阶段。
 */
function annotateCodeLanguages(root: ParentNode): void {
  for (const pre of Array.from(root.querySelectorAll("pre"))) {
    const code = pre.querySelector("code");
    const className = [pre.getAttribute("class"), code?.getAttribute("class")]
      .filter(Boolean)
      .join(" ");
    const match = /(?:language|lang)-([a-z0-9_+-]+)/i.exec(className);
    if (match) pre.setAttribute("data-language", match[1]);
  }
}

/** 正文图片统计：总数用于预览，unresolved 用于「可能坏图」提示。 */
function collectImageStats(
  root: ParentNode,
  base: URL | null
): ScrapeImageStats {
  const images = Array.from(root.querySelectorAll("img"));
  let unresolved = 0;

  for (const img of images) {
    const src = img.getAttribute("src") || "";
    const url = resolveUrl(src, base);
    if (!isSafeMedia(url)) unresolved += 1;
  }

  return { total: images.length, unresolved };
}

const TABLE_ROW_TAGS = new Set(["TR"]);
const TABLE_CELL_TAGS = new Set(["TD", "TH"]);
const TABLE_SECTION_TAGS = new Set([
  "THEAD",
  "TBODY",
  "TFOOT",
  "CAPTION",
  "COLGROUP",
]);

/**
 * selector 直接命中表格内部节点（tr/td/thead…）时，outerHTML 脱离 table
 * 后重新解析会被 HTML 解析器丢掉标签、只剩文本。这里补回最小表格上下文；
 * 行命中还带上原表 thead，避免表头丢失、GFM 表格退化成 HTML。
 */
function wrapSelectedTableParts(matches: Element[], html: string): string {
  if (matches.length === 0) return html;
  const tags = matches.map((element) => element.tagName);

  if (tags.every((tag) => TABLE_ROW_TAGS.has(tag))) {
    // 若选中的行已包含表头行，不再额外补 thead，避免重复表头
    const includesHeadRow = matches.some((row) => !!row.closest("thead"));
    const thead = includesHeadRow
      ? null
      : matches[0].closest("table")?.querySelector("thead");
    return `<table>${thead ? thead.outerHTML : ""}<tbody>${html}</tbody></table>`;
  }
  if (tags.every((tag) => TABLE_CELL_TAGS.has(tag))) {
    const row = `<tr>${html}</tr>`;
    return tags.every((tag) => tag === "TH")
      ? `<table><thead>${row}</thead></table>`
      : `<table><tbody>${row}</tbody></table>`;
  }
  if (tags.every((tag) => TABLE_SECTION_TAGS.has(tag))) {
    return `<table>${html}</table>`;
  }
  return html;
}

/**
 * selector 覆盖提取：多个命中按 querySelectorAll 的文档顺序拼接
 * outerHTML（保留命中节点自身的语义，如选中一系列 h2/li）。
 */
function extractBySelector(doc: Document, selector: string): string {
  let matches: Element[];
  try {
    matches = Array.from(doc.querySelectorAll(selector));
  } catch {
    throw new ScrapeSelectorError("selector_invalid");
  }
  if (matches.length === 0) {
    throw new ScrapeSelectorError("selector_no_match");
  }
  const html = matches.map((element) => element.outerHTML).join("\n");
  return wrapSelectedTableParts(matches, html);
}

function dedupeTitleHeading(contentDoc: Document, title: string): void {
  if (!title) return;
  for (const h1 of Array.from(contentDoc.body.querySelectorAll("h1"))) {
    if (normalizeText(h1.textContent) === title) h1.remove();
  }
}

/**
 * HTML + final URL → 可校对的 Markdown 草稿。
 *
 * - 默认使用 Readability 提取正文；失败 / 空正文时回退到 <body> 并给出
 *   no_article 警告，避免静默产出空草稿。
 * - 传入 selector 时跳过 Readability 正文，直接拼所选子树；语法错误 / 未命中
 *   抛 ScrapeSelectorError，由 UI 保留上一份预览。Readability 仍用于提供标题。
 * - 标题默认按 Readability → og:title → <title> 映射；selector 模式优先所选
 *   子树的 H1。正文里与标题同名的 H1 会被移除，防止文章页重复渲染标题。
 * - 摘要按 meta/OG description → 正文前 120 字映射；封面只取 og:image；
 *   标签只保留站点已有标签；slug 留空、分类默认未分类、状态 draft。
 * - 末尾追加来源脚注（final URL + 抓取日期），标题中的 `]` 会转义。
 * - 源文档先提升懒加载图片地址，再做 URL 绝对化、协议白名单与嵌入内容降级，
 *   正文里的相对链接不会残留成管理端地址或可点击的 javascript: 链接。
 * - 使用 Turndown + GFM 保留标题、列表、引用、带语言标注的围栏代码、
 *   表格、图片与行内强调。
 */
export function buildScrapeDraft(
  html: string,
  finalUrl: string,
  options: ScrapeOptions = {}
): ScrapeDraft {
  const warnings: ScrapeWarning[] = [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  promoteLazyImages(doc);
  const base = resolveBaseUrl(doc, finalUrl);
  resolveDocumentUrls(doc, base);
  annotateCodeLanguages(doc);

  const selector = (options.selector || "").trim();
  let readabilityTitle = "";
  let content = "";

  // Readability 同时是标题映射的第一来源；selector 模式只忽略它的正文。
  try {
    const article = new Readability(doc.cloneNode(true) as Document).parse();
    if (article) {
      readabilityTitle = normalizeText(article.title);
      if (!selector) content = article.content || "";
    }
  } catch {
    if (!selector) warnings.push("readability_failed");
  }

  if (selector) {
    content = extractBySelector(doc, selector);
  } else if (!content) {
    content = doc.body?.innerHTML || "";
    warnings.push("no_article");
  }

  // 正文过一次「正文文档」：URL 安全网 + 标题去重 + 统计
  const contentDoc = new DOMParser().parseFromString(content, "text/html");
  resolveDocumentUrls(contentDoc, base);
  annotateCodeLanguages(contentDoc);
  // 非正文元素连同内容整体移除，避免脚本文本进入字数 / 摘要回退
  for (const node of Array.from(
    contentDoc.querySelectorAll("script, style, noscript")
  )) {
    node.remove();
  }

  const contentH1 = normalizeText(
    contentDoc.body.querySelector("h1")?.textContent
  );
  const ogTitle = metaContent(doc, [
    'meta[property="og:title"]',
    'meta[name="og:title"]',
  ]);
  const pageTitle = normalizeText(doc.querySelector("title")?.textContent);
  const pageH1 = normalizeText(doc.querySelector("h1")?.textContent);

  // selector 模式下所选子树就是正文，优先用它自己的 H1；默认路径按
  // Readability → og:title → <title>，最后才用 H1 兜底，避免整页回退时
  // 把导航 / Logo 的 H1 当成文章标题。
  const title = selector
    ? contentH1 || readabilityTitle || ogTitle || pageTitle || pageH1
    : readabilityTitle || ogTitle || pageTitle || contentH1 || pageH1;

  dedupeTitleHeading(contentDoc, title);
  const images = collectImageStats(contentDoc, base);
  const plainText = normalizeText(contentDoc.body.textContent);
  const wordCount = countWords(plainText);
  const summary =
    stripTags(
      metaContent(doc, [
        'meta[name="description"]',
        'meta[property="og:description"]',
        'meta[name="og:description"]',
      ])
    ) || firstCharacters(plainText, SUMMARY_FALLBACK_LENGTH);
  const coverImage = extractCoverImage(doc, base);
  const tags = extractTags(doc, options.existingTags || []);
  content = contentDoc.body.innerHTML;

  const turndown = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });
  turndown.use(gfm);
  // 代码块：语言标注来自 pre[data-language]（annotateCodeLanguages 已把
  // Readability 会清掉的 class="language-*" 搬过去）
  turndown.addRule("fencedCodeBlock", {
    filter: (node, options) =>
      options.codeBlockStyle === "fenced" &&
      node.nodeName === "PRE" &&
      node.firstChild?.nodeName === "CODE",
    replacement: (_content, node, options) => {
      const pre = node as HTMLElement;
      const code = pre.firstChild as HTMLElement;
      const language = pre.getAttribute("data-language") || "";
      const text = (code.textContent || "").replace(/\n$/, "");
      return `\n\n${options.fence}${language}\n${text}\n${options.fence}\n\n`;
    },
  });

  let markdown = "";
  try {
    markdown = turndown.turndown(content).trim();
  } catch {
    warnings.push("convert_failed");
  }

  return {
    title,
    summary,
    coverImage,
    tags,
    slug: "",
    categoryId: DEFAULT_CATEGORY_ID,
    status: "draft",
    markdown: appendSourceFootnote(
      markdown,
      title,
      finalUrl,
      options.scrapedAt || new Date()
    ),
    wordCount,
    warnings,
    images,
  };
}

const HEADER_SNIFF_BYTES = 2048;
const UTF8 = "utf-8";

function charsetFromBom(bytes: Uint8Array): string {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    return UTF8;
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return "utf-16le";
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return "utf-16be";
  }
  return "";
}

function charsetFromContentType(
  contentType: string | null | undefined
): string {
  const match = /charset\s*=\s*["']?([a-z0-9._:-]+)/i.exec(contentType || "");
  return match ? match[1].trim() : "";
}

/** 只嗅探文档头部：<meta charset> / <meta content="…charset=…"> / XML 声明 */
function charsetFromMarkup(bytes: Uint8Array): string {
  const head = new TextDecoder("windows-1252").decode(
    bytes.subarray(0, HEADER_SNIFF_BYTES)
  );
  const meta =
    /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9._:-]+)/i.exec(head) ||
    /<\?xml[^>]+encoding\s*=\s*["']([a-z0-9._:-]+)["']/i.exec(head);
  return meta ? meta[1].trim() : "";
}

/**
 * 原始 HTML 字节 → 字符串。优先级：BOM → HTTP Content-Type → 文档头部
 * 的 <meta charset> / XML 声明 → UTF-8 默认。声明了未知 / 不支持的
 * 字符集时回退 UTF-8 并给出 charset_fallback 警告（GBK/GB2312 由
 * TextDecoder 的 Encoding Standard 别名支持）。
 */
export function decodeHtmlBytes(
  input: ArrayBuffer | Uint8Array,
  contentType?: string | null
): DecodedHtml {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  const declared =
    charsetFromBom(bytes) ||
    charsetFromContentType(contentType) ||
    charsetFromMarkup(bytes);

  if (!declared) {
    return {
      html: new TextDecoder(UTF8).decode(bytes),
      charset: UTF8,
      warnings: [],
    };
  }

  try {
    return {
      html: new TextDecoder(declared).decode(bytes),
      charset: declared.toLowerCase(),
      warnings: [],
    };
  } catch {
    return {
      html: new TextDecoder(UTF8).decode(bytes),
      charset: UTF8,
      warnings: ["charset_fallback"],
    };
  }
}
