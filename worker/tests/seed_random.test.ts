import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEED_ADMIN_USERNAME,
  generateSeedCredential,
  hashSeedPassword,
  SEED_PBKDF2_ITERATIONS,
  seedUpsertSql,
} from "../scripts/seed-credential.mjs";
import { verifyPassword } from "../src/utils/password";

/**
 * issue #83（H1）AC1：新部署不再出现硬编码可登录口令，
 * db:seed 随机口令仅输出一次，无法从仓库或响应复现。
 *
 * 接缝：worker/scripts/seed-credential.mjs 的纯函数（无写库/无打印副作用）。
 * 期望值取自票面字面量（randomUUID().slice(0,16) 的 16 位、PBKDF2 可被 worker 校验）。
 */

describe("随机种子凭据（issue #83）", () => {
  it("口令为 16 字符、符合 randomUUID 前缀形态，且两次生成不同", () => {
    const a = generateSeedCredential();
    const b = generateSeedCredential();
    expect(a.password).toHaveLength(16);
    // randomUUID().slice(0,16) = 8hex + '-' + 4hex + '-' + 2hex
    expect(a.password).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{2}$/);
    expect(b.password).not.toBe(a.password);
  });

  it("哈希格式与 worker hashPassword 一致，且能被 verifyPassword 校验", async () => {
    const { password, passwordHash } = generateSeedCredential();
    expect(passwordHash).toMatch(
      new RegExp(`^pbkdf2\\$sha256\\$${SEED_PBKDF2_ITERATIONS}\\$`)
    );
    const verified = await verifyPassword(password, passwordHash);
    expect(verified.ok).toBe(true);
    expect(verified.needsUpgrade).toBe(false);
  });

  it("错误口令校验失败，且注入确定性盐时哈希可复现（便于运维核对）", async () => {
    const salt = Buffer.from("00112233445566778899aabbccddeeff", "hex");
    const h1 = hashSeedPassword("a-fixed-pass", salt);
    const h2 = hashSeedPassword("a-fixed-pass", salt);
    expect(h1).toBe(h2);
    expect((await verifyPassword("wrong-pass", h1)).ok).toBe(false);
  });

  it("UPSERT SQL 置 must_change_password=1 且清空锁定字段", () => {
    const { passwordHash } = generateSeedCredential();
    const sql = seedUpsertSql(DEFAULT_SEED_ADMIN_USERNAME, passwordHash);
    expect(sql).toMatch(/INSERT INTO users/i);
    expect(sql).toMatch(/ON CONFLICT\(username\) DO UPDATE/i);
    expect(sql).toMatch(/must_change_password\s*=\s*1/);
    expect(sql).toMatch(/failed_login_attempts\s*=\s*0/);
    expect(sql).toMatch(/locked_until\s*=\s*NULL/);
  });

  it("拒绝注入型用户名与畸形哈希（写入口不展开注入面）", () => {
    const { passwordHash } = generateSeedCredential();
    expect(() => seedUpsertSql("admin' OR '1'='1", passwordHash)).toThrow();
    expect(() => seedUpsertSql("admin", "not-a-hash")).toThrow();
  });
});
