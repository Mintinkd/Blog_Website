import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import type { IOptions } from "sanitize-html";
import {
  ARTICLE_BODY_SANITIZE_HTML_OPTIONS,
  MARKDOWN_PARSE_OPTIONS,
} from "./markdownPolicy";

/**
 * 服务端 Markdown → 可安全嵌入的正文 HTML。
 *
 * 与 `renderMarkdown`（后台预览，DOMPurify）共用 `markdownPolicy` 的标签 /
 * 属性 / URL scheme 白名单。只依赖 marked + sanitize-html，不触碰 DOM 全局，
 * 因此可在 Workers 运行时执行。
 */
export function renderMarkdownServer(content: string): string {
  const rawHtml = marked.parse(content, MARKDOWN_PARSE_OPTIONS) as string;
  return sanitizeHtml(rawHtml, ARTICLE_BODY_SANITIZE_HTML_OPTIONS);
}

/** 纯文本模式：不放行任何标签 / 属性，script / style 等非文本标签整段丢弃。 */
const PLAIN_TEXT_SANITIZE_HTML_OPTIONS: IOptions = {
  allowedTags: [],
  allowedAttributes: {},
};

/**
 * 块级边界替换为空格，避免段落 / 列表项在去标签后首尾粘连。
 * 只用于随后立即消毒的中间 HTML，不直接输出。
 */
const BLOCK_BOUNDARY_RE =
  /<\/(?:address|article|aside|blockquote|div|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|td|th|tr|ul)>|<br\s*\/?>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** sanitize-html 会把文本中的 `& < >` 转成实体；纯文本需要还原。 */
function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, body: string) => {
      if (body.startsWith("#")) {
        const code =
          body[1]?.toLowerCase() === "x"
            ? Number.parseInt(body.slice(2), 16)
            : Number(body.slice(1));
        const valid =
          Number.isInteger(code) &&
          code > 0 &&
          code <= 0x10ffff &&
          !(code >= 0xd800 && code <= 0xdfff);
        return valid ? String.fromCodePoint(code) : match;
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    }
  );
}

/**
 * 服务端 Markdown → 纯文本（文章摘要回退用）。
 *
 * 与正文渲染共用 marked 解析选项：先把 Markdown 结构转成 HTML，再丢给
 * sanitize-html 去标签（script / style 内容不进入结果），最后还原实体并
 * 压缩空白。结果不含 Markdown / HTML 语法。
 */
export function renderMarkdownPlainText(content: string): string {
  const rawHtml = marked.parse(content, MARKDOWN_PARSE_OPTIONS) as string;
  const spacedHtml = rawHtml.replace(BLOCK_BOUNDARY_RE, " ");
  return decodeHtmlEntities(
    sanitizeHtml(spacedHtml, PLAIN_TEXT_SANITIZE_HTML_OPTIONS)
  )
    .replace(/\s+/g, " ")
    .trim();
}
