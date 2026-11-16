-- D1 baseline migration 0001（issue #94 / M12）
--
-- 收录 schema.sql 在引入迁移框架前的历史增量 ALTER + UPDATE。
-- 用途：从未执行过这些增量语句的极老库，可通过 `wrangler d1 migrations apply blog-db --remote` 补齐。
--
-- 已迁移的存量库与全新库**不要执行本文件**：
--   - 已迁移库：列已存在，执行会 duplicate column；用 migrations-baseline.sql 标记本迁移为已应用即可。
--   - 全新库：列已并入 schema.sql 的 CREATE TABLE，同样只标记、不执行。
-- 命令与 baseline 标记流程见 README「初始化数据库 / 数据库迁移」章节。

-- Add author_id to articles
ALTER TABLE articles ADD COLUMN author_id INTEGER REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_articles_author_id ON articles(author_id);
UPDATE articles SET author_id = (SELECT id FROM users WHERE role = 'admin' LIMIT 1) WHERE author_id IS NULL;

-- Add uploaded_by to media_assets
ALTER TABLE media_assets ADD COLUMN uploaded_by INTEGER REFERENCES users(id);
UPDATE media_assets SET uploaded_by = (SELECT id FROM users WHERE role = 'admin' LIMIT 1) WHERE uploaded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_media_assets_uploaded_by ON media_assets(uploaded_by);

-- Add created_by to categories and tags
ALTER TABLE categories ADD COLUMN created_by INTEGER REFERENCES users(id);
ALTER TABLE tags ADD COLUMN created_by INTEGER REFERENCES users(id);

-- users 加「须改密」标记与登录失败锁定（P1-5 / issue #8）
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
-- #83 / H1：仅识别**存量库**中仍在使用历史种子口令（SHA-256("password")）的账号并强制改密。
-- 字面量为 worker/src/utils/seed.ts 的 LEGACY_SEED_PASSWORD_HASH 的 SQL 拷贝（SQL 无法 import TS），
-- 由 worker/tests/seed_constants.test.ts 机械守卫。此哈希不用于建号——新部署走 npm run db:seed。
UPDATE users SET must_change_password = 1 WHERE password_hash = '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8';
