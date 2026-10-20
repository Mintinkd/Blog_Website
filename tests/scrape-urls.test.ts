import { describe, expect, it } from "vitest";
import { buildScrapeDraft } from "../src/utils/scrape";

/**
 * #33 / #34：抓取管线的地址处理接缝——相对 URL 基准、危险 scheme 剥除、
 * iframe/embed/object 的安全降级。fixture 全部是静态 HTML。
 */

const FINAL_URL = "https://publisher.example/a/b";

describe("URL 解析与嵌入降级", () => {
  it("相对链接与图片按 final URL 解析成绝对地址", () => {
    const html = `<!doctype html>
<html><head><title>Links</title></head>
<body><article>
  <h1>Links</h1>
  <p><a href="/deep/post">relative link</a> and <a href="mailto:hi@example.com">mail</a>.</p>
  <p><a href="//cdn.example/lib">protocol relative</a></p>
  <p><img src="/img/cover.png" alt="cover"></p>
</article></body></html>`;

    const draft = buildScrapeDraft(html, FINAL_URL);

    expect(draft.markdown).toContain("(https://publisher.example/deep/post)");
    expect(draft.markdown).toContain("(mailto:hi@example.com)");
    expect(draft.markdown).toContain("(https://cdn.example/lib)");
    expect(draft.markdown).toContain(
      "(https://publisher.example/img/cover.png)"
    );
  });

  it("页面自带 <base href> 时优先按 base 解析", () => {
    const html = `<!doctype html>
<html>
<head>
  <title>Base URL</title>
  <base href="https://cdn.example/assets/" />
</head>
<body><article>
  <h1>Base URL</h1>
  <p><a href="guide.html">guide</a></p>
  <p><img src="pic.png" alt="pic"></p>
</article></body></html>`;

    const draft = buildScrapeDraft(html, FINAL_URL);

    expect(draft.markdown).toContain("(https://cdn.example/assets/guide.html)");
    expect(draft.markdown).toContain("(https://cdn.example/assets/pic.png)");
  });

  it("javascript:/data:/vbscript: 等危险协议被剥除，不进入草稿", () => {
    const html = `<!doctype html>
<html><head><title>Unsafe</title></head>
<body><article>
  <h1>Unsafe</h1>
  <p><a href="javascript:alert(1)">click me</a></p>
  <p><a href="data:text/html,%3Cb%3Ex%3C/b%3E">data link</a></p>
  <p><a href="vbscript:msgbox(1)">vb link</a></p>
  <p><img src="vbscript:msgbox(1)" alt="bad"></p>
</article></body></html>`;

    const draft = buildScrapeDraft(html, "https://publisher.example/post");

    expect(draft.markdown).toContain("click me");
    expect(draft.markdown).not.toContain("javascript:");
    expect(draft.markdown).not.toContain("data:");
    expect(draft.markdown).not.toContain("vbscript:");
  });

  it("iframe/embed/object 安全时降级为链接，危险时整体丢弃", () => {
    const html = `<!doctype html>
<html><head><title>Embeds</title></head>
<body><article>
  <h1>Embeds</h1>
  <iframe src="https://www.youtube.com/embed/abc" title="Demo video"></iframe>
  <iframe src="javascript:alert(1)"></iframe>
  <embed src="data:text/html,%3Cb%3Ex%3C/b%3E" />
  <object data="https://charts.example/chart.svg"></object>
  <p>After embeds.</p>
</article></body></html>`;

    const draft = buildScrapeDraft(html, "https://publisher.example/post");

    expect(draft.markdown).toContain(
      "[Demo video](https://www.youtube.com/embed/abc)"
    );
    expect(draft.markdown).toContain(
      "[https://charts.example/chart.svg](https://charts.example/chart.svg)"
    );
    expect(draft.markdown).toContain("After embeds.");
    expect(draft.markdown).not.toContain("javascript:");
    expect(draft.markdown).not.toContain("data:text/html");
    expect(draft.markdown).not.toContain("<iframe");
    expect(draft.markdown).not.toContain("<embed");
    expect(draft.markdown).not.toContain("<object");
  });
});
