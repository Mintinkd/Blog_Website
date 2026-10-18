import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEED_PASSWORD,
  INITIAL_ADMIN_PASSWORD_HASH,
} from "../src/utils/seed";

/**
 * issue #24：种子口令与初始哈希「单一来源」的一致性守卫。
 *
 * TS 侧：INITIAL_ADMIN_PASSWORD_HASH 必须恒等于 SHA-256(DEFAULT_SEED_PASSWORD)——
 * 两常量本是同一件事，改其一不改其二即门禁判定与种子数据失配。
 * SQL 侧：schema.sql 的种子 INSERT 与迁移 UPDATE 各自携带同一字面量（SQL 文件性质
 * 无法 import TS，属已接受的重复）——本测试机械守卫两处与 TS 单一来源保持一致。
 */

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("种子凭据单一来源（issue #24）", () => {
  it("TS 侧：INITIAL_ADMIN_PASSWORD_HASH === SHA-256(DEFAULT_SEED_PASSWORD)", async () => {
    expect(INITIAL_ADMIN_PASSWORD_HASH).toBe(
      await sha256Hex(DEFAULT_SEED_PASSWORD)
    );
  });

  it("schema.sql：种子 INSERT 与迁移 UPDATE 的字面量各唯一一处，且与 TS 单一来源一致", async () => {
    // 以 tests/ 目录（import.meta.dirname）定位 schema.sql，与进程 cwd 无关
    const schema = readFileSync(
      join(import.meta.dirname, "..", "schema.sql"),
      "utf8"
    );
    const hashLiterals = [...schema.matchAll(/'([0-9a-f]{64})'/g)].map(
      (m) => m[1]
    );

    // 恰好两处（种子 INSERT / 迁移 UPDATE）——日后新增哈希字面量须同步扩本断言
    expect(hashLiterals).toHaveLength(2);
    const tsHash = await sha256Hex(DEFAULT_SEED_PASSWORD);
    expect(hashLiterals[0]).toBe(tsHash); // 种子 INSERT
    expect(hashLiterals[1]).toBe(tsHash); // 迁移 UPDATE
  });
});
