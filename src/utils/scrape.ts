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

export interface ScrapeDraft {
  title: string;
  markdown: string;
  warnings: string[];
  images: ScrapeImageStats;
}

export interface ScrapeOptions {
  /**
   * 手动 CSS selector。命中时跳过 Readability，按文档顺序拼接所有命中
   * 子树的 outerHTML；未命中或语法无效抛 ScrapeSelectorError。
   */
  selector?: string;
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
  warnings: string[];
}

function normalizeText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
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

/**
 * 页面自带 <base> 优先、final URL 兜底，得到 URL 解析基准。
 * <base> 本身非 http/https（或解析失败）时忽略，退回 final URL。
 */
function resolveBaseUrl(doc: Document, finalUrl: string): URL | null {
  const finalBase = resolveUrl(finalUrl, null);
  const baseAttr = doc.querySelector("base[href]")?.getAttribute("href") || "";
  const docBase = resolveUrl(baseAttr, finalBase);
  return docBase && SAFE_MEDIA_SCHEMES.has(docBase.protocol)
    ? docBase
    : finalBase;
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
    if (!url || !SAFE_MEDIA_SCHEMES.has(url.protocol)) {
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
    if (url && SAFE_LINK_SCHEMES.has(url.protocol)) {
      link.setAttribute("href", url.href);
    } else {
      link.removeAttribute("href");
    }
  }

  for (const img of Array.from(root.querySelectorAll("img[src]"))) {
    const url = resolveUrl(img.getAttribute("src") || "", base);
    if (url && SAFE_MEDIA_SCHEMES.has(url.protocol)) {
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
    if (!url || !SAFE_MEDIA_SCHEMES.has(url.protocol)) unresolved += 1;
  }

  return { total: images.length, unresolved };
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
  return matches.map((element) => element.outerHTML).join("\n");
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
 * - 传入 selector 时跳过 Readability，直接拼所选子树；语法错误 / 未命中
 *   抛 ScrapeSelectorError，由 UI 保留上一份预览。
 * - 标题优先取 Readability title，其次正文 H1、页面 <title>、页面 H1；
 *   正文里与标题同名的 H1 会被移除，防止文章页重复渲染标题。
 * - 源文档先做 URL 绝对化、协议白名单与嵌入内容降级，正文里的相对链接
 *   不会残留成管理端地址或可点击的 javascript: 链接。
 * - 使用 Turndown + GFM 保留标题、列表、引用、带语言标注的围栏代码、
 *   表格、图片与行内强调。
 */
export function buildScrapeDraft(
  html: string,
  finalUrl: string,
  options: ScrapeOptions = {}
): ScrapeDraft {
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const base = resolveBaseUrl(doc, finalUrl);
  resolveDocumentUrls(doc, base);
  annotateCodeLanguages(doc);

  const selector = (options.selector || "").trim();
  let title = "";
  let content = "";

  if (selector) {
    content = extractBySelector(doc, selector);
  } else {
    try {
      const article = new Readability(doc.cloneNode(true) as Document).parse();
      if (article) {
        title = normalizeText(article.title);
        content = article.content || "";
      }
    } catch {
      warnings.push("readability_failed");
    }

    if (!content) {
      content = doc.body?.innerHTML || "";
      warnings.push("no_article");
    }
  }

  // 正文过一次「正文文档」：URL 安全网 + 标题去重 + 图片统计
  const contentDoc = new DOMParser().parseFromString(content, "text/html");
  resolveDocumentUrls(contentDoc, base);
  annotateCodeLanguages(contentDoc);

  title =
    normalizeText(title) ||
    normalizeText(contentDoc.body.querySelector("h1")?.textContent) ||
    normalizeText(doc.querySelector("title")?.textContent) ||
    normalizeText(doc.querySelector("h1")?.textContent);

  dedupeTitleHeading(contentDoc, title);
  const images = collectImageStats(contentDoc, base);
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
  // 代码块：语言标注来自 pre[data-language]（Readability 会清 class），
  // 兼容未经过 Readability 的 class="language-*" 写法
  turndown.addRule("fencedCodeBlock", {
    filter: (node, options) =>
      options.codeBlockStyle === "fenced" &&
      node.nodeName === "PRE" &&
      node.firstChild?.nodeName === "CODE",
    replacement: (_content, node, options) => {
      const pre = node as HTMLElement;
      const code = pre.firstChild as HTMLElement;
      const className = code.getAttribute("class") || "";
      const language =
        pre.getAttribute("data-language") ||
        (/(?:language|lang)-(\S+)/.exec(className) || [null, ""])[1] ||
        "";
      const text = (code.textContent || "").replace(/\n$/, "");
      return `\n\n${options.fence}${language}\n${text}\n${options.fence}\n\n`;
    },
  });
  // script/style 等非正文元素连同内容整体移除；嵌入内容已在上面降级为链接
  turndown.remove(["script", "style", "noscript"]);

  let markdown = "";
  try {
    markdown = turndown.turndown(content).trim();
  } catch {
    warnings.push("convert_failed");
  }

  return { title, markdown, warnings, images };
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
  input: ArrayBuffer | ArrayBufferView,
  contentType?: string | null
): DecodedHtml {
  const bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

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
