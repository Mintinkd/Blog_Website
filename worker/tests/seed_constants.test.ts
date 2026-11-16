import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGACY_SEED_PASSWORD_HASH } from "../src/utils/seed";

/**
 * issue #24 建立 / #83（H1）改写：种子凭据契约守卫。
 *
 * #83 起新部署不再有硬编码可登录口令：
 *  - TS 侧保留的哈希仅用于识别存量种子账号（LEGACY_SEED_PASSWORD_HASH），
 *    恒等于 SHA-256("password")——改它会让存量识别失配；
 *  - 该哈希只在 migrations/0001_baseline.sql 的存量 UPDATE 中残留一处（issue #94 收编），
 *    schema.sql 不含，**禁止**在任何文件出现种子 INSERT；
 *  - 随机口令由 scripts/seed-credential.mjs 生成，见 seed_random.test.ts。
 */

const LEGACY_SEED_PLAINTEXT = "password";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const schema = () =>
  readFileSync(join(import.meta.dirname, "..", "schema.sql"), "utf8");

describe("种子凭据契约（issue #24 / #83）", () => {
  it("TS 侧：LEGACY_SEED_PASSWORD_HASH === SHA-256(历史种子口令)", async () => {
    expect(LEGACY_SEED_PASSWORD_HASH).toBe(
      await sha256Hex(LEGACY_SEED_PLAINTEXT)
    );
  });

  it("迁移文件：历史哈希恰好一处（baseline UPDATE），且等于 TS 常量；schema.sql 不含", async () => {
    // issue #94 / M12：存量 UPDATE 从 schema.sql 收编到 migrations/0001_baseline.sql。
    const baseline = readFileSync(
      join(import.meta.dirname, "..", "migrations", "0001_baseline.sql"),
      "utf8"
    );
    const hashLiterals = [...baseline.matchAll(/'([0-9a-f]{64})'/g)].map(
      (m) => m[1]
    );
    expect(hashLiterals).toHaveLength(1);
    expect(hashLiterals[0]).toBe(LEGACY_SEED_PASSWORD_HASH);
    expect(schema()).not.toMatch(
      /'5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8'/i
    );
  });

  it("schema.sql：不再写入硬编码可登录的种子管理员行", () => {
    expect(schema()).not.toMatch(
      /INSERT\s+(OR\s+IGNORE\s+)?INTO\s+users\b[\s\S]*?VALUES\s*\([^)]*'5e884898/i
    );
    // 任何写入 users 的 INSERT 都不允许携带 64 位十六进制口令哈希字面量
    const userInserts = [
      ...schema().matchAll(/INSERT[^;]*INTO\s+users[^;]*/gi),
    ].map((m) => m[0]);
    for (const statement of userInserts) {
      expect(statement).not.toMatch(/'[0-9a-f]{64}'/i);
    }
  });
});
