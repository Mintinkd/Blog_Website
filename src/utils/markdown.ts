import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  ARTICLE_BODY_DOMPURIFY_CONFIG,
  MARKDOWN_PARSE_OPTIONS,
} from "./markdownPolicy";

// marked v14 起不再内置/接受 highlight 选项——原处传入的 hljs 回调自升级以来即为死代码
// （运行时被 marked 忽略，渲染输出从未真正高亮），前端类型门禁启用后移除（issue #26）。
// 如需恢复代码高亮，应接线 marked-highlight 扩展并同步评估正文白名单。
//
// 解析选项按调用传入，不改 marked 全局默认值，避免影响其他 marked 调用方。

export function renderMarkdown(content: string): string {
  const rawHtml = marked.parse(content, MARKDOWN_PARSE_OPTIONS) as string;
  return DOMPurify.sanitize(rawHtml, ARTICLE_BODY_DOMPURIFY_CONFIG);
}

export function extractHeadings(
  content: string
): Array<{ level: number; text: string; id: string }> {
  const html = marked.parse(content, MARKDOWN_PARSE_OPTIONS) as string;
  const headings: Array<{ level: number; text: string; id: string }> = [];
  const regex = /<h([1-6])(?:\s[^>]*)?>(.*?)<\/h\1>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const level = parseInt(match[1], 10);
    const text = match[2].replace(/<[^>]*>/g, "").trim();
    const id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");
    headings.push({ level, text, id });
  }

  return headings;
}
