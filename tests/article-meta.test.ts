// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  buildArticleMeta,
  buildArticlePageMeta,
} from "../src/utils/articleMeta";
import type { ArticleDetail } from "../src/utils/articleServer";

/**
 * #39 / #36：文章详情页每篇独立的 SEO / 分享元信息。
 *
 * 只测纯函数的外部行为：给定文章与站点，得到 head 需要的 title / description /
 * canonical / OG 字段；summary 缺失时从正文 Markdown 提取纯文本摘录。
 */

const baseArticle: ArticleDetail = {
  id: 7,
  title: "服务端渲染实践",
  slug: "服务端 渲染",
  content: "# 标题\n\n正文",
  summary: "摘要",
  cover_image: "/images/封面.png",
  category: { id: 1, name: "技术", slug: "tech" },
  tags: [{ id: 2, name: "Astro", slug: "astro" }],
  status: "published",
  view_count: 3,
  like_count: 4,
  reading_time: 2,
  published_at: "2026-10-22T00:00:00.000Z",
};

const siteUrl = "https://blog.example.test";

describe("文章 SEO 元信息", () => {
  it("title 带站点标题，description 优先取 summary，canonical 编码中文 slug", () => {
    const meta = buildArticleMeta(
      { ...baseArticle, summary: "  文章摘要  " },
      { siteUrl }
    );

    expect(meta.title).toBe("服务端渲染实践 | Blog");
    expect(meta.description).toBe("文章摘要");
    expect(meta.canonicalUrl).toBe(
      "https://blog.example.test/articles/%E6%9C%8D%E5%8A%A1%E7%AB%AF%20%E6%B8%B2%E6%9F%93"
    );
    expect(meta.publishedTime).toBe("2026-10-22T00:00:00.000Z");
  });

  it("站点标题可由 SSR 配置覆盖", () => {
    const meta = buildArticleMeta(baseArticle, {
      siteUrl,
      siteTitle: " My Blog ",
    });

    expect(meta.title).toBe("服务端渲染实践 | My Blog");
  });

  it("不同文章得到不同的 title 与 canonical", () => {
    const first = buildArticleMeta(
      { ...baseArticle, title: "第一篇文章", slug: "第一篇" },
      { siteUrl }
    );
    const second = buildArticleMeta(
      { ...baseArticle, title: "第二篇文章", slug: "第二篇" },
      { siteUrl }
    );

    expect(first.title).not.toBe(second.title);
    expect(first.canonicalUrl).not.toBe(second.canonicalUrl);
  });

  it("相对封面绝对化，og:image 使用站点域名", () => {
    const meta = buildArticleMeta(baseArticle, { siteUrl });

    expect(meta.ogImage).toBe(
      "https://blog.example.test/images/%E5%B0%81%E9%9D%A2.png"
    );
  });

  it("已是绝对 URL 的封面保持不变", () => {
    const meta = buildArticleMeta(
      { ...baseArticle, cover_image: "https://cdn.example.test/cover.png" },
      { siteUrl }
    );

    expect(meta.ogImage).toBe("https://cdn.example.test/cover.png");
  });

  it("缺封面时省略 og:image", () => {
    const meta = buildArticleMeta(
      { ...baseArticle, cover_image: "" },
      { siteUrl }
    );

    expect(meta.ogImage).toBeUndefined();
  });

  it("封面不是 http(s) URL 时省略 og:image", () => {
    const meta = buildArticleMeta(
      { ...baseArticle, cover_image: "javascript:alert(1)" },
      { siteUrl }
    );

    expect(meta.ogImage).toBeUndefined();
  });

  it("summary 为空时回退到正文摘录，并去掉 Markdown / HTML", () => {
    const meta = buildArticleMeta(
      {
        ...baseArticle,
        summary: "   ",
        content: [
          "# 服务端渲染",
          "",
          "**加粗** 与 [链接](https://example.com/post) & <span>行内 HTML</span>",
          "",
          "<script>alert(1)</script>",
          "",
          "## 第二段",
          "",
          "- 列表一",
          "- 列表二",
        ].join("\n"),
      },
      { siteUrl }
    );

    expect(meta.description).toBe(
      "服务端渲染 加粗 与 链接 & 行内 HTML 第二段 列表一 列表二"
    );
    expect(meta.description).not.toContain("#");
    expect(meta.description).not.toContain("**");
    expect(meta.description).not.toContain("<span>");
    expect(meta.description).not.toContain("&amp;");
  });

  it("正文摘录最多 160 个字符", () => {
    const meta = buildArticleMeta(
      { ...baseArticle, summary: "", content: "字".repeat(200) },
      { siteUrl }
    );

    expect(Array.from(meta.description)).toHaveLength(160);
    expect(meta.description).toBe("字".repeat(160));
  });

  it("按 Unicode 码点截断，不把 emoji 切成半个", () => {
    const meta = buildArticleMeta(
      { ...baseArticle, summary: "", content: "😀".repeat(200) },
      { siteUrl }
    );

    expect(Array.from(meta.description)).toHaveLength(160);
  });

  it("summary 与正文都为空时 description 回退到标题", () => {
    const meta = buildArticleMeta(
      { ...baseArticle, summary: "   ", content: "   " },
      { siteUrl }
    );

    expect(meta.description).toBe("服务端渲染实践");
  });

  it("published_at 缺失时不输出发布时间", () => {
    const meta = buildArticleMeta(
      { ...baseArticle, published_at: null },
      { siteUrl }
    );

    expect(meta.publishedTime).toBeUndefined();
  });
});

describe("文章页 head 元信息", () => {
  it("成功取到文章时 og:type=article，并带 canonical / 发布时间", () => {
    const meta = buildArticlePageMeta(
      { status: "ok", article: baseArticle, setCookies: [] },
      { siteUrl }
    );

    expect(meta.ogType).toBe("article");
    expect(meta.canonicalUrl).toBe(
      "https://blog.example.test/articles/%E6%9C%8D%E5%8A%A1%E7%AB%AF%20%E6%B8%B2%E6%9F%93"
    );
    expect(meta.publishedTime).toBe("2026-10-22T00:00:00.000Z");
  });

  it("未找到与加载失败各有独立 title / description，og:type=website", () => {
    const notFound = buildArticlePageMeta({ status: "not-found" }, { siteUrl });
    const failed = buildArticlePageMeta({ status: "error" }, { siteUrl });

    expect(notFound.ogType).toBe("website");
    expect(failed.ogType).toBe("website");
    expect(notFound.title).not.toBe(failed.title);
    expect(notFound.description).not.toBe("");
    expect(failed.description).not.toBe("");
  });
});
