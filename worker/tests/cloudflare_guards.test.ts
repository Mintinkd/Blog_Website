import { describe, expect, it } from "vitest";
import {
  HTML_GUARD_HEADERS,
  HTML_ROUTE_PATTERNS,
  NO_TRANSFORM_CACHE_CONTROL,
  SPECULATION_RULES_BODY,
  SPECULATION_RULES_CONTENT_TYPE,
  SPECULATION_RULES_PATH,
  appendNoTransform,
  guardHtmlResponse,
  isHtmlDocument,
  speculationRulesResponse,
} from "../../scripts/cloudflare-guards.mjs";
import { renderHeadersFile } from "../../scripts/security-headers.mjs";

/**
 * cloudflare-guards 模块：Cloudflare 平台注入护栏（2026-10-20）的行为锁定。
 *
 * 接缝（docs/agents/testing.md「多入口共用的流水线」）：
 *   - 护栏模块（scripts/cloudflare-guards.mjs）——静态页（_headers 渲染）与 SSR
 *     页面（src/middleware.ts）两个入口共同消费的唯一手工维护点；
 *   - renderHeadersFile——两渠道共用的整文件渲染出口（含 HTML 路由护栏块）。
 * 前端 middleware / 端点接线由 astro check 类型门禁覆盖，不在此重复。
 *
 * 背景（实测 2026-10-20，自定义域）：
 *   - JS Detections 注入内联 bootstrap → 哈希 CSP 拒绝（CSP violation）；
 *   - Speed Brain 注入 Speculation-Rules → Worker 路由预取一律 503。
 */

/** 独立手写字面量：护栏头基线与路由模式（不得从被测模块推导） */
const EXPECTED_CACHE_CONTROL =
  "public, max-age=0, must-revalidate, no-transform";
const EXPECTED_SPECULATION_RULES = '"/speculation-rules"';
const EXPECTED_ROUTE_PATTERNS = [
  "/",
  "/404*",
  "/about*",
  "/archives*",
  "/admin*",
  "/articles*",
  "/search*",
];

/** 取出 _headers 内容中某个规则块的缩进头行（遇到下一非缩进行停止） */
function blockHeaders(content: string, pattern: string): string[] {
  const lines = content.split("\n");
  const start = lines.indexOf(pattern);
  expect(start).toBeGreaterThanOrEqual(0);
  const headers: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (!lines[i].startsWith("  ")) break;
    headers.push(lines[i].trim());
  }
  return headers;
}

describe("cloudflare-guards 常量（单源手写值）", () => {
  it("规则集路径/类型/头值/缓存基线逐字面量钉住", () => {
    expect(SPECULATION_RULES_PATH).toBe("/speculation-rules");
    expect(SPECULATION_RULES_CONTENT_TYPE).toBe(
      "application/speculationrules+json"
    );
    expect(NO_TRANSFORM_CACHE_CONTROL).toBe(EXPECTED_CACHE_CONTROL);
    expect(HTML_GUARD_HEADERS).toEqual({
      "Cache-Control": EXPECTED_CACHE_CONTROL,
      "Speculation-Rules": EXPECTED_SPECULATION_RULES,
    });
  });

  it("规则集 JSON：document 规则锚定一个永不存在的路径（不匹配任何链接 → 不发起预取）", () => {
    expect(JSON.parse(SPECULATION_RULES_BODY)).toEqual({
      prefetch: [
        {
          source: "document",
          where: {
            href_matches: "/__speculation_rules_disabled__",
            relative_to: "document",
          },
          eagerness: "conservative",
        },
      ],
    });
  });

  it("路由模式手写清单：覆盖全部预渲染 HTML 路由（与 dist/_routes.json exclude 对齐）", () => {
    expect(HTML_ROUTE_PATTERNS).toEqual(EXPECTED_ROUTE_PATTERNS);
  });
});

describe("cloudflare-guards 行为", () => {
  it("isHtmlDocument：只认 text/html（含 charset / 大小写），其余一律 false", () => {
    expect(isHtmlDocument("text/html")).toBe(true);
    expect(isHtmlDocument("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlDocument("Text/HTML; Charset=UTF-8")).toBe(true);
    expect(isHtmlDocument("application/json")).toBe(false);
    expect(isHtmlDocument("application/speculationrules+json")).toBe(false);
    expect(isHtmlDocument(null)).toBe(false);
    expect(isHtmlDocument(undefined)).toBe(false);
  });

  it("appendNoTransform：追加到已有指令尾部；已含则原样；空值只留 no-transform", () => {
    expect(appendNoTransform("public, max-age=0, must-revalidate")).toBe(
      "public, max-age=0, must-revalidate, no-transform"
    );
    expect(appendNoTransform("public, no-transform")).toBe(
      "public, no-transform"
    );
    expect(appendNoTransform("no-transform")).toBe("no-transform");
    expect(appendNoTransform("")).toBe("no-transform");
    expect(appendNoTransform(null)).toBe("no-transform");
    expect(appendNoTransform(undefined)).toBe("no-transform");
    // 前缀相同的其它指令不得误判
    expect(appendNoTransform("no-transform-extra")).toBe(
      "no-transform-extra, no-transform"
    );
  });

  it("guardHtmlResponse：HTML 追加 no-transform 且覆盖 Speculation-Rules；重复调用幂等", () => {
    const headers = new Headers({
      "Content-Type": "text/html; charset=utf-8",
    });

    guardHtmlResponse(headers, "text/html; charset=utf-8");
    expect(headers.get("Cache-Control")).toBe("no-transform");
    expect(headers.get("Speculation-Rules")).toBe(EXPECTED_SPECULATION_RULES);

    guardHtmlResponse(headers, "text/html; charset=utf-8");
    expect(headers.get("Cache-Control")).toBe("no-transform");
    expect(headers.get("Speculation-Rules")).toBe(EXPECTED_SPECULATION_RULES);
  });

  it("guardHtmlResponse：已有 Cache-Control 时保留原指令，只追加 no-transform", () => {
    const headers = new Headers({
      "Cache-Control": "public, max-age=0, must-revalidate",
    });

    guardHtmlResponse(headers, "text/html");

    expect(headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate, no-transform"
    );
  });

  it("guardHtmlResponse：非 HTML 响应（JSON/XML/缺失）不添加任何护栏头", () => {
    for (const contentType of [
      "application/json",
      "application/rss+xml",
      null,
      undefined,
    ]) {
      const headers = new Headers();
      guardHtmlResponse(headers, contentType);
      expect(headers.get("Cache-Control")).toBeNull();
      expect(headers.get("Speculation-Rules")).toBeNull();
    }
  });

  it("speculationRulesResponse：MIME/缓存头/规则体为端点的响应契约", async () => {
    const response = speculationRulesResponse();
    expect(response.headers.get("Content-Type")).toBe(
      SPECULATION_RULES_CONTENT_TYPE
    );
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(await response.text()).toBe(SPECULATION_RULES_BODY);
  });
});

describe("public/_headers 渲染（护栏块入生成物）", () => {
  it("/* 块仍是 5 个安全头，不含护栏头（资产不因 no-transform 失去压缩）", () => {
    const content = renderHeadersFile();
    expect(
      blockHeaders(content, "/*").map((line) => line.split(": ")[0])
    ).toEqual([
      "Content-Security-Policy",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]);
  });

  it("每个预渲染 HTML 路由块都带两个护栏头，且每个模式只出现一次", () => {
    const content = renderHeadersFile();
    for (const pattern of EXPECTED_ROUTE_PATTERNS) {
      expect(blockHeaders(content, pattern)).toEqual([
        `Cache-Control: ${EXPECTED_CACHE_CONTROL}`,
        `Speculation-Rules: ${EXPECTED_SPECULATION_RULES}`,
      ]);
      const occurrences = content
        .split("\n")
        .filter((line) => line === pattern).length;
      expect(occurrences).toBe(1);
    }
  });
});
