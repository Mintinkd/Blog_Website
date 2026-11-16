/**
 * 历史种子凭据的**存量识别**单一来源（issue #24 建立，#83 / H1 收窄）。
 *
 * #83 起，新部署不再有硬编码明文口令：初始口令由 `npm run db:seed`
 * （worker/scripts/seed-credential.mjs）用 randomUUID() 生成并只在终端打印一次。
 *
 * 本模块保留的两个常量**只用于存量库识别**（旧部署曾用固定口令 "password"）：
 *  - 登录时识别「仍用历史种子明文/哈希」的账号，强制打 must_change_password 标记；
 *  - 弱口令名单纳入该明文，防止任何人改回它。
 * 它们不参与任何新账号创建，也不代表当前任何账号的口令。
 * schema.sql 的存量迁移 UPDATE 携带 LEGACY_SEED_PASSWORD_HASH 的字面量
 * （SQL 无法 import TS，属已接受的重复，由 seed_constants.test.ts 机械守卫）。
 */

/**
 * 历史种子口令的 SHA-256（十六进制小写）。仅用于识别存量弱口令账号并强制改密；
 * 不用于建号，不是当前任何账号的口令。
 */
export const LEGACY_SEED_PASSWORD_HASH =
  "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";

/**
 * 历史种子口令明文。仅用于「登录口令等于历史种子值」的存量判定与弱口令拦截；
 * 新部署的初始口令与此无关，由 db:seed 随机生成。
 */
export const LEGACY_SEED_PLAINTEXT = "password";
