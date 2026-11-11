-- 阅读统计 Tier 0 增量 DDL（issue #53 / #56）
-- 单一事实源：worker/schema.sql 尾部「阅读统计 Tier 0」段；本文件供已有部署升级直接执行。
-- 全部 IF NOT EXISTS，重复执行安全；不含 DROP / DELETE / UPDATE / ALTER，不触碰现有表与数据。
-- 用法（必须在 worker/ 目录下、带 --remote）：
--   npx wrangler d1 execute blog-db --remote --file=./schema-tier0-incremental.sql

CREATE TABLE IF NOT EXISTS analytics_article_daily (
  article_id   INTEGER NOT NULL,
  day          TEXT    NOT NULL,
  pv           INTEGER NOT NULL DEFAULT 0,
  uv           INTEGER NOT NULL DEFAULT 0,
  requests     INTEGER NOT NULL DEFAULT 0,
  engaged      INTEGER NOT NULL DEFAULT 0,
  bot_filtered INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (article_id, day)
);

CREATE TABLE IF NOT EXISTS analytics_view_token (
  token      TEXT PRIMARY KEY,
  day        TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_view_token_expires
  ON analytics_view_token(expires_at);

CREATE TABLE IF NOT EXISTS analytics_dim_daily (
  day        TEXT    NOT NULL,
  dim        TEXT    NOT NULL,
  bucket     TEXT    NOT NULL,
  article_id INTEGER NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, dim, bucket, article_id)
);

CREATE INDEX IF NOT EXISTS idx_dim_daily_lookup
  ON analytics_dim_daily(day, dim);
