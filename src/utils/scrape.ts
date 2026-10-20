import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/**
 * 管理端抓取管线（#33 / ADR 0003）
 *
 * Worker 只负责安全取回 HTML；本模块在管理员浏览器里把 HTML 提取成
 * 标题 + Markdown。原始 HTML 仅在惰性 DOMParser 文档中解析，绝不注入
 * 管理页 DOM。v1（T1）只覆盖 UTF-8 与基础 Readability → Turndown(GFM)
 * 转换；字符集嗅探、元数据与来源脚注由后续票补全。
 */

export interface ScrapeDraft {
  title: string;
  markdown: string;
  warnings: string[];
}

function normalizeText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

/**
 * HTML + final URL → 可校对的 Markdown 草稿。
 *
 * - 使用 Readability 提取正文；失败时回退到 <body> 并给出 no_article 警告，
 *   避免整页导航/页脚进入草稿。
 * - Readability 已把文章标题收进 title；若正文仍带同名 H1，则移除，防止
 *   站点文章页重复渲染标题。
 * - 使用 Turndown + GFM 保留标题、列表、引用、围栏代码、表格与强调。
 */
export function buildScrapeDraft(html: string, finalUrl: string): ScrapeDraft {
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(html, "text/html");

  if (finalUrl && !doc.querySelector("base")) {
    const base = doc.createElement("base");
    base.href = finalUrl;
    doc.head.prepend(base);
  }

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

  // Readability 的 title 与正文首个 H1 同名时移除正文 H1（标题由文章页单独渲染）
  if (content && title) {
    const contentDoc = new DOMParser().parseFromString(content, "text/html");
    const h1 = contentDoc.body.querySelector("h1");
    if (h1 && normalizeText(h1.textContent) === title) {
      h1.remove();
      content = contentDoc.body.innerHTML;
    }
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
  // 原始 HTML 块不进入 Markdown；不支持的嵌入降级为文本
  turndown.remove(["script", "style", "noscript", "iframe", "embed", "object"]);

  let markdown = "";
  try {
    markdown = turndown.turndown(content).trim();
  } catch {
    warnings.push("convert_failed");
  }

  return { title, markdown, warnings };
}
