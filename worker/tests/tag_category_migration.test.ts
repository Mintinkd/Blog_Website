// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

/**
 * issue #77 / T1：tags.category_id 增量迁移与回填审计。
 *
 * 接缝：schema.sql（全新库形态）+ schema-tag-category-incremental.sql（存量库一次性）
 * + 真实 SQLite（node:sqlite）执行。
 *
 * 验收对照（票面）：
 * - fresh install 跑 schema.sql 后 PRAGMA table_info(tags) 含 category_id；
 * - 存量库执行增量成功，tags / article_tags / articles 行数不变；
 * - 回填后 SELECT COUNT(*) FROM tags WHERE category_id IS NULL = 0；
 * - 回填规则确定性：多数票 → 平票取较小 id → 无文章归未分类；
 * - 增量文件重复执行报 duplicate column（README 已写明只允许执行一次）。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = readFileSync(path.join(ROOT, "schema.sql"), "utf8");
const incremental = readFileSync(
  path.join(ROOT, "schema-tag-category-incremental.sql"),
  "utf8"
);

describe("taxonomy v2 全新库形态（#77 / ADR 0008）", () => {
  it("category_id 已并入 CREATE TABLE tags（schema.sql 不允许尾部 ALTER）", () => {
    const createTags = schema.match(
      /CREATE TABLE IF NOT EXISTS tags \([\s\S]*?\n\);/i
    );
    expect(createTags, "tags CREATE TABLE 存在").not.toBeNull();
    expect(createTags![0]).toMatch(/\bcategory_id\b/);
    expect(createTags![0]).toMatch(/REFERENCES\s+categories\s*\(\s*id\s*\)/i);
    // #94 / M12 的硬约定：schema.sql 保持可重复执行
    expect(schema).not.toMatch(/ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN/i);
  });

  it("idx_tags_category_id 在 schema.sql 与增量文件中语句一致（单一来源机械守卫）", () => {
    const name = "idx_tags_category_id";
    const inSchema = schema.match(
      new RegExp(`^CREATE[^\\n]*${name}[^\\n]*;`, "im")
    );
    const inIncremental = incremental.match(
      new RegExp(`^CREATE[^\\n]*${name}[^\\n]*;`, "im")
    );
    expect(inSchema, `${name} 应在 schema.sql 中`).not.toBeNull();
    expect(inIncremental, `${name} 应在增量 DDL 中`).not.toBeNull();
    expect(inIncremental![0].replace(/\s+/g, " ").trim()).toBe(
      inSchema![0].replace(/\s+/g, " ").trim()
    );
  });

  it("真实 SQLite：全新库 schema.sql 执行后 PRAGMA table_info(tags) 含 category_id 且索引存在", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(schema);
      const cols = db.prepare("PRAGMA table_info(tags)").all() as Array<{
        name: string;
      }>;
      expect(cols.map((c) => c.name)).toContain("category_id");
      const indexes = db.prepare("PRAGMA index_list(tags)").all() as Array<{
        name: string;
      }>;
      expect(indexes.map((i) => i.name)).toContain("idx_tags_category_id");
      // 全新库 seed 已含未分类
      const cat = db
        .prepare("SELECT id FROM categories WHERE slug = 'uncategorized'")
        .all() as Array<{ id: number }>;
      expect(cat).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});

describe("taxonomy v2 增量迁移（#77 存量库路径）", () => {
  /** 构造「迁移前」的存量库形态：tags 无 category_id，其余最小可用。 */
  function buildLegacyDb(): DatabaseSync {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT ''
      );
      CREATE TABLE tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        category_id INTEGER,
        status TEXT NOT NULL DEFAULT 'draft'
      );
      CREATE TABLE article_tags (
        article_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (article_id, tag_id)
      );
    `);
    return db;
  }

  interface SeedRow {
    sql: string;
  }
  function seed(db: DatabaseSync, rows: SeedRow[]) {
    for (const r of rows) db.exec(r.sql);
  }

  it("真实 SQLite：回填规则确定性（多数票 / 平票取小 id / 无文章与全 NULL 票归未分类），行数不变", () => {
    const db = buildLegacyDb();
    try {
      seed(db, [
        // 老库只带两个业务分类，未分类由迁移种子补
        {
          sql: "INSERT INTO categories (name, slug) VALUES ('前端', 'frontend')",
        }, // id 1
        {
          sql: "INSERT INTO categories (name, slug) VALUES ('后端', 'backend')",
        }, // id 2
        // 标签
        { sql: "INSERT INTO tags (name, slug) VALUES ('多数票', 'majority')" }, // id 1 → 前端(3票) vs 后端(1票)
        { sql: "INSERT INTO tags (name, slug) VALUES ('平票', 'tie')" }, // id 2 → 前端(1) vs 后端(1) → 取较小 id = 前端
        { sql: "INSERT INTO tags (name, slug) VALUES ('无文章', 'orphan')" }, // id 3 → 未分类
        { sql: "INSERT INTO tags (name, slug) VALUES ('全空票', 'nullvotes')" }, // id 4 → 引用文章 category_id 全 NULL → 未分类
        // 文章（含草稿：草稿同样参与投票——票面「article_tags 关联文章」未区分状态）
        {
          sql: "INSERT INTO articles (title, category_id, status) VALUES ('a1', 1, 'published')",
        },
        {
          sql: "INSERT INTO articles (title, category_id, status) VALUES ('a2', 1, 'published')",
        },
        {
          sql: "INSERT INTO articles (title, category_id, status) VALUES ('a3', 1, 'draft')",
        },
        {
          sql: "INSERT INTO articles (title, category_id, status) VALUES ('a4', 2, 'published')",
        },
        {
          sql: "INSERT INTO articles (title, category_id, status) VALUES ('a5', 2, 'published')",
        },
        {
          sql: "INSERT INTO articles (title, category_id, status) VALUES ('a6', NULL, 'published')",
        },
        // 关联：多数票 = 前端 3 票 + 后端 1 票；平票 = 后端 1 票 + 前端 1 票；全空票 = NULL 分类文章
        {
          sql: "INSERT INTO article_tags VALUES (1, 1), (2, 1), (3, 1), (4, 1)",
        },
        { sql: "INSERT INTO article_tags VALUES (4, 2), (1, 2)" },
        { sql: "INSERT INTO article_tags VALUES (6, 4)" },
      ]);

      const before = {
        tags: (db.prepare("SELECT COUNT(*) n FROM tags").get() as { n: number })
          .n,
        at: (
          db.prepare("SELECT COUNT(*) n FROM article_tags").get() as {
            n: number;
          }
        ).n,
        articles: (
          db.prepare("SELECT COUNT(*) n FROM articles").get() as { n: number }
        ).n,
      };

      expect(() => db.exec(incremental)).not.toThrow();

      // 行数不变
      const after = {
        tags: (db.prepare("SELECT COUNT(*) n FROM tags").get() as { n: number })
          .n,
        at: (
          db.prepare("SELECT COUNT(*) n FROM article_tags").get() as {
            n: number;
          }
        ).n,
        articles: (
          db.prepare("SELECT COUNT(*) n FROM articles").get() as { n: number }
        ).n,
      };
      expect(after).toEqual(before);

      // 列与索引
      const cols = db.prepare("PRAGMA table_info(tags)").all() as Array<{
        name: string;
      }>;
      expect(cols.map((c) => c.name)).toContain("category_id");
      const indexes = db.prepare("PRAGMA index_list(tags)").all() as Array<{
        name: string;
      }>;
      expect(indexes.map((i) => i.name)).toContain("idx_tags_category_id");

      // 未分类种子已补（老库原本没有）
      const unc = db
        .prepare("SELECT id FROM categories WHERE slug = 'uncategorized'")
        .get() as { id: number };

      // 回填结果（手写字面量，不从实现推回）
      const rows = db
        .prepare("SELECT slug, category_id FROM tags ORDER BY id")
        .all() as Array<{ slug: string; category_id: number | null }>;
      expect(rows).toEqual([
        { slug: "majority", category_id: 1 }, // 前端 3 票 > 后端 1 票
        { slug: "tie", category_id: 1 }, // 1:1 平票 → 较小 id = 前端(1)
        { slug: "orphan", category_id: unc.id }, // 无文章 → 未分类
        { slug: "nullvotes", category_id: unc.id }, // 票全来自 NULL 分类文章 → 未分类
      ]);

      // null 归零
      const nulls = db
        .prepare("SELECT COUNT(*) n FROM tags WHERE category_id IS NULL")
        .get() as { n: number };
      expect(nulls.n).toBe(0);

      // article_tags 与 articles.category_id 不被迁移改写
      const untouched = db
        .prepare("SELECT COUNT(*) n FROM articles WHERE category_id IS NULL")
        .get() as { n: number };
      expect(untouched.n).toBe(1); // 文章 6 仍是 NULL
    } finally {
      db.close();
    }
  });

  it("增量文件重复执行报 duplicate column（一次性契约，README 已写明）", () => {
    const db = buildLegacyDb();
    try {
      db.exec(incremental);
      expect(() => db.exec(incremental)).toThrow(
        /duplicate column name: category_id/
      );
    } finally {
      db.close();
    }
  });

  it("增量文件含未分类种子、回填 UPDATE 与三类审计 SQL（文本契约）", () => {
    expect(incremental).toContain("ALTER TABLE tags ADD COLUMN category_id");
    expect(incremental).toMatch(
      /INSERT OR IGNORE INTO categories[\s\S]*uncategorized/
    );
    expect(incremental).toMatch(/UPDATE tags\s+SET category_id/);
    expect(incremental).toContain("null_category_tags"); // 审计 1：null 归零检查
    expect(incremental).toContain("article_category_name"); // 审计 2：跨分类清单
    expect(incremental).toContain("tag_count"); // 审计 3：各分类标签数
    // 平票取较小 id 的确定性排序
    expect(incremental).toMatch(
      /ORDER BY COUNT\(\*\) DESC,\s*a\.category_id ASC/
    );
  });
});
