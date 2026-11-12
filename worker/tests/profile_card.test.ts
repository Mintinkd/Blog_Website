import { describe, expect, it } from "vitest";
import { handleUpdateConfig } from "../src/handlers/config";
import {
  PROFILE_LIMITS,
  emptyProfileCard,
  isSafeAvatarUrl,
  isSafeProfileUrl,
  normalizeProfileCard,
  parseProfileCardJson,
  serializeProfileCard,
} from "../src/utils/profile-card";

/**
 * 个人名片配置：Worker 侧校验 / 净化 / 落库。
 *
 * URL 白名单用手写字面量表钉住（独立来源），不从被测实现里推导期望值；
 * 落库接缝用最小 DB stub 记录 SQL 与参数，锁住「净化后才写」「非法即整批拒绝」
 * 与「UPSERT 不覆盖 is_public」三件事。
 */

const SAFE_URLS = [
  "https://github.com/example",
  "http://example.com/feed",
  "mailto:hi@example.com",
  "/rss.xml",
  "/api/v1/media/serve/media/2026/11/a.png",
];

const UNSAFE_URLS = [
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "ftp://example.com/file",
  "//evil.example.com/x",
  "https://example.com/\nSet-Cookie: x=1",
  "",
  "   ",
];

function makeConfigDb() {
  const statements: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        statements.push({ sql, args });
        return { run: async () => ({ success: true, meta: { changes: 1 } }) };
      },
    }),
  };
  return { env: { DB: db } as any, statements };
}

function putRequest(body: unknown): Request {
  return new Request("https://example.com/api/v1/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("名片 URL 协议白名单", () => {
  it("放行 http(s) / mailto / 站内绝对路径", () => {
    for (const url of SAFE_URLS) {
      expect(isSafeProfileUrl(url), url).toBe(true);
    }
  });

  it("拒绝伪协议、协议相对 URL、控制字符与空值", () => {
    for (const url of UNSAFE_URLS) {
      expect(isSafeProfileUrl(url), url).toBe(false);
    }
    expect(isSafeProfileUrl(undefined)).toBe(false);
    expect(isSafeProfileUrl(123)).toBe(false);
  });

  it("头像不接受 mailto，但接受 http(s) 与站内路径", () => {
    expect(isSafeAvatarUrl("mailto:hi@example.com")).toBe(false);
    expect(isSafeAvatarUrl("https://cdn.example.com/a.png")).toBe(true);
    expect(isSafeAvatarUrl("/api/v1/media/serve/a.png")).toBe(true);
    expect(isSafeAvatarUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("normalizeProfileCard 净化", () => {
  it("空输入得到全部为空的名片", () => {
    expect(normalizeProfileCard({})).toEqual({
      ok: true,
      value: emptyProfileCard(),
    });
    expect(normalizeProfileCard(undefined)).toEqual({
      ok: true,
      value: emptyProfileCard(),
    });
    expect(normalizeProfileCard(null)).toEqual({
      ok: true,
      value: emptyProfileCard(),
    });
  });

  it("保留合法字段并 trim，丢弃未知字段", () => {
    const r = normalizeProfileCard({
      name: "  老大 / Laoda  ",
      role: "独立开发者 · Indie Maker",
      bio: "记录代码、设计与生活的博客作者。",
      avatar: "/api/v1/media/serve/a.png",
      links: [
        { label: "GitHub", url: "https://github.com/example" },
        { label: "Email", url: "mailto:hi@example.com" },
        { label: "RSS", url: "/rss.xml" },
      ],
      injected: "<script>alert(1)</script>",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe("老大 / Laoda");
    expect(r.value.links).toHaveLength(3);
    expect(Object.keys(r.value).sort()).toEqual(
      ["avatar", "bio", "links", "name", "role"].sort()
    );
    expect(JSON.stringify(r.value)).not.toContain("injected");
  });

  it("后台表单的空链接占位行直接丢弃", () => {
    const r = normalizeProfileCard({
      links: [
        { label: "", url: "" },
        { label: "GitHub", url: "https://github.com/example" },
        { label: "   ", url: "  " },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.links).toEqual([
      { label: "GitHub", url: "https://github.com/example" },
    ]);
  });

  it("非法 URL 直接拒绝，不静默保留", () => {
    const r = normalizeProfileCard({
      links: [{ label: "XSS", url: "javascript:alert(1)" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("地址不合法");
  });

  it("字段类型 / 长度 / 条数越界均拒绝", () => {
    expect(normalizeProfileCard({ name: 123 }).ok).toBe(false);
    expect(
      normalizeProfileCard({ bio: "x".repeat(PROFILE_LIMITS.bio + 1) }).ok
    ).toBe(false);
    expect(normalizeProfileCard({ links: "not-an-array" }).ok).toBe(false);
    expect(normalizeProfileCard({ links: [1] }).ok).toBe(false);
    expect(
      normalizeProfileCard({ links: [{ label: "", url: "/rss.xml" }] }).ok
    ).toBe(false);
    expect(
      normalizeProfileCard({
        links: Array.from({ length: PROFILE_LIMITS.maxLinks + 1 }, (_, i) => ({
          label: `L${i}`,
          url: "/rss.xml",
        })),
      }).ok
    ).toBe(false);
    expect(normalizeProfileCard(["not", "an", "object"]).ok).toBe(false);
  });

  it("头像非法地址被拒", () => {
    expect(normalizeProfileCard({ avatar: "javascript:alert(1)" }).ok).toBe(
      false
    );
  });
});

describe("parseProfileCardJson / serializeProfileCard", () => {
  it("空串视为未配置", () => {
    expect(parseProfileCardJson("")).toEqual({
      ok: true,
      value: emptyProfileCard(),
    });
    expect(parseProfileCardJson("   ")).toEqual({
      ok: true,
      value: emptyProfileCard(),
    });
  });

  it("坏 JSON 返回可读错误", () => {
    const r = parseProfileCardJson("{not-json");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("合法 JSON");
  });

  it("序列化后可原样读回", () => {
    const card = {
      name: "老大",
      role: "Indie Maker",
      bio: "欢迎来逛逛。",
      avatar: "/api/v1/media/serve/a.png",
      links: [{ label: "RSS", url: "/rss.xml" }],
    };
    const r = parseProfileCardJson(serializeProfileCard(card));
    expect(r).toEqual({ ok: true, value: card });
  });
});

describe("PUT /config 落库接缝（profile_card）", () => {
  it("合法名片：净化后以 JSON 字符串写入，SQL 为 UPSERT 且不改 is_public", async () => {
    const { env, statements } = makeConfigDb();
    const res = await handleUpdateConfig(
      putRequest({
        profile_card: JSON.stringify({
          name: "老大",
          links: [
            { label: "", url: "" },
            { label: "GitHub", url: "https://github.com/example" },
          ],
          injected: "drop",
        }),
      }),
      env
    );
    expect(res.status).toBe(200);
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain("INSERT INTO site_config");
    expect(statements[0].sql).toContain("ON CONFLICT(key) DO UPDATE");
    expect(statements[0].sql).not.toContain("SET is_public");
    expect(statements[0].args[0]).toBe("profile_card");
    const stored = JSON.parse(statements[0].args[1] as string);
    expect(stored.name).toBe("老大");
    expect(stored.links).toEqual([
      { label: "GitHub", url: "https://github.com/example" },
    ]);
    expect(stored.injected).toBeUndefined();
  });

  it("非法 URL / 坏 JSON：整批拒绝且不写库", async () => {
    for (const value of [
      "{not-json",
      JSON.stringify({ links: [{ label: "x", url: "javascript:alert(1)" }] }),
    ]) {
      const { env, statements } = makeConfigDb();
      const res = await handleUpdateConfig(
        putRequest({ profile_card: value }),
        env
      );
      expect(res.status).toBe(400);
      expect(statements).toHaveLength(0);
    }
  });

  it("与其它合法键一起提交时，净化结果与其它键值分别落库", async () => {
    const { env, statements } = makeConfigDb();
    const res = await handleUpdateConfig(
      putRequest({
        site_title: "新标题",
        profile_card: JSON.stringify({ bio: "<b>原文</b>" }),
      }),
      env
    );
    expect(res.status).toBe(200);
    expect(statements).toHaveLength(2);
    const byKey = new Map(statements.map((s) => [s.args[0], s.args[1]]));
    expect(byKey.get("site_title")).toBe("新标题");
    expect(JSON.parse(byKey.get("profile_card") as string).bio).toBe(
      "<b>原文</b>"
    );
  });
});
