-- Blog Site D1 Database Schema
-- Project: blog_website
--
-- 全新库形态（issue #94 / M12）：历史 ALTER 迁移列直接并入 CREATE TABLE；
-- 存量库的同一批 ALTER + UPDATE 收录于 migrations/0001_baseline.sql。
-- 本文件可重复执行（全为 CREATE IF NOT EXISTS / INSERT OR IGNORE），无 duplicate column。

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'editor')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  -- taxonomy v2（#75 / ADR 0008）：标签归属分类，1:N；迁移期可空，回填后由应用层保证必填。
  -- 存量库的 ALTER + 索引 + 未分类种子 + 回填 UPDATE 见 schema-tag-category-incremental.sql（一次性）。
  category_id INTEGER REFERENCES categories(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL DEFAULT '',
  content_html TEXT NOT NULL DEFAULT '',
  summary TEXT DEFAULT '',
  cover_image TEXT DEFAULT '',
  category_id INTEGER,
  author_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  view_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  reading_time INTEGER NOT NULL DEFAULT 1,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS article_tags (
  article_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (article_id, tag_id),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  nickname TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS article_likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (article_id, ip_hash),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  kv_key TEXT NOT NULL UNIQUE,
  storage_type TEXT NOT NULL DEFAULT 'kv' CHECK (storage_type IN ('kv', 'r2')),
  alt_text TEXT DEFAULT '',
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS friend_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT DEFAULT '',
  logo_url TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS site_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  is_public INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_articles_slug ON articles(slug);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_category_id ON articles(category_id);
-- taxonomy v2（#75 / ADR 0008）：按分类取标签、标签列表 join 的过滤路径
CREATE INDEX IF NOT EXISTS idx_tags_category_id ON tags(category_id);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_comments_article_id ON comments(article_id);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status);
CREATE INDEX IF NOT EXISTS idx_article_likes_article_id ON article_likes(article_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_kv_key ON media_assets(kv_key);
CREATE INDEX IF NOT EXISTS idx_friend_links_sort ON friend_links(sort_order);
-- #73 / M22：补齐两个高频查询路径的二级索引（幂等，存量库重跑初始化即可生效）
CREATE INDEX IF NOT EXISTS idx_comments_article_id_status ON comments(article_id, status);
CREATE INDEX IF NOT EXISTS idx_friend_links_is_active ON friend_links(is_active);

-- FTS5 Full-text Search Virtual Table
CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  title,
  content,
  category_name,
  tag_names,
  content=articles,
  content_rowid=id
);

-- FTS5 Sync Triggers
CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, content, category_name, tag_names)
    VALUES (
      NEW.id,
      NEW.title,
      NEW.content,
      COALESCE((SELECT name FROM categories WHERE id = NEW.category_id), ''),
      COALESCE((SELECT group_concat(t.name, ',') FROM article_tags at JOIN tags t ON at.tag_id = t.id WHERE at.article_id = NEW.id), '')
    );
END;

CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, content, category_name, tag_names)
    VALUES('delete', OLD.id, OLD.title, OLD.content, '', '');
END;

CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, content, category_name, tag_names)
    VALUES('delete', OLD.id, OLD.title, OLD.content, '', '');
  INSERT INTO articles_fts(rowid, title, content, category_name, tag_names)
    VALUES (
      NEW.id,
      NEW.title,
      NEW.content,
      COALESCE((SELECT name FROM categories WHERE id = NEW.category_id), ''),
      COALESCE((SELECT group_concat(t.name, ',') FROM article_tags at JOIN tags t ON at.tag_id = t.id WHERE at.article_id = NEW.id), '')
    );
END;

-- Initial Data: Default Category
INSERT OR IGNORE INTO categories (name, slug, description) VALUES ('未分类', 'uncategorized', '默认分类');

-- Initial Data: Site Configuration
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('site_title', 'My Blog', 1);
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('site_subtitle', '记录技术与生活', 1);
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('site_description', '个人独立博客，分享技术心得与生活感悟', 1);
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('site_keywords', '博客,技术,开发', 1);
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('posts_per_page', '10', 1);
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('about_content', '', 1);
-- 个人名片（/about 页）：value 为 JSON 字符串，空串 = 未配置，前台走占位名片降级。
-- 老库无此行也无妨：PUT /config 用 UPSERT 首次保存时自动建行，无需迁移。
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('profile_card', '', 1);
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('admin_username', 'admin', 0);
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('admin_password_hash', '', 0);
-- jwt_secret: auto-generated on first read if empty (self-healing), see worker/src/middleware/auth.ts
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('jwt_secret', '', 0);

-- #83 / H1：全新库不再写入任何硬编码可登录口令。
-- 初始化后必须执行 `npm run db:seed`（worker/scripts/db-seed.mjs）生成随机初始口令，
-- 该口令只在终端打印一次，首次登录强制改密。切勿在 SQL 中固化口令。
-- 存量 site_config 凭据仍由 login API 在首次登录时自动迁移到 users 表。
-- 历史增量 ALTER / UPDATE（author_id / uploaded_by / created_by / 须改密列 + legacy 口令标记）
-- 已按 issue #94 / M12 收编到 migrations/0001_baseline.sql，仅供未迁移的极老库补齐；
-- 全新库不再需要执行它们——其列已并入上方 CREATE TABLE。

-- 依赖迁移列的索引（列已在 CREATE TABLE 内，全新库初始化不报 no such column）
CREATE INDEX IF NOT EXISTS idx_articles_author_id ON articles(author_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_uploaded_by ON media_assets(uploaded_by);

-- ── 阅读统计 Tier 0（issue #53 / docs/READER_ANALYTICS.md §5） ──
-- 本段全部 IF NOT EXISTS，可重复执行；存量库的增量片段见 README「初始化数据库」。
-- 不建 analytics_consent（Tier 1，本批不做）。

-- 每日文章聚合：趋势与后台主查询来源
CREATE TABLE IF NOT EXISTS analytics_article_daily (
  article_id   INTEGER NOT NULL,
  day          TEXT    NOT NULL,              -- YYYY-MM-DD，站点时区 Asia/Shanghai
  pv           INTEGER NOT NULL DEFAULT 0,
  uv           INTEGER NOT NULL DEFAULT 0,
  requests     INTEGER NOT NULL DEFAULT 0,    -- 含直连 API 的过滤后 200，用于代理覆盖率
  engaged      INTEGER NOT NULL DEFAULT 0,
  bot_filtered INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (article_id, day)
);

-- 24h 去重令牌：不含 IP 明文
CREATE TABLE IF NOT EXISTS analytics_view_token (
  token      TEXT PRIMARY KEY,               -- HMAC hex
  day        TEXT NOT NULL,                  -- YYYY-MM-DD，站点时区
  expires_at TEXT NOT NULL                   -- UTC，YYYY-MM-DD HH:MM:SS（同 datetime('now')）
);

CREATE INDEX IF NOT EXISTS idx_view_token_expires
  ON analytics_view_token(expires_at);

-- 维度桶：只写单篇行；全站视图由查询时 GROUP BY 聚合
CREATE TABLE IF NOT EXISTS analytics_dim_daily (
  day        TEXT    NOT NULL,
  dim        TEXT    NOT NULL,               -- 全量取值；Tier 0 先落 device|country|referrer（#56）
  bucket     TEXT    NOT NULL,
  article_id INTEGER NOT NULL,               -- 所属文章；不写全站行
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, dim, bucket, article_id)
);

CREATE INDEX IF NOT EXISTS idx_dim_daily_lookup
  ON analytics_dim_daily(day, dim);

-- 统计 HMAC 密钥首次使用时懒生成（独立于 jwt_secret）；清理任务心跳。
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('analytics_hmac_secret', '', 0);
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('analytics_last_job_at', '', 0);