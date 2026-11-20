// @vitest-environment node
// issue #69 / T8 阶段4：ScrapePanel / AnalyticsPanel 的纯逻辑接缝。
// 期望值均为手写字面量，不从被测函数反推；不依赖 DOM / Vue / window / fetch。
import { describe, it, expect } from "vitest";
import type { ScrapeDraft, ScrapeWarning } from "../src/utils/scrape";
import {
  previewFromDraft,
  scrapeWarningKey,
  buildScrapeOptions,
  resolveFinalUrl,
  resolveRobotsStatus,
} from "../src/admin/panels/scrape.logic";
import {
  collectAnalyticsFailures,
  analyticsRequestPaths,
  articleFilterId,
  analyticsStamp,
} from "../src/admin/panels/analytics.logic";

describe("ScrapePanel — previewFromDraft（合并 warnings）", () => {
  it("decode warnings 在前、draft.warnings 在后，meta 与 draft 字段逐字合并", () => {
    const draft: ScrapeDraft = {
      title: "示例标题",
      summary: "示例摘要",
      coverImage: "https://img.example.com/cover.png",
      tags: ["Vue", "Astro"],
      slug: "",
      categoryId: 3,
      status: "draft",
      markdown: "# 正文",
      wordCount: 2,
      warnings: ["convert_failed", "no_article"],
      images: { total: 4, unresolved: 1 },
    };
    const decodeWarnings: ScrapeWarning[] = ["charset_fallback"];
    const meta = {
      finalUrl: "https://example.com/article",
      robotsStatus: "allowed" as const,
      charset: "utf-8",
    };
    expect(previewFromDraft(draft, decodeWarnings, meta)).toEqual({
      finalUrl: "https://example.com/article",
      robotsStatus: "allowed",
      charset: "utf-8",
      title: "示例标题",
      summary: "示例摘要",
      coverImage: "https://img.example.com/cover.png",
      tags: ["Vue", "Astro"],
      slug: "",
      categoryId: 3,
      status: "draft",
      markdown: "# 正文",
      wordCount: 2,
      warnings: ["charset_fallback", "convert_failed", "no_article"],
      images: { total: 4, unresolved: 1 },
    });
  });
});

describe("ScrapePanel — resolveFinalUrl（decodeURIComponent 失败回退原 header）", () => {
  it("无 header 时回退 target", () => {
    expect(resolveFinalUrl("https://a.com/p", null)).toBe("https://a.com/p");
  });

  it("合法 percent-encoding 正常解码", () => {
    expect(
      resolveFinalUrl("https://a.com/p", "https%3A%2F%2Fa.com%2Ffinal")
    ).toBe("https://a.com/final");
  });

  it("非法 percent-encoding 回退为原始 header，不抛错", () => {
    expect(resolveFinalUrl("https://a.com/p", "https://a.com/%E0%A4%A")).toBe(
      "https://a.com/%E0%A4%A"
    );
  });
});

describe("ScrapePanel — scrapeWarningKey / buildScrapeOptions / resolveRobotsStatus", () => {
  it("4 个 warning 映射为原 i18n key", () => {
    expect(scrapeWarningKey("no_article")).toBe(
      "admin.scrape_warning_no_article"
    );
    expect(scrapeWarningKey("readability_failed")).toBe(
      "admin.scrape_warning_readability_failed"
    );
    expect(scrapeWarningKey("convert_failed")).toBe(
      "admin.scrape_warning_convert_failed"
    );
    expect(scrapeWarningKey("charset_fallback")).toBe(
      "admin.scrape_warning_charset_fallback"
    );
  });

  it("buildScrapeOptions 原样返回 existingTags 与 scrapedAt", () => {
    const scrapedAt = new Date("2026-11-15T08:00:00.000Z");
    expect(buildScrapeOptions(["Vue", "Astro"], scrapedAt)).toEqual({
      existingTags: ["Vue", "Astro"],
      scrapedAt,
    });
  });

  it("仅 allowed 头放行，其余一律 unchecked", () => {
    expect(resolveRobotsStatus("allowed")).toBe("allowed");
    expect(resolveRobotsStatus("disallowed")).toBe("unchecked");
    expect(resolveRobotsStatus(null)).toBe("unchecked");
    expect(resolveRobotsStatus("")).toBe("unchecked");
  });
});

describe("AnalyticsPanel — collectAnalyticsFailures（对应 checks 过滤）", () => {
  it("code!==0 收集、code 缺失回退 null，code===0 被排除", () => {
    const checks = [
      { name: "overview", res: { code: 0 } },
      { name: "trend", res: { code: 500 } },
      { name: "quality", res: {} },
      { name: "device", res: null },
      { name: "articles", res: { code: 0 } },
    ];
    expect(collectAnalyticsFailures(checks)).toEqual([
      { name: "trend", code: 500 },
      { name: "quality", code: null },
      { name: "device", code: null },
    ]);
  });
});

describe("AnalyticsPanel — analyticsRequestPaths（对应 8 条并发 URL）", () => {
  it("无 article_id：8 条路径逐字一致", () => {
    expect(analyticsRequestPaths("7d", 2, "")).toEqual([
      "/admin/analytics/overview?range=7d",
      "/admin/analytics/trend?range=7d",
      "/admin/analytics/articles?range=7d&page=2",
      "/admin/analytics/quality?range=7d",
      "/admin/analytics/dimensions?dim=device&range=7d",
      "/admin/analytics/dimensions?dim=country&range=7d",
      "/admin/analytics/dimensions?dim=referrer&range=7d",
      "/articles?page_size=50",
    ]);
  });

  it("带 article_id：overview / trend / articles / 3 条 dimensions 均追加编码后的 article_id；quality 与文章选项不追加（#120）", () => {
    expect(analyticsRequestPaths("30d", 1, "a b&1")).toEqual([
      "/admin/analytics/overview?range=30d&article_id=a%20b%261",
      "/admin/analytics/trend?range=30d&article_id=a%20b%261",
      "/admin/analytics/articles?range=30d&page=1&article_id=a%20b%261",
      "/admin/analytics/quality?range=30d",
      "/admin/analytics/dimensions?dim=device&range=30d&article_id=a%20b%261",
      "/admin/analytics/dimensions?dim=country&range=30d&article_id=a%20b%261",
      "/admin/analytics/dimensions?dim=referrer&range=30d&article_id=a%20b%261",
      "/articles?page_size=50",
    ]);
  });
});

describe("AnalyticsPanel — articleFilterId（对应 applyAnalyticsArticleFilter 匹配）", () => {
  const options = [
    { id: 1, title: "Hello" },
    { id: 2, title: "World" },
  ];

  it("精确命中标题返回字符串 id（含去空白）", () => {
    expect(articleFilterId("  World  ", options)).toBe("2");
  });

  it("大小写不敏感匹配（#120）", () => {
    expect(articleFilterId("hello", options)).toBe("1");
    expect(articleFilterId("WORLD", options)).toBe("2");
    expect(articleFilterId("  HeLLo  ", options)).toBe("1");
  });

  it("空串 / 未命中返回空串", () => {
    expect(articleFilterId("   ", options)).toBe("");
    expect(articleFilterId("Missing", options)).toBe("");
  });
});

describe("AnalyticsPanel — analyticsStamp（对应心跳时间格式化）", () => {
  it("非法心跳时间无法解析时回退「—」", () => {
    expect(
      analyticsStamp("not-a-date", new Date("2026-11-15T08:00:00.000Z"), "zh")
    ).toBe("—");
  });
});
