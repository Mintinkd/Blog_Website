-- CI 迁移后核对（scripts/verify-d1-migrations.mjs 消费）：
-- 两个增量 DDL 产出的 3 表 + 5 索引都应存在；缺失任一项 CI 即红。
-- #111 item 8：migrate-reading-time.mjs 加的 reading_time 列也在此核对。
SELECT name FROM sqlite_master
WHERE name IN (
  'analytics_article_daily',
  'analytics_view_token',
  'analytics_dim_daily',
  'idx_view_token_expires',
  'idx_dim_daily_lookup',
  'idx_media_assets_uploaded_by',
  'idx_comments_article_id_status',
  'idx_friend_links_is_active'
)
UNION ALL
-- 迁移脚本添加的列（PRAGMA table_info 返回列名，与上面的对象名合并核对）
SELECT name FROM pragma_table_info('articles') WHERE name IN ('reading_time');
