import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hashIp,
  IP_HASH_SECRET_ENV,
  MissingIpHashSecretError,
} from "../src/utils/ip_hash";
import { handleToggleLike } from "../src/handlers/like";
import { handleSubmitComment } from "../src/handlers/comment";
import type { Env } from "../src/index";

/**
 * issue #104 / L5：`ip_hash` 的盐来自服务端秘密，不再硬编码。
 *
 * 接缝：hashIp（纯函数，单点）+ 两个写入方 (handleToggleLike / handleSubmitComment)
 * 的 fail-closed 出口。
 */

const SECRET = "unit-test-ip-hash-secret";

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("hashIp 盐来源（#104）", () => {
  it("同一 secret / IP / 域 → 稳定且为 64 位 hex", async () => {
    const a = await hashIp("203.0.113.7", "like", SECRET);
    const b = await hashIp("203.0.113.7", "like", SECRET);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("IP 前后空白不影响结果（先 trim）", async () => {
    const a = await hashIp("203.0.113.7", "like", SECRET);
    const b = await hashIp("  203.0.113.7  ", "like", SECRET);
    expect(a).toBe(b);
  });

  it("域不同 → 哈希不同（评论与点赞不可交叉比对）", async () => {
    const blog = await hashIp("203.0.113.7", "blog", SECRET);
    const like = await hashIp("203.0.113.7", "like", SECRET);
    expect(blog).not.toBe(like);
  });

  it("secret 不同 → 哈希不同（盐确实参与运算）", async () => {
    const a = await hashIp("203.0.113.7", "like", SECRET);
    const b = await hashIp("203.0.113.7", "like", `${SECRET}-rotated`);
    expect(a).not.toBe(b);
  });

  it("新口径与旧硬编码盐口径不相等（存量哈希不会被误判为命中）", async () => {
    // 旧实现：SHA-256(ip + "-salt-like-2024")
    const legacy = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("203.0.113.7-salt-like-2024")
    );
    const legacyHex = Array.from(new Uint8Array(legacy))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const current = await hashIp("203.0.113.7", "like", SECRET);
    expect(current).not.toBe(legacyHex);
  });

  it.each([undefined, null, "", "   "])(
    "secret 为 %j 时 fail-closed：抛 MissingIpHashSecretError",
    async (secret) => {
      await expect(
        hashIp("203.0.113.7", "like", secret)
      ).rejects.toBeInstanceOf(MissingIpHashSecretError);
    }
  );

  it("worker/src 里不再有硬编码盐字面量（静态守卫）", () => {
    const root = fileURLToPath(new URL("../src", import.meta.url).href);
    const files = collectSourceFiles(root);
    // 判据不是「出现 salt 字样」（注释说明历史格式、password.ts 的模板串都会误报），
    // 而是「名字里带 SALT/SECRET 的常量被赋了一个**像盐**的字符串字面量」：
    // 排除全大写环境变量名（`IP_HASH_SECRET_ENV = "IP_HASH_SECRET"` 这类是变量名不是值）。
    // 另保留旧格式 `-salt-(blog|like)-<年份>` 的直接匹配做兜底。
    const HARDCODED =
      /(?:const|let|var)\s+\w*(?:SALT|SECRET)\w*\s*=\s*(["'`])([^"'`]{6,})\1/i;
    const LEGACY = /-salt-(blog|like)-\d{4}/;
    const offenders = files.flatMap((file) => {
      const src = readFileSync(file, "utf8");
      const hit = src.match(HARDCODED);
      if (hit && !/^[A-Z0-9_]+$/.test(hit[2])) return [`${file}: ${hit[0]}`];
      const legacy = src.match(LEGACY);
      return legacy ? [`${file}: ${legacy[0]}`] : [];
    });
    expect(offenders).toEqual([]);
  });

  it("Env 契约暴露 IP_HASH_SECRET（可选，未配置时 fail-closed）", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../src/index.ts", import.meta.url).href),
      "utf8"
    );
    expect(src).toMatch(new RegExp(`${IP_HASH_SECRET_ENV}\\?:\\s*string`));
  });
});

/** 记录型 D1 桩：任何查询都会留下痕迹，用于断言 fail-closed 时未触库。 */
function makeRecordingDb() {
  const queries: string[] = [];
  const stmt = (sql: string) => {
    queries.push(sql);
    const s = {
      sql,
      bind: () => s,
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ success: true, meta: { changes: 0 } }),
    };
    return s;
  };
  return {
    db: {
      prepare: stmt,
      batch: async (stmts: unknown[]) =>
        (stmts as unknown[]).map(() => ({ success: true })),
    },
    queries: () => [...queries],
  };
}

describe("未配置 IP_HASH_SECRET 时的 handler 出口（#104 fail-closed）", () => {
  it("点赞：返回 500，且不执行任何查询", async () => {
    const fake = makeRecordingDb();
    const res = await handleToggleLike(
      new Request("https://example.com/api/v1/articles/1/like", {
        method: "POST",
        headers: { "CF-Connecting-IP": "203.0.113.7" },
      }),
      { DB: fake.db } as unknown as Env,
      {} as ExecutionContext,
      { article_id: "1" }
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: number; message: string };
    expect(body.code).not.toBe(0);
    // 不回显配置项名称 / 内部异常
    expect(body.message).not.toMatch(/IP_HASH_SECRET|secret/i);
    expect(fake.queries()).toHaveLength(0);
  });

  it("评论提交：返回 500，且不执行任何查询 / 写入", async () => {
    const fake = makeRecordingDb();
    const res = await handleSubmitComment(
      new Request("https://example.com/api/v1/articles/1/comments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.7",
        },
        body: JSON.stringify({ nickname: "访客", content: "你好" }),
      }),
      { DB: fake.db } as unknown as Env,
      {} as ExecutionContext,
      { article_id: "1" }
    );

    expect(res.status).toBe(500);
    expect(fake.queries()).toHaveLength(0);
  });
});
