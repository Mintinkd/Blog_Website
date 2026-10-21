// @vitest-environment node

import { describe, expect, it } from "vitest";
import { renderMarkdownServer } from "../src/utils/markdownServer";

/**
 * #37 / #36：文章正文服务端渲染器。
 *
 * 运行在 node 环境（非 jsdom）即证明渲染器不依赖浏览器 DOM 全局，
 * 与 Workers 运行时一致；消毒口径由 markdownPolicy 与后台预览共享。
 */

describe("文章正文服务端渲染器", () => {
  it("保留标题 / 列表 / 表格 / 围栏代码 / 图片 / 链接", () => {
    const html = renderMarkdownServer(
      [
        "# 标题",
        "",
        "- 第一项",
        "- 第二项",
        "",
        "| 列 A | 列 B |",
        "| ---- | ---- |",
        "| 1    | 2    |",
        "",
        "```ts",
        "const x = 1 < 2;",
        "```",
        "",
        "![封面](/images/cover.png)",
        "",
        "[链接](https://example.com/post)",
      ].join("\n")
    );

    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>第一项</li>");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>列 A</th>");
    expect(html).toContain("<td>1</td>");
    expect(html).toContain('<pre><code class="language-ts">');
    expect(html).toContain("const x = 1 &lt; 2;");
    expect(html).toContain('<img src="/images/cover.png" alt="封面"');
    expect(html).toContain('<a href="https://example.com/post">链接</a>');
  });

  it("剥除 script / style / iframe / object / embed / form 标签", () => {
    const html = renderMarkdownServer(
      [
        "<script>alert(1)</script>",
        "",
        "<style>body { display: none; }</style>",
        "",
        '<iframe src="https://evil.example/frame"></iframe>',
        "",
        '<object data="https://evil.example/object"></object>',
        "",
        '<embed src="https://evil.example/embed">',
        "",
        '<form action="https://evil.example"><input name="q"></form>',
      ].join("\n")
    );

    expect(html).not.toMatch(/<(script|style|iframe|object|embed|form)\b/i);
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("display: none");
  });

  it("剥除 on* 事件属性，保留白名单属性", () => {
    const html = renderMarkdownServer(
      [
        '<img src="/images/x.png" alt="x" onerror="alert(1)">',
        "",
        '<p onclick="alert(1)" class="note" id="n">正文</p>',
      ].join("\n")
    );

    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).toContain('<p class="note" id="n">正文</p>');
  });

  it("剥除 javascript: 与 data:text/html 链接", () => {
    const html = renderMarkdownServer(
      [
        '<a href="javascript:alert(1)">js</a>',
        "",
        '<a href="data:text/html,%3Cb%3Ex%3C/b%3E">data</a>',
        "",
        '<a href="vbscript:msgbox(1)">vb</a>',
        "",
        '<img src="javascript:alert(1)" alt="bad">',
      ].join("\n")
    );

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text/html");
    expect(html).not.toContain("vbscript:");
    expect(html).toContain("<a>js</a>");
    expect(html).toContain("<a>data</a>");
  });

  it("丢弃 iframe / template / 媒体子树文本，保留 textarea / option 文本", () => {
    const html = renderMarkdownServer(
      [
        '<iframe src="https://evil.example/frame">iframe fallback</iframe>',
        "",
        "<template><p>template fallback</p></template>",
        "",
        "<audio>audio fallback</audio>",
        "",
        "<video>video fallback</video>",
        "",
        "<title>title fallback</title>",
        "",
        "<svg><text>svg fallback</text></svg>",
        "",
        "<textarea>textarea text</textarea>",
        "",
        "<option>option text</option>",
      ].join("\n")
    );

    expect(html).not.toContain("fallback");
    expect(html).toContain("textarea text");
    expect(html).toContain("option text");
  });

  it("对 target / rel 执行 URL scheme 校验，安全值保留", () => {
    const html = renderMarkdownServer(
      [
        '<a href="https://example.com" target="javascript:alert(1)" rel="javascript:alert(1)">bad</a>',
        "",
        '<a href="https://example.com" target="_blank" rel="noopener noreferrer">good</a>',
      ].join("\n")
    );

    expect(html).toContain('<a href="https://example.com">bad</a>');
    expect(html).not.toContain("javascript:");
    expect(html).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">good</a>'
    );
  });

  it("保留安全的原始 HTML（class/id/span）", () => {
    const html = renderMarkdownServer(
      '<div class="note" id="note">原始 <span>HTML</span></div>'
    );

    expect(html).toContain('<div class="note" id="note">');
    expect(html).toContain("<span>HTML</span>");
  });

  it("丢弃与 document / form 属性同名的 id（DOM clobbering）", () => {
    const html = renderMarkdownServer(
      [
        '<div id="body">body</div>',
        '<div id="forms">forms</div>',
        '<div id="cookie">cookie</div>',
        '<div id="createElement">createElement</div>',
        '<div id="onclick">onclick</div>',
        '<div id="section-1">safe</div>',
      ].join("")
    );

    expect(html).not.toContain('id="body"');
    expect(html).not.toContain('id="forms"');
    expect(html).not.toContain('id="cookie"');
    expect(html).not.toContain('id="createElement"');
    expect(html).not.toContain('id="onclick"');
    expect(html).toContain('id="section-1"');
  });
});
