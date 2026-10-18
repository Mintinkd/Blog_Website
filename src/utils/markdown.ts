import { marked } from "marked";
import DOMPurify from "dompurify";

// marked v14 起不再内置/接受 highlight 选项——原处传入的 hljs 回调自升级以来即为死代码
// （运行时被 marked 忽略，渲染输出从未真正高亮），前端类型门禁启用后移除（issue #26）。
// 如需恢复代码高亮，应接线 marked-highlight 扩展并同步评估 DOMPurify 白名单。
marked.setOptions({
  gfm: true,
  breaks: false,
});

export function renderMarkdown(content: string): string {
  const rawHtml = marked.parse(content) as string;
  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "a",
      "img",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "em",
      "strong",
      "del",
      "ins",
      "sup",
      "sub",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "hr",
      "br",
      "span",
      "div",
    ],
    ALLOWED_ATTR: [
      "href",
      "src",
      "alt",
      "title",
      "class",
      "id",
      "target",
      "rel",
    ],
  });
}

export function extractHeadings(
  content: string
): Array<{ level: number; text: string; id: string }> {
  const html = marked.parse(content) as string;
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
