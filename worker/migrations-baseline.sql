-- 存量库 baseline 标记（issue #94 / M12）。禁止手工编辑以外的用途。
--
-- 对「已执行过历史 ALTER」的存量库与「已按新 schema.sql 建成」的全新库执行本文件，
-- 把 0001_baseline 记为已应用，避免日后 `wrangler d1 migrations apply` 重放 ALTER
-- 导致 duplicate column。本文件幂等，可重复执行。
--
-- d1_migrations 表结构与 wrangler 内置一致（id / name UNIQUE / applied_at）。

CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- name 必须与迁移文件名逐字一致（wrangler 用带 .sql 的文件名比对）
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0001_baseline.sql');
