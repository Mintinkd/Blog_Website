import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/utils/markdown";
import { renderMarkdownServer } from "../src/utils/markdownServer";

/**
 * #37 / #36：后台预览（DOMPurify）与服务端渲染器（sanitize-html）必须消费
 * 同一份正文白名单，原始 HTML 的保留 / 剥除结果一致。
 *
 * 唯一的序列化差异是 void 标签：DOMPurify 输出 `<img ...>`，
 * sanitize-html 输出 `<img ... />`；两者在 HTML5 中等价，比较前归一化。
 */
function canonical(html: string): string {
  return html.replace(/\s*\/>/g, ">");
}

const FIXTURE = [
  '<div class="note" id="note" data-extra="x" aria-label="raw" onclick="evil()">raw <span>span</span><script>bad()</script><iframe src="https://evil.example"></iframe></div>',
  "",
  "## Heading",
  "",
  "- item",
  "",
  "| A | B |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "```js",
  "const x = 1 < 2;",
  "```",
  "",
  "![cover](/cover.png)",
  "",
  '[link](https://example.com) <a href="javascript:alert(1)">bad</a>',
].join("\n");

describe("原始 HTML 行为与后台预览一致", () => {
  it("同一份 Markdown 经预览与服务端渲染得到相同的消毒结果", () => {
    const preview = canonical(renderMarkdown(FIXTURE));
    const server = canonical(renderMarkdownServer(FIXTURE));

    expect(server).toBe(preview);
    // 防止两边同时退化为“什么都不过滤”
    expect(server).not.toContain("onclick");
    expect(server).not.toContain("<script");
    expect(server).not.toContain("<iframe");
    expect(server).not.toContain("javascript:");
    expect(server).toContain('data-extra="x"');
    expect(server).toContain('aria-label="raw"');
  });
});
