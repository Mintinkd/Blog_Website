import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/utils/markdown";
import { renderMarkdownServer } from "../src/utils/markdownServer";
import {
  classifyMarkdown,
  normalizeRenderedHtml,
} from "../src/utils/editor/markdownBridge";

/**
 * #37 / #36：后台预览（DOMPurify）与服务端渲染器（sanitize-html）必须消费
 * 同一份正文白名单，原始 HTML 的保留 / 剥除结果一致。
 *
 * 唯一的序列化差异是 void 标签：DOMPurify 输出 `<img ...>`，
 * sanitize-html 输出 `<img ... />`；两者在 HTML5 中等价，比较前归一化。
 */
function normalizeVoidTags(html: string): string {
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

/**
 * 两种消毒器默认口径不同的边界样本：DOMPurify 丢弃的子树、
 * sanitize-html 默认保留的 textarea / option 文本，以及仅 DOMPurify
 * 会做 scheme 校验的 target / rel。
 */
const RAW_HTML_PARITY_CASES = [
  '<iframe src="https://evil.example/frame">iframe fallback</iframe>',
  "<template><p>template fallback</p></template>",
  "<textarea>textarea text</textarea>",
  "<option>option text</option>",
  "<audio>audio fallback</audio>",
  "<video>video fallback</video>",
  "<title>title fallback</title>",
  "<svg><text>svg fallback</text></svg>",
  '<a href="https://example.com" target="javascript:alert(1)" rel="javascript:alert(1)">bad target</a>',
  '<a href="https://example.com" target="_blank" rel="noopener noreferrer">good target</a>',
];

describe("原始 HTML 行为与后台预览一致", () => {
  it("同一份 Markdown 经预览与服务端渲染得到相同的消毒结果", () => {
    const preview = normalizeVoidTags(renderMarkdown(FIXTURE));
    const server = normalizeVoidTags(renderMarkdownServer(FIXTURE));

    expect(server).toBe(preview);
    // 防止两边同时退化为“什么都不过滤”
    expect(server).not.toContain("onclick");
    expect(server).not.toContain("<script");
    expect(server).not.toContain("<iframe");
    expect(server).not.toContain("javascript:");
    expect(server).toContain('data-extra="x"');
    expect(server).toContain('aria-label="raw"');
  });

  it.each(RAW_HTML_PARITY_CASES)("边界原始 HTML 与后台预览一致：%s", (raw) => {
    const preview = normalizeVoidTags(renderMarkdown(raw));
    const server = normalizeVoidTags(renderMarkdownServer(raw));

    expect(server).toBe(preview);
  });
});

/**
 * T4 #65：回写守卫实际使用的是 `renderMarkdown`（DOMPurify），与线上预览
 * 同一管线。这里用真实渲染器（非 stub）钉住「语义等价放行 / 有损拦下」，
 * 并确认守卫的规范化与上面 parity 测试的 void 标签归一化口径一致。
 */
describe("回写守卫消费后台预览的同一渲染管线", () => {
  const ORIGINAL = [
    "| 列 A | 列 B |",
    "| --- | --- |",
    "| 中文 | 1 |",
    "",
    "![站点封面](/media/cover.png)",
    "",
    '<a href="https://example.com/embed" data-embed="1">内嵌网页预览</a>',
  ].join("\n");

  it("守卫的规范化让两种消毒器的输出可比较，且 void 标签已归一", () => {
    const preview = normalizeRenderedHtml(renderMarkdown(ORIGINAL));
    const server = normalizeRenderedHtml(renderMarkdownServer(ORIGINAL));
    expect(server).toBe(preview);
    expect(preview).toContain('<img src="/media/cover.png" alt="站点封面">');
    // parity 测试自己的 void 标签归一化是同一条规则的子集。
    expect(normalizeVoidTags('<img src="a" />')).toBe('<img src="a">');
  });

  it("原文自往返在 DOMPurify 与 sanitize-html 两侧都判 safe", () => {
    expect(classifyMarkdown(ORIGINAL, ORIGINAL, renderMarkdown).kind).toBe(
      "safe"
    );
    expect(
      classifyMarkdown(ORIGINAL, ORIGINAL, renderMarkdownServer).kind
    ).toBe("safe");
  });

  it("语义等价但字节不同的改写判 safe（表格分隔线 / 列表标记）", () => {
    const original = "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- 第一项";
    const normalized = "| A | B |\n| - | - |\n| 1 | 2 |\n\n* 第一项";
    expect(original).not.toBe(normalized);
    expect(classifyMarkdown(original, normalized, renderMarkdown).kind).toBe(
      "safe"
    );
    expect(
      classifyMarkdown(original, normalized, renderMarkdownServer).kind
    ).toBe("safe");
  });

  it("image-block 默认装配的 alt 改写与 embed 退化都在两侧判 lossy", () => {
    const cases: [string, string][] = [
      ["![站点封面](/media/cover.png)", "![1.00](/media/cover.png)"],
      [
        '<a href="https://example.com/embed" data-embed="1">内嵌网页预览</a>',
        "[内嵌网页预览](https://example.com/embed)",
      ],
    ];
    for (const [original, normalized] of cases) {
      expect(classifyMarkdown(original, normalized, renderMarkdown).kind).toBe(
        "lossy"
      );
      expect(
        classifyMarkdown(original, normalized, renderMarkdownServer).kind
      ).toBe("lossy");
    }
  });
});
