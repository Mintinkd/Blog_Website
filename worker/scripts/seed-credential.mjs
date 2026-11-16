/**
 * 种子管理员凭据生成（issue #83 / H1）。
 *
 * 纯函数模块：无副作用、不写库、不打印口令，供 db-seed.mjs 与单测共同复用。
 * 新部署不再保留硬编码明文口令；初始口令由 randomUUID() 生成，
 * 只在 db-seed.mjs 成功写入 D1 后于终端打印一次。
 *
 * 哈希格式与 worker/src/utils/password.ts 的 hashPassword 完全一致：
 *   pbkdf2$sha256$<iterations>$<salt-hex>$<derived-hex>
 * 这样登录路径的 verifyPassword 可直接校验，且旧格式透明升级逻辑不受影响。
 */

import { randomUUID, randomBytes, pbkdf2Sync } from "node:crypto";

/** 与 worker PBKDF2_ITERATIONS 保持一致；此值进入哈希串自描述，改变需同步两处 */
export const SEED_PBKDF2_ITERATIONS = 100_000;
export const DEFAULT_SEED_ADMIN_USERNAME = "admin";

/**
 * 以与 worker hashPassword 相同的参数生成可校验的 PBKDF2 哈希。
 * @param {string} password 明文口令
 * @param {Buffer} [saltBytes] 可注入盐（单测确定性用），默认 16 随机字节
 * @returns {string}
 */
export function hashSeedPassword(password, saltBytes = randomBytes(16)) {
  const salt = saltBytes.toString("hex");
  const derived = pbkdf2Sync(
    password,
    saltBytes,
    SEED_PBKDF2_ITERATIONS,
    32,
    "sha256"
  ).toString("hex");
  return `pbkdf2$sha256$${SEED_PBKDF2_ITERATIONS}$${salt}$${derived}`;
}

/**
 * 生成一组随机种子凭据。口令取 randomUUID().slice(0,16)（票面字面要求），
 * 哈希立即可被 worker 的 verifyPassword 校验。
 * @returns {{ password: string, passwordHash: string }}
 */
export function generateSeedCredential() {
  const password = randomUUID().slice(0, 16);
  return { password, passwordHash: hashSeedPassword(password) };
}

/**
 * 构造把种子管理员写入 users 的 UPSERT SQL。
 * 用户名经白名单校验，杜绝 SQL 注入；哈希串仅含 [0-9a-f$]，盐/派生值安全。
 * must_change_password=1：即使随机口令泄露，首次登录仍强制改密（与项目初始口令策略一致）。
 * @param {string} username
 * @param {string} passwordHash
 * @returns {string}
 */
export function seedUpsertSql(username, passwordHash) {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(username)) {
    throw new Error("Invalid seed admin username");
  }
  if (!/^pbkdf2\$sha256\$\d+\$[0-9a-f]+\$[0-9a-f]+$/.test(passwordHash)) {
    throw new Error("Invalid seed password hash format");
  }
  return (
    "INSERT INTO users (username, password_hash, display_name, role, must_change_password) " +
    `VALUES ('${username}', '${passwordHash}', '管理员', 'admin', 1) ` +
    "ON CONFLICT(username) DO UPDATE SET " +
    "password_hash=excluded.password_hash, must_change_password=1, " +
    "failed_login_attempts=0, locked_until=NULL"
  );
}
