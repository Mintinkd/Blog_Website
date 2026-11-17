// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_PREFIX,
  DEFAULT_SITE_URL,
  DEFAULT_SITEMAP_PAGE_SIZE,
  DEFAULT_WORKER_ORIGIN,
  normalizeOrigin,
  resolveApiPrefix,
  resolvePositiveInt,
  resolveSiteUrl,
  resolveSitemapApiBase,
  resolveWorkerOrigin,
} from "../scripts/site-config.mjs";

/**
 * 硬编码配置迁移：站点 / Worker / sitemap 的默认值与 env 解析单源。
 *
 * 未配置时必须逐字回落迁移前的行为；非法 origin 必须 fail-closed，
 * 避免构建出指向错误域名的产物。
 */

describe("site-config 默认值", () => {
  it("空 env 回落迁移前的生产默认值", () => {
    expect(resolveSiteUrl({})).toBe(DEFAULT_SITE_URL);
    expect(resolveWorkerOrigin({})).toBe(DEFAULT_WORKER_ORIGIN);
    expect(resolveApiPrefix({})).toBe(DEFAULT_API_PREFIX);
    expect(resolveSitemapApiBase({})).toBe(
      `${DEFAULT_SITE_URL}${DEFAULT_API_PREFIX}/articles`
    );
  });

  it("空字符串 / 纯空白视同未配置", () => {
    expect(resolveSiteUrl({ SITE_URL: "   " })).toBe(DEFAULT_SITE_URL);
    expect(resolveWorkerOrigin({ WORKER_ORIGIN: "" })).toBe(
      DEFAULT_WORKER_ORIGIN
    );
  });
});

describe("origin 解析", () => {
  it("去尾部斜杠并返回规范化 origin", () => {
    expect(normalizeOrigin("https://example.com/")).toBe("https://example.com");
    expect(normalizeOrigin("  https://example.com  ")).toBe(
      "https://example.com"
    );
  });

  it("PUBLIC_ 别名优先于普通变量（与 Vite 注入约定一致）", () => {
    expect(
      resolveSiteUrl({
        PUBLIC_SITE_URL: "https://public.example",
        SITE_URL: "https://plain.example",
      })
    ).toBe("https://public.example");
    expect(
      resolveWorkerOrigin({
        PUBLIC_WORKER_ORIGIN: "https://public-api.example",
        WORKER_ORIGIN: "https://plain-api.example",
      })
    ).toBe("https://public-api.example");
  });

  it.each([
    ["带路径", "https://example.com/blog"],
    ["带查询", "https://example.com?x=1"],
    ["带片段", "https://example.com#top"],
    ["非 http(s)", "ftp://example.com"],
    ["不是 URL", "not-a-url"],
  ])("%s 的 origin 直接抛错（fail-closed）", (_label, value) => {
    expect(() => normalizeOrigin(value)).toThrow();
    expect(() => resolveSiteUrl({ SITE_URL: value })).toThrow();
  });
});

describe("API 前缀 / sitemap 地址", () => {
  it("API_PREFIX 规范化为单个前导斜杠且无尾斜杠", () => {
    expect(resolveApiPrefix({ API_PREFIX: "api/v2/" })).toBe("/api/v2");
    expect(resolveApiPrefix({ API_PREFIX: "///" })).toBe(DEFAULT_API_PREFIX);
  });

  it("sitemap 默认跟随 SITE_URL + API_PREFIX，并去掉显式覆盖的尾斜杠", () => {
    expect(
      resolveSitemapApiBase({
        SITE_URL: "https://blog.example",
        API_PREFIX: "api/v2",
      })
    ).toBe("https://blog.example/api/v2/articles");
    expect(
      resolveSitemapApiBase({
        SITEMAP_API_BASE: "https://api.example/articles/",
      })
    ).toBe("https://api.example/articles");
  });
});

describe("resolvePositiveInt", () => {
  it("未配置 / 空值回落默认值", () => {
    expect(resolvePositiveInt(undefined, DEFAULT_SITEMAP_PAGE_SIZE, "X")).toBe(
      DEFAULT_SITEMAP_PAGE_SIZE
    );
    expect(resolvePositiveInt("", DEFAULT_SITEMAP_PAGE_SIZE, "X")).toBe(
      DEFAULT_SITEMAP_PAGE_SIZE
    );
  });

  it("接受正整数", () => {
    expect(resolvePositiveInt("25", DEFAULT_SITEMAP_PAGE_SIZE, "X")).toBe(25);
  });

  it.each(["0", "-1", "1.5", "abc"])("%s 直接抛错（fail-closed）", (value) => {
    expect(() => resolvePositiveInt(value, 50, "SITEMAP_PAGE_SIZE")).toThrow(
      /SITEMAP_PAGE_SIZE/
    );
  });
});
