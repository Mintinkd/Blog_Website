// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  renderArticleCard,
  renderArticleCardList,
} from "../src/utils/articleCard";

/**
 * issue #81 §7（taxonomy v2）：共享文章卡片渲染器行为基线。
 * 期望值均为手写字面量，不从被测函数反推。
 */

const baseArticle = {
  slug: "hello-world",
  title: "你好<script>alert(1)</script>世界",
  summary: "这是<b>摘要</b>",
  category: { id: 1, name: "技术&前端", slug: "tech" },
  tags: [
    { name: "Vue", slug: "vue", category: { name: "前端", slug: "frontend" } },
    {
      name: "Node",
      slug: "node",
      category: { name: "技术&前端", slug: "tech" },
    },
    { name: "Go", slug: "go", category: null },
    {
      name: "Rust",
      slug: "rust",
      category: { name: "前端", slug: "frontend" },
    },
  ],
  view_count: 12,
  published_at: "2026-06-15T08:00:00.000Z",
};

describe("renderArticleCard — list 变体（列表页契约）", () => {
  it("整卡可点：文章链接只挂在标题上，卡片外层不再是 <a>（整卡 <a> 会与 badge/chip 形成嵌套链接）", () => {
    const html = renderArticleCard(baseArticle, {
      variant: "list",
      readLabel: "阅读",
    });
    expect(html).toContain(
      '<a href="/articles/hello-world" class="list-card-title-link">'
    );
    // 外层包装是普通容器：整卡点击交给标题链接的 ::after 覆盖层
    expect(html).toContain('<div class="list-card-inner">');
    expect(html).not.toContain('class="list-card-link"');
    expect(html).not.toContain(
      'href="/articles/hello-world" class="list-card-link"'
    );
  });

  it("标签恒为分类筛选页链接（无分类回退 /tags/:slug）；分类 badge 恒为 <a href='/categories/:slug'>", () => {
    const html = renderArticleCard(baseArticle, {
      variant: "list",
      readLabel: "阅读",
    });
    expect(html).toContain('<a href="/categories/frontend?tag=vue"');
    expect(html).toContain('<a href="/categories/tech?tag=node"');
    expect(html).toContain('<a href="/tags/go"');
    expect(html).toContain(
      '<a href="/categories/tech" class="list-card-category">'
    );
    // 危险字符转义
    expect(html).toContain("你好&lt;script&gt;alert(1)&lt;/script&gt;世界");
    expect(html).not.toContain("<script>");
    expect(html).toContain("技术&amp;前端");
    expect(html).not.toContain("技术&前端</a>");
  });

  it("标签 title 带所属分类（belongsLabel 前缀）；跨分类标签 data-cross-category=1", () => {
    const html = renderArticleCard(baseArticle, {
      variant: "list",
      belongsLabel: "分类：",
    });
    // Vue 属于「前端」而文章属于「技术&前端」→ 跨分类
    expect(html).toContain(
      'href="/categories/frontend?tag=vue" class="list-card-tag" title="分类：前端" data-cross-category="1"'
    );
    // Node 与文章同类 → 无跨分类标记，但 title 仍带分类
    expect(html).toContain(
      'href="/categories/tech?tag=node" class="list-card-tag" title="分类：技术&amp;前端">'
    );
    expect(html).not.toContain(
      'title="分类：技术&amp;前端" data-cross-category'
    );
    // 无分类标签（迁移期）：无 title、无跨分类标记
    expect(html).toContain('<a href="/tags/go" class="list-card-tag">');
    expect(html).not.toContain('href="/tags/go" title=');
  });

  it("tagLimit 裁剪标签数量", () => {
    const html = renderArticleCard(baseArticle, {
      variant: "list",
      tagLimit: 2,
    });
    expect(html).toContain('href="/categories/frontend?tag=vue"');
    expect(html).toContain('href="/categories/tech?tag=node"');
    expect(html).not.toContain('href="/tags/go"');
  });

  it("dateLocale 生效（zh-CN 长日期 / en-US 英文月名）", () => {
    const zh = renderArticleCard(baseArticle, {
      variant: "list",
      dateLocale: "zh-CN",
    });
    expect(zh).toContain("2026年6月15日");
    const en = renderArticleCard(baseArticle, {
      variant: "list",
      dateLocale: "en-US",
    });
    expect(en).toContain("June 15, 2026");
  });

  it("readLabel 进入阅读数文案；无 published_at 时空日期", () => {
    const html = renderArticleCard(baseArticle, {
      variant: "list",
      readLabel: "阅读",
    });
    expect(html).toContain("12 阅读");
    const noDate = renderArticleCard(
      { ...baseArticle, published_at: null },
      { variant: "list" }
    );
    expect(noDate).toContain('<span class="list-card-date"></span>');
  });
});

describe("renderArticleCard — cover 变体（首页大卡契约）", () => {
  it("整卡可点：标题链接带 card-title-link，标题裁切移到内层 span（链接本身不能 overflow）", () => {
    const html = renderArticleCard(baseArticle, { variant: "cover" });
    expect(html).toContain(
      '<a href="/articles/hello-world" class="card-title-link"><span class="card-title-text">'
    );
    expect(html).not.toContain('class="card-link"');
  });

  it("有封面时输出 <img>；无封面时输出渐变横幅 + 分类名；标题/摘要转义", () => {
    const withCover = renderArticleCard(
      { ...baseArticle, cover_image: "https://img.example/a.png?x=1&y=2" },
      { variant: "cover", tagLimit: 2, readLabel: "阅读" }
    );
    expect(withCover).toContain('class="card-cover"');
    expect(withCover).toContain("https://img.example/a.png?x=1&amp;y=2");
    expect(withCover).toContain('href="/categories/frontend?tag=vue"');
    expect(withCover).not.toContain('href="/tags/go"');

    const withGrad = renderArticleCard(
      { ...baseArticle, cover_image: "" },
      { variant: "cover" }
    );
    expect(withGrad).toContain("card-cover-grad");
    expect(withGrad).toContain("cover-cat-name");
  });
});

describe("renderArticleCardList — 空态与批量", () => {
  it("空列表 → 空态文案（转义）", () => {
    const html = renderArticleCardList([], {
      variant: "list",
      noArticlesLabel: "暂无<b>文章",
    });
    expect(html).toContain("暂无&lt;b&gt;文章");
    expect(html).not.toContain("<b>文章");
  });

  it("非空列表逐张渲染", () => {
    const html = renderArticleCardList(
      [
        { ...baseArticle, slug: "a" },
        { ...baseArticle, slug: "b" },
      ],
      { variant: "list" }
    );
    expect(html).toContain('href="/articles/a"');
    expect(html).toContain('href="/articles/b"');
  });
});
