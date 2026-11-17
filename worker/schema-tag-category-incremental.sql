-- Blog Site D1 Database — taxonomy v2 标签归属迁移（一次性）
-- Project: blog_website
--
-- issue #75 / #77 / ADR 0008（docs/adr/0008-tag-as-category-subsystem.md）。
-- 适用对象：**存量库**（fresh install 直接跑 schema.sql，tags 已含 category_id，无需本文件）。
--
-- ⚠️ 本文件只允许执行一次：语句 1 是不带 IF NOT EXISTS 的 ALTER TABLE ADD COLUMN，
--    重复执行会报 `duplicate column name: category_id`。执行前必须先
--    `wrangler d1 export` 导出备份，并在副本上演练通过（行数不变 → 空值归零 →
--    跨分类清单产出）才允许在生产执行。回滚：只回代码不回 schema，数据用迁移前备份恢复。
--
-- 回填规则（ADR 0008 决策 4，确定性可重放）：
--   按引用该标签的文章（article_tags 关联，含草稿与已发布）的 articles.category_id 投票，
--   取出现次数最多的分类；平票取较小分类 id；category_id 为 NULL 的文章不参与投票；
--   无任何有效票的标签归「未分类」（slug = uncategorized）。
--   只写 tags 表：不删改 article_tags、不自动改任何文章的 category_id。

-- 1) 加列（重复执行本文件必在此报 duplicate column）
ALTER TABLE tags ADD COLUMN category_id INTEGER REFERENCES categories(id);

-- 2) 归属过滤索引（与 schema.sql 同语句；幂等）
CREATE INDEX IF NOT EXISTS idx_tags_category_id ON tags(category_id);

-- 3) 「未分类」种子（幂等；老库若已有同 slug 行则忽略）
INSERT OR IGNORE INTO categories (name, slug, description) VALUES ('未分类', 'uncategorized', '默认分类');

-- 4) 存量回填：按引用文章的分类投票（多数 → 平票取小 id），无票标签暂留 NULL
UPDATE tags
SET category_id = (
  SELECT a.category_id
  FROM article_tags at
  JOIN articles a ON at.article_id = a.id
  WHERE at.tag_id = tags.id
    AND a.category_id IS NOT NULL
  GROUP BY a.category_id
  ORDER BY COUNT(*) DESC, a.category_id ASC
  LIMIT 1
)
WHERE category_id IS NULL;

-- 5) 兜底：仍无归属（无文章引用，或引用文章全部未分类）的标签归「未分类」
UPDATE tags
SET category_id = (SELECT id FROM categories WHERE slug = 'uncategorized')
WHERE category_id IS NULL;

-- ── 审计 SQL（post 检查，执行完看输出）──────────────────────────────────

-- 审计 1：null category 必须为 0（= 0 才算迁移成功）
SELECT COUNT(*) AS null_category_tags
FROM tags
WHERE category_id IS NULL;

-- 审计 2：跨分类标签清单（文章分类 ≠ 所挂标签的归属；供 #82 人工整理）
--   迁移后通常非空属预期（回填只动 tags），逐条核对后在后台把标签移位或调整文章分类。
SELECT a.category_id AS article_category,
       c1.name       AS article_category_name,
       t.id          AS tag_id,
       t.name        AS tag_name,
       t.category_id AS tag_category,
       c2.name       AS tag_category_name,
       COUNT(*)      AS usage_count
FROM article_tags at
JOIN articles a ON at.article_id = a.id
JOIN tags t ON at.tag_id = t.id
LEFT JOIN categories c1 ON c1.id = a.category_id
LEFT JOIN categories c2 ON c2.id = t.category_id
WHERE a.category_id IS NOT NULL
  AND t.category_id IS NOT NULL
  AND a.category_id != t.category_id
GROUP BY a.category_id, t.id
ORDER BY usage_count DESC, t.id ASC;

-- 审计 3：各分类标签数（迁移后的分布快照）
SELECT c.id   AS category_id,
       c.name AS category_name,
       COUNT(t.id) AS tag_count
FROM categories c
LEFT JOIN tags t ON t.category_id = c.id
GROUP BY c.id
ORDER BY tag_count DESC, c.id ASC;
