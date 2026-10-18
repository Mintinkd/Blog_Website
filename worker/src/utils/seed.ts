/**
 * 种子管理员凭据的单一导出点（issue #24）。
 *
 * TS 侧所有引用一律走本模块 import；SQL 侧的 schema.sql 文件性质无法 import TS，
 * 其种子 INSERT 与迁移 UPDATE 各携带同一字面量，属已接受的重复（两处旁有注释
 * 互指本文件；worker/tests/seed_constants.test.ts 机械守卫两侧一致性）。
 *
 * ⚠ 改种子口令时，本文件的 DEFAULT_SEED_PASSWORD 与 schema.sql 须同步修改，
 * 否则门禁判定与数据库种子失配（契约面同步规则，见 CODING_STANDARDS.md）。
 */

/** 初始管理员口令明文（schema.sql 种子 INSERT 写入的就是下方哈希对应的口令） */
export const DEFAULT_SEED_PASSWORD = "password";

/** SHA-256(DEFAULT_SEED_PASSWORD) 的十六进制小写 —— schema.sql 种子 INSERT 与迁移 UPDATE 携带同一字面量 */
export const INITIAL_ADMIN_PASSWORD_HASH =
  "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";
