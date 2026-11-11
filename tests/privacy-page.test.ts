import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import zh from "../src/i18n/zh.json";
import en from "../src/i18n/en.json";

/**
 * issue #59：隐私披露页与跨文档同步的一致性回归。
 *
 * 期望清单均为手写字面量（docs/agents/testing.md:88 独立来源），
 * 页面 / 页脚 / 生成物 / README / GLOSSARY / ADR 逐项比对实现。
 */

const ROOT = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** 手写字面量：隐私页与页脚入口必须有的中英词条 */
const PRIVACY_KEYS = [
  "nav.privacy",
  "privacy.title",
  "privacy.desc",
  "privacy.intro",
  "privacy.cookie_title",
  "privacy.cookie_body",
  "privacy.purpose_title",
  "privacy.purpose_body",
  "privacy.retention_title",
  "privacy.retention_body",
  "privacy.scope_title",
  "privacy.scope_body",
  "privacy.contact_title",
  "privacy.contact_body",
  "privacy.item_cookie",
  "privacy.item_hmac",
  "privacy.item_ua",
  "privacy.item_referer",
  "privacy.item_country",
  "privacy.item_device",
  "privacy.item_token",
  "privacy.item_aggregate",
  "privacy.note",
] as const;

/** 手写字面量：本批实际提供的 admin 统计只读接口 */
const ADMIN_STAT_ROUTES = [
  "/admin/analytics/overview",
  "/admin/analytics/dimensions",
  "/admin/analytics/articles",
  "/admin/analytics/quality",
  "/admin/analytics/trend",
] as const;

describe("issue #59：隐私页中英文案（验收 1）", () => {
  it("所有 privacy.* 与 nav.privacy 在 zh / en 都存在且非空", () => {
    for (const key of PRIVACY_KEYS) {
      expect(
        String((zh as Record<string, string>)[key] ?? ""),
        `zh ${key}`
      ).not.toBe("");
      expect(
        String((en as Record<string, string>)[key] ?? ""),
        `en ${key}`
      ).not.toBe("");
    }
  });

  it("zh / en 的 privacy.* 键集合双向一致且等于手写清单", () => {
    const keysOf = (messages: Record<string, string>) =>
      Object.keys(messages)
        .filter((key) => key.startsWith("privacy."))
        .sort();
    const expected = PRIVACY_KEYS.filter((key) =>
      key.startsWith("privacy.")
    ).sort();
    expect(keysOf(zh as Record<string, string>)).toEqual(expected);
    expect(keysOf(en as Record<string, string>)).toEqual(expected);
  });

  it("页面用 BaseLayout 与 data-i18n，且用到的 key 都在清单内", () => {
    const page = read("src/pages/privacy.astro");
    expect(page).toContain("BaseLayout");
    const used = Array.from(
      page.matchAll(/data-i18n="([a-z.]+)"/g),
      (match) => match[1]
    );
    expect(used.length).toBeGreaterThan(0);
    for (const key of used) {
      expect(PRIVACY_KEYS).toContain(key);
    }
  });

  it("页面内嵌中文与 zh.json 逐条一致，无 JS 首屏不漂移", () => {
    const page = read("src/pages/privacy.astro");
    const decode = (text: string) =>
      text
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .trim();
    const pairs = Array.from(
      page.matchAll(/data-i18n="(privacy\.[a-z_]+)"[^>]*>([^<]+)</g),
      (match) => [match[1], decode(match[2])] as const
    );
    expect(pairs.length).toBe(
      PRIVACY_KEYS.filter((key) => key.startsWith("privacy.")).length
    );
    for (const [key, text] of pairs) {
      expect(text, key).toBe((zh as Record<string, string>)[key]);
    }
  });

  it("页脚有 /privacy 入口且文案走 data-i18n", () => {
    const layout = read("src/components/layout/BaseLayout.astro");
    expect(layout).toMatch(/href="\/privacy"[^>]*data-i18n="nav\.privacy"/);
    expect(layout).toContain('data-i18n="nav.privacy">隐私<');
  });
});

describe("issue #59：护栏与跨文档同步（验收 2–5）", () => {
  it("public/_headers 含 /privacy* 的 no-transform 与 Speculation-Rules 护栏块", () => {
    const headers = read("public/_headers");
    const lines = headers.split("\n");
    const start = lines.indexOf("/privacy*");
    expect(start).toBeGreaterThanOrEqual(0);
    const block: string[] = [];
    for (let i = start + 1; i < lines.length; i += 1) {
      if (!lines[i].startsWith("  ")) break;
      block.push(lines[i].trim());
    }
    expect(block).toContain(
      "Cache-Control: public, max-age=0, must-revalidate, no-transform"
    );
    expect(block).toContain('Speculation-Rules: "/speculation-rules"');
  });

  it("README 页面表含 /privacy，且 5 个统计接口与实际路由一致", () => {
    const readme = read("README.md");
    const router = read("worker/src/router.ts");
    expect(readme).toMatch(/\| `\/privacy`\s*\|/);
    for (const route of ADMIN_STAT_ROUTES) {
      expect(readme, `README ${route}`).toContain(route);
      expect(router, `router ${route}`).toContain(route);
    }
  });

  it("GLOSSARY 的去重键与代理覆盖率口径与实现一致", () => {
    const glossary = read("GLOSSARY.md");
    expect(glossary).toContain("X-Real-IP");
    expect(glossary).toContain("HMAC");
    expect(glossary).toContain("pv / requests");
    expect(glossary).toContain("Asia/Shanghai");
  });

  it("ADR 0005 状态已转 accepted", () => {
    const adr = read("docs/adr/0005-reader-analytics-aggregate-first.md");
    expect(adr).toMatch(/\*\*Status:\*\* accepted/);
  });

  it("spec 头部状态标注 Tier 0 已落地", () => {
    const spec = read("docs/READER_ANALYTICS.md");
    expect(spec).toContain("Tier 0 已落地");
  });

  it("README 部署段含可直接执行的 D1 迁移清单与纯新增 SQL 文件", () => {
    const readme = read("README.md");
    expect(readme).toMatch(/数据库迁移是手动步骤/);
    expect(readme).toContain("wrangler d1 execute blog-db --remote");
    expect(readme).toContain("sqlite_master");
    expect(readme).toContain("idx_view_token%");
    expect(readme).toContain("schema-tier0-incremental.sql");

    const ddl = read("worker/schema-tier0-incremental.sql");
    expect(ddl.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(3);
    expect(ddl.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(2);
    expect(ddl).not.toMatch(/^(DROP|DELETE|UPDATE|ALTER)\s/im);
  });

  it("spec §4.2 注明计数写库失败时的降级口径", () => {
    const spec = read("docs/READER_ANALYTICS.md");
    expect(spec).toContain("异常降级（2026-11-11 加固）");
  });
});
