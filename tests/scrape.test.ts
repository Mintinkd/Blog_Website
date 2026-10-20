import { describe, expect, it } from "vitest";
import {
  buildScrapeDraft,
  ScrapeSelectorError,
  type ScrapeSelectorErrorCode,
} from "../src/utils/scrape";

/**
 * #33 / #34：抓取管线的提取与转换接缝（HTML + final URL → 标题 + Markdown）。
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
        <p>Intro text with <strong>bold</strong>, <em>italic</em> and <code>inline()</code>.</p>
        <h2>Section One</h2>
        <ol>
          <li>First step</li>
          <li>Second step</li>
        </ol>
        <ul>
          <li>First item</li>
          <li>Second item</li>
        </ul>
        <blockquote><p>A short quote.</p></blockquote>
        <pre><code class="language-js">const answer = 42;</code></pre>
        <table>
          <thead><tr><th>Name</th><th>Value</th></tr></thead>
          <tbody><tr><td>Alpha</td><td>1</td></tr></tbody>
        </table>
        <figure>
          <img src="/img/cover.png" alt="Cover" />
          <figcaption>A cover image</figcaption>
        </figure>
        <p><a href="/deep/post">deep link</a></p>
      </article>
    </main>
    <aside>Related posts</aside>
    <footer>Copyright 2026</footer>
  </body>
</html>`;

function selectorErrorCode(run: () => unknown): ScrapeSelectorErrorCode {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ScrapeSelectorError);
    return (error as ScrapeSelectorError).code;
  }
  throw new Error("expected buildScrapeDraft to throw ScrapeSelectorError");
}

describe("buildScrapeDraft", () => {
  it("提取标题与正文 Markdown，并丢弃导航/页脚等页面噪声", () => {
    const draft = buildScrapeDraft(
      ARTICLE_HTML,
      "https://publisher.example/article"
    );

    expect(draft.title).toBe("How to Build a Scraper");
    expect(draft.markdown).toContain("**bold**");
    expect(draft.markdown).toContain("*italic*");
    expect(draft.markdown).toContain("`inline()`");
    expect(draft.markdown).toContain("## Section One");
    expect(draft.markdown).toMatch(/1\. +First step/);
    expect(draft.markdown).toMatch(/- +First item/);
    expect(draft.markdown).toContain("> A short quote.");
    // 围栏代码带语言标注
    expect(draft.markdown).toContain("```js");
    expect(draft.markdown).toContain("const answer = 42;");
    // GFM 表格
    expect(draft.markdown).toContain("| Name | Value |");
    // 图片保留 alt 并绝对化
    expect(draft.markdown).toContain(
      "![Cover](https://publisher.example/img/cover.png)"
    );
    expect(draft.markdown).toContain("(https://publisher.example/deep/post)");
    expect(draft.markdown).not.toContain("Home | About | Contact");
    expect(draft.markdown).not.toContain("Related posts");
    expect(draft.markdown).not.toContain("Copyright 2026");
    // Readability 把标题收进 title，正文不再重复 H1
    expect(draft.markdown).not.toContain("# How to Build a Scraper");
    expect(draft.warnings).toEqual([]);
    expect(draft.images).toEqual({ total: 1, unresolved: 0 });
  });

  it("selector 命中时只转换所选子树（Readability 仅提供标题）", () => {
    const html = `<!doctype html>
<html><head><title>Page Title</title></head>
<body>
  <nav>Site menu</nav>
  <div class="post"><h1>Selected Title</h1><p>Inside content.</p></div>
  <div class="noise"><p>Outside content.</p></div>
</body></html>`;

    const draft = buildScrapeDraft(html, "https://publisher.example/post", {
      selector: ".post",
    });

    expect(draft.title).toBe("Selected Title");
    expect(draft.markdown).toContain("Inside content.");
    expect(draft.markdown).not.toContain("Outside content.");
    expect(draft.markdown).not.toContain("Site menu");
    // 正文 H1 与标题同名时去重（脚注里的标题不算正文重复）
    expect(draft.markdown).not.toContain("# Selected Title");
    expect(draft.warnings).toEqual([]);
  });

  it("selector 多个命中按文档顺序拼接", () => {
    const html = `<!doctype html>
<html><head><title>Chunks</title></head>
<body>
  <div class="chunk"><p>First chunk</p></div>
  <div class="chunk"><p>Second chunk</p></div>
  <div class="chunk"><p>Third chunk</p></div>
</body></html>`;

    const draft = buildScrapeDraft(html, "https://publisher.example/post", {
      selector: ".chunk",
    });

    expect(draft.markdown).toContain("First chunk");
    expect(draft.markdown).toContain("Second chunk");
    expect(draft.markdown).toContain("Third chunk");
    expect(draft.markdown.indexOf("First chunk")).toBeLessThan(
      draft.markdown.indexOf("Second chunk")
    );
    expect(draft.markdown.indexOf("Second chunk")).toBeLessThan(
      draft.markdown.indexOf("Third chunk")
    );
  });

  it("selector 未命中 / 语法无效时抛出可区分的错误", () => {
    const miss = selectorErrorCode(() =>
      buildScrapeDraft(ARTICLE_HTML, "https://publisher.example/article", {
        selector: "#does-not-exist",
      })
    );
    expect(miss).toBe("selector_no_match");

    const invalid = selectorErrorCode(() =>
      buildScrapeDraft(ARTICLE_HTML, "https://publisher.example/article", {
        selector: "article[",
      })
    );
    expect(invalid).toBe("selector_invalid");
  });

  it("Readability 识别不出正文时回退 <body> 并给 no_article 警告", () => {
    // hidden 子树不会进入 Readability，但仍在 <body> 里，用于验证回退内容；
    // 页面标题应优先于回退内容里的导航/Logo H1
    const html = `<!doctype html>
<html><head><title>App Shell</title></head>
<body>
  <h1 hidden>Site Name</h1>
  <div id="app" hidden><p>Fallback body text</p></div>
</body></html>`;

    const draft = buildScrapeDraft(html, "https://publisher.example/app");

    expect(draft.warnings).toContain("no_article");
    expect(draft.markdown).toContain("Fallback body text");
    expect(draft.title).toBe("App Shell");
  });

  it("selector 命中表格行时保留单元格与表头上下文", () => {
    const html = `<!doctype html>
<html><head><title>Table</title></head>
<body><table>
  <thead><tr><th>Name</th><th>Value</th></tr></thead>
  <tbody>
    <tr><td>Alpha</td><td>1</td></tr>
    <tr><td>Beta</td><td>2</td></tr>
  </tbody>
</table></body></html>`;

    const draft = buildScrapeDraft(html, "https://publisher.example/table", {
      selector: "tbody tr",
    });

    // 表头不来自命中行，但作为 GFM 表格结构上下文一并保留
    expect(draft.markdown).toContain("| Name | Value |");
    expect(draft.markdown).toContain("| Alpha | 1 |");
    expect(draft.markdown).toContain("| Beta | 2 |");

    // 命中全部 tr（含表头）时不能再补一遍 thead
    const allRows = buildScrapeDraft(html, "https://publisher.example/table", {
      selector: "tr",
    });
    expect(allRows.markdown.match(/\| Name \| Value \|/g)).toHaveLength(1);
    expect(allRows.markdown).toContain("| Alpha | 1 |");
  });

  it("统计正文图片数量，并标记缺少可用地址的图片", () => {
    const html = `<!doctype html>
<html><head><title>Gallery</title></head>
<body><div class="gallery">
  <img src="/img/ok.png" alt="ok" />
  <img src="data:image/png;base64,AAAA" alt="inline" />
  <img alt="no source" />
  <img src="/img/no-alt.png" />
</div></body></html>`;

    const draft = buildScrapeDraft(html, "https://publisher.example/post", {
      selector: ".gallery",
    });

    expect(draft.images).toEqual({
      total: 4,
      unresolved: 2,
    });
    expect(draft.markdown).toContain(
      "![ok](https://publisher.example/img/ok.png)"
    );
    expect(draft.markdown).not.toContain("data:");
  });
});

const METADATA_HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Title Tag</title>
    <meta name="description" content="Meta <b>description</b> for the draft." />
    <meta property="og:description" content="OG description should lose." />
    <meta property="og:image" content="/images/cover.jpg" />
    <meta name="keywords" content="TypeScript, Rust，Web" />
  </head>
  <body>
    <article>
      <h1>A Complete Article</h1>
      <p>Body paragraph with enough words for Readability to keep it.</p>
      <a rel="tag">Web</a>
      <a rel="tag">Go</a>
    </article>
  </body>
</html>`;

describe("buildScrapeDraft 元数据", () => {
  it("映射标题、摘要、封面、标签、slug、分类与状态", () => {
    const draft = buildScrapeDraft(
      METADATA_HTML,
      "https://publisher.example/article",
      { existingTags: ["TypeScript", "Web"] }
    );

    expect(draft.title).toBe("Title Tag");
    expect(draft.summary).toBe("Meta description for the draft.");
    expect(draft.coverImage).toBe("https://publisher.example/images/cover.jpg");
    expect(draft.tags).toEqual(["TypeScript", "Web"]);
    expect(draft.slug).toBe("");
    expect(draft.categoryId).toBe(1);
    expect(draft.status).toBe("draft");
  });

  it("摘要回退正文前 120 字，封面缺失时留空", () => {
    const longText = "A".repeat(130);
    const html = `<!doctype html>
<html><head><title>Fallback Summary</title></head>
<body><article><h1>Fallback Summary</h1><p>${longText}</p></article></body></html>`;

    const draft = buildScrapeDraft(html, "https://publisher.example/post");

    expect(draft.summary).toBe("A".repeat(120));
    expect(draft.coverImage).toBe("");
  });

  it("标题按 og:title → <title> 回退", () => {
    const html = `<!doctype html>
<html><head>
  <meta property="og:title" content="OG Title" />
  <title>Title Tag</title>
</head><body><h1 hidden>Site</h1></body></html>`;

    const withOg = buildScrapeDraft(html, "https://publisher.example/post");
    expect(withOg.title).toBe("OG Title");

    const titleOnly = html.replace(
      '<meta property="og:title" content="OG Title" />',
      ""
    );
    expect(
      buildScrapeDraft(titleOnly, "https://publisher.example/post").title
    ).toBe("Title Tag");
  });

  it("标签只保留已有标签，未匹配的丢弃且不创建新标签", () => {
    const draft = buildScrapeDraft(
      METADATA_HTML,
      "https://publisher.example/article",
      { existingTags: ["TypeScript", "Web"] }
    );
    expect(draft.tags).toEqual(["TypeScript", "Web"]);

    const noExisting = buildScrapeDraft(
      METADATA_HTML,
      "https://publisher.example/article"
    );
    expect(noExisting.tags).toEqual([]);
  });

  it("追加来源脚注，转义标题中的 ]，抓取日期可注入", () => {
    const html = `<!doctype html>
<html><head><title>A [Draft] Title</title></head>
<body><article><h1>A [Draft] Title</h1><p>Body text for the footnote.</p></article></body></html>`;

    const draft = buildScrapeDraft(
      html,
      "https://publisher.example/source?x=1",
      { scrapedAt: new Date(2026, 9, 20) }
    );

    expect(draft.markdown).toContain(
      "---\n\n> 原文：[A [Draft\\] Title](https://publisher.example/source?x=1)（抓取于 2026-10-20）"
    );
  });

  it("标题为空时脚注链接文字回退为 final URL", () => {
    const html = `<!doctype html>
<html><head></head><body><div hidden>Fallback body</div></body></html>`;

    const draft = buildScrapeDraft(html, "https://publisher.example/no-title", {
      scrapedAt: new Date(2026, 9, 20),
    });

    expect(draft.title).toBe("");
    expect(draft.markdown).toContain(
      "> 原文：[https://publisher.example/no-title](https://publisher.example/no-title)（抓取于 2026-10-20）"
    );
  });

  it("CJK 字数按汉字逐字、拉丁文按词统计", () => {
    const html = `<!doctype html>
<html><head><title>字数</title></head>
<body><div class="content"><p>中文内容 Hello world</p></div></body></html>`;

    const draft = buildScrapeDraft(html, "https://publisher.example/post", {
      selector: ".content",
    });

    expect(draft.wordCount).toBe(6);
  });
});
