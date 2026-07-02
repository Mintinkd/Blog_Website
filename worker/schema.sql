-- Blog Site D1 Database Schema
-- Project: blog_website

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
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
  category_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  view_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
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
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_comments_article_id ON comments(article_id);
CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status);
CREATE INDEX IF NOT EXISTS idx_article_likes_article_id ON article_likes(article_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_kv_key ON media_assets(kv_key);
CREATE INDEX IF NOT EXISTS idx_friend_links_sort ON friend_links(sort_order);

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
    SELECT
      NEW.id,
      NEW.title,
      NEW.content,
      COALESCE(c.name, ''),
      COALESCE((SELECT group_concat(t.name, ',') FROM article_tags at JOIN tags t ON at.tag_id = t.id WHERE at.article_id = NEW.id), '')
    FROM categories c WHERE c.id = NEW.category_id;
END;

CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, content, category_name, tag_names)
    VALUES('delete', OLD.id, OLD.title, OLD.content, '', '');
END;

CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, content, category_name, tag_names)
    VALUES('delete', OLD.id, OLD.title, OLD.content, '', '');
  INSERT INTO articles_fts(rowid, title, content, category_name, tag_names)
    SELECT
      NEW.id,
      NEW.title,
      NEW.content,
      COALESCE(c.name, ''),
      COALESCE((SELECT group_concat(t.name, ',') FROM article_tags at JOIN tags t ON at.tag_id = t.id WHERE at.article_id = NEW.id), '')
    FROM categories c WHERE c.id = NEW.category_id;
END;

-- Initial Data: Default Category
INSERT OR IGNORE INTO categories (name, slug, description) VALUES ('未分类', 'uncategorized', '默认分类');

-- Initial Data: Site Configuration
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('site_title', 'Smart Learn Assistant', 1);
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('site_subtitle', '记录技术与生活', 1);
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('site_description', '个人独立博客，分享技术心得与生活感悟', 1);
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('site_keywords', '博客,技术,开发', 1);
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('posts_per_page', '10', 1);
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('about_content', '', 1);
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('admin_username', 'admin', 0);
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('admin_password_hash', '', 0);
INSERT OR IGNORE INTO site_config (key, value, is_public) VALUES ('jwt_secret', '', 0);