import { describe, expect, it } from "vitest";
import { buildScrapeDraft } from "../src/utils/scrape";

/**
 * #33：抓取管线的基础接缝（HTML + final URL → 标题 + Markdown）。
 * 使用静态 HTML fixture 与原生 DOMParser（jsdom），不依赖真实站点。
 */

const ARTICLE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Fallback Title</title>
  </head>
  <body>
    <header><nav>Home | About | Contact</nav></header>
    <main>
      <article>
        <h1>How to Build a Scraper</h1>
        <p>Intro text with <strong>bold</strong> and <em>italic</em>.</p>
        <h2>Section One</h2>
        <ul>
          <li>First item</li>
          <li>Second item</li>
        </ul>
        <blockquote>A short quote.</blockquote>
        <pre><code class="language-js">const answer = 42;</code></pre>
        <table>
          <thead><tr><th>Name</th><th>Value</th></tr></thead>
          <tbody><tr><td>Alpha</td><td>1</td></tr></tbody>
        </table>
      </article>
    </main>
    <aside>Related posts</aside>
    <footer>Copyright 2026</footer>
  </body>
</html>`;

describe("buildScrapeDraft", () => {
  it("提取标题与正文 Markdown，并丢弃导航/页脚等页面噪声", () => {
    const draft = buildScrapeDraft(
      ARTICLE_HTML,
      "https://publisher.example/article"
    );

    expect(draft.title).toBe("How to Build a Scraper");
    expect(draft.markdown).toContain("**bold**");
    expect(draft.markdown).toContain("*italic*");
    expect(draft.markdown).toContain("## Section One");
    expect(draft.markdown).toMatch(/- +First item/);
    expect(draft.markdown).toContain("> A short quote.");
    expect(draft.markdown).toContain("```");
    expect(draft.markdown).toContain("| Name | Value |");
    expect(draft.markdown).not.toContain("Home | About | Contact");
    expect(draft.markdown).not.toContain("Related posts");
    expect(draft.markdown).not.toContain("Copyright 2026");
    // Readability 把标题收进 title，正文不再重复 H1
    expect(draft.markdown).not.toContain("# How to Build a Scraper");
    expect(draft.warnings).toEqual([]);
  });
});
