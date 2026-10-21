import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
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
