import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/**
 * 管理端抓取管线（#33 / ADR 0003）
 *
 * Worker 只负责安全取回 HTML；本模块在管理员浏览器里把 HTML 提取成
 * 标题 + Markdown。原始 HTML 仅在惰性 DOMParser 文档中解析，绝不注入
 * 管理页 DOM。a/img 地址按 final URL（或页面 <base>）绝对化，非白名单
 * 协议（javascript:/data:/vbscript:）就地剥除。v1（T1）只覆盖 UTF-8 与
 * 基础 Readability → Turndown(GFM) 转换；字符集嗅探、元数据与来源脚注
 * 由后续票补全。
 */

export interface ScrapeDraft {
  title: string;
  markdown: string;
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
/** 图片与 base 只认 http/https（data: 会撑大草稿，其余协议无解析意义） */
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
 * 就地把文档里的 a[href] / img[src] 绝对化，非白名单协议直接剥掉属性
 * （链接文字保留），避免草稿里留下 javascript: 之类可点击的危险地址。
 *
 * 必须在 Readability 之前对源文档执行：Readability 的 _fixRelativeUris
 * 用 document.baseURI 解析相对地址，而 DOMParser 文档的 baseURI 是管理页
 * 地址——不先绝对化，草稿里的相对链接会指向管理端域名。
 */
function resolveDocumentUrls(root: ParentNode, base: URL | null): void {
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
 * HTML + final URL → 可校对的 Markdown 草稿。
 *
 * - 使用 Readability 提取正文；失败时回退到 <body> 并给出 no_article 警告，
 *   避免整页导航/页脚进入草稿。
 * - Readability 已把文章标题收进 title；若正文仍带同名 H1，则移除，防止
 *   站点文章页重复渲染标题。
 * - 源文档先做 URL 绝对化与协议白名单，正文里的相对链接不会残留成
 *   管理端地址或可点击的 javascript: 链接。
 * - 使用 Turndown + GFM 保留标题、列表、引用、围栏代码、表格与强调。
 */
export function buildScrapeDraft(html: string, finalUrl: string): ScrapeDraft {
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  resolveDocumentUrls(doc, resolveBaseUrl(doc, finalUrl));

  let title = "";
  let content = "";

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

  if (!title) {
    title =
      normalizeText(doc.querySelector("title")?.textContent) ||
      normalizeText(doc.querySelector("h1")?.textContent);
  }

  // 正文过一次「正文文档」：去重 H1（URL 绝对化已在源文档完成）
  if (content) {
    const contentDoc = new DOMParser().parseFromString(content, "text/html");

    // Readability 的 title 与正文首个 H1 同名时移除正文 H1（标题由文章页单独渲染）
    const h1 = contentDoc.body.querySelector("h1");
    if (title && h1 && normalizeText(h1.textContent) === title) {
      h1.remove();
    }

    content = contentDoc.body.innerHTML;
  }

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
  // script/style 等非正文元素连同内容整体移除，避免脚本与嵌入代码进入 Markdown
  turndown.remove(["script", "style", "noscript", "iframe", "embed", "object"]);

  let markdown = "";
  try {
    markdown = turndown.turndown(content).trim();
  } catch {
    warnings.push("convert_failed");
  }

  return { title, markdown, warnings };
}
