-- M22 索引增量 DDL（issue #73）
-- 单一事实源：worker/schema.sql 的「Indexes」段与 media_assets 迁移段；本文件供已有部署升级直接执行。
-- 全部 CREATE INDEX IF NOT EXISTS，重复执行安全；不含 DROP / DELETE / UPDATE / ALTER，不触碰现有数据。
-- 前置条件：存量库须已执行过 schema.sql 尾部的 ALTER TABLE 迁移（uploaded_by / 等列已存在）。
-- 用法（必须在 worker/ 目录下、带 --remote）：
--   npx wrangler d1 execute blog-db --remote --file=./schema-m22-incremental.sql

CREATE INDEX IF NOT EXISTS idx_media_assets_uploaded_by ON media_assets(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_comments_article_id_status ON comments(article_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_links_is_active ON friend_links(is_active);
