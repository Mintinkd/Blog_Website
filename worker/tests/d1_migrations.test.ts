// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

/**
 * issue #94 / M12：数据库迁移工具（migrations/ + baseline 标记）。
 *
 * 接缝：schema.sql 文本 + migrations/ 文件 + 真实 SQLite（node:sqlite）执行。
 * 验收：全新库按 schema.sql 一次建成无 duplicate；存量库 baseline 标记后 apply 不重放；
 * 迁移文件名符合 wrangler 约定（{number}_{name}.sql）。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = readFileSync(path.join(ROOT, "schema.sql"), "utf8");

function migrateFiles(): string[] {
  const dir = path.join(ROOT, "migrations");
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
  } catch {
    return [];
  }
}

describe("schema.sql 全新库形态（issue #94）", () => {
  it("尾部不再含不可重复的 ALTER TABLE ADD COLUMN", () => {
    expect(schema).not.toMatch(/ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN/i);
  });

  it("历史迁移列已并入 CREATE TABLE", () => {
    for (const [table, column] of [
      ["articles", "author_id"],
      ["media_assets", "uploaded_by"],
      ["categories", "created_by"],
      ["tags", "created_by"],
      ["tags", "category_id"], // #77 / taxonomy v2（ADR 0008）：并入 CREATE TABLE，存量库走增量文件
      ["users", "must_change_password"],
      ["users", "failed_login_attempts"],
      ["users", "locked_until"],
    ]) {
      const create = schema.match(
        new RegExp(
          `CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`,
          "i"
        )
      );
      expect(create, `${table} CREATE TABLE 存在`).not.toBeNull();
      expect(create![0], `${table} 应含列 ${column}`).toMatch(
        new RegExp(`\\b${column}\\b`)
      );
    }
  });

  it("真实 SQLite：全新库 schema.sql 可执行两次，均无 duplicate column", () => {
    const db = new DatabaseSync(":memory:");
    try {
      expect(() => db.exec(schema)).not.toThrow();
      // 第二次重放：全部 CREATE IF NOT EXISTS / INSERT OR IGNORE，无 ALTER → 应安全
      expect(() => db.exec(schema)).not.toThrow();
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>;
      const names = tables.map((t) => t.name);
      for (const t of ["articles", "users", "analytics_article_daily"]) {
        expect(names, `${t} 应建成`).toContain(t);
      }
    } finally {
      db.close();
    }
  });
});

describe("migrations/ 文件约定（issue #94）", () => {
  it("含 0001_baseline.sql，文件名符合 {number}_{name}.sql", () => {
    const files = migrateFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f, `${f} 命名应符合 wrangler 约定`).toMatch(
        /^\d{4}_[a-z0-9_]+\.sql$/
      );
    }
    expect(files).toContain("0001_baseline.sql");
  });

  it("真实 SQLite：极老库（连 users 表都没有）apply 0001 可补齐列与建表", () => {
    const baseline = readFileSync(
      path.join(ROOT, "migrations/0001_baseline.sql"),
      "utf8"
    );
    const db = new DatabaseSync(":memory:");
    try {
      // 极老库：只有基础表，无 users / 无迁移列
      db.exec(
        "CREATE TABLE articles(id INTEGER PRIMARY KEY, title TEXT);" +
          "CREATE TABLE media_assets(id INTEGER PRIMARY KEY, filename TEXT);" +
          "CREATE TABLE categories(id INTEGER PRIMARY KEY, name TEXT);" +
          "CREATE TABLE tags(id INTEGER PRIMARY KEY, name TEXT);"
      );
      expect(() => db.exec(baseline)).not.toThrow();
      const tables = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as Array<{ name: string }>
      ).map((r) => r.name);
      expect(tables).toContain("users");
      const cols = db.prepare("PRAGMA table_info(articles)").all() as Array<{
        name: string;
      }>;
      expect(cols.map((c) => c.name)).toContain("author_id");
    } finally {
      db.close();
    }
  });

  it("baseline 文件含历史 ALTER + legacy 口令 UPDATE（供未迁移极老库补齐）", () => {
    const baseline = readFileSync(
      path.join(ROOT, "migrations/0001_baseline.sql"),
      "utf8"
    );
    for (const frag of [
      "CREATE TABLE IF NOT EXISTS users",
      "ALTER TABLE articles ADD COLUMN author_id",
      "ALTER TABLE media_assets ADD COLUMN uploaded_by",
      "ALTER TABLE categories ADD COLUMN created_by",
      "ALTER TABLE tags ADD COLUMN created_by",
      "ALTER TABLE users ADD COLUMN must_change_password",
      "ALTER TABLE users ADD COLUMN failed_login_attempts",
      "ALTER TABLE users ADD COLUMN locked_until",
      "must_change_password = 1",
    ]) {
      expect(baseline, `baseline 应含 ${frag}`).toContain(frag);
    }
  });
});

describe("存量库 baseline 标记幂等（issue #94）", () => {
  it("baseline 标记 SQL 建 d1_migrations 表并 INSERT OR IGNORE 0001_baseline.sql", () => {
    const mark = readFileSync(
      path.join(ROOT, "migrations-baseline.sql"),
      "utf8"
    );
    expect(mark).toMatch(/CREATE TABLE IF NOT EXISTS d1_migrations/i);
    expect(mark).toMatch(/INSERT OR IGNORE INTO d1_migrations\s*\(name\)/i);
    expect(mark).toContain("0001_baseline.sql");
  });

  it("真实 SQLite：baseline 标记执行两次幂等，0001_baseline 只记一行", () => {
    const mark = readFileSync(
      path.join(ROOT, "migrations-baseline.sql"),
      "utf8"
    );
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(mark);
      db.exec(mark);
      const rows = db.prepare("SELECT name FROM d1_migrations").all() as Array<{
        name: string;
      }>;
      expect(rows.filter((r) => r.name === "0001_baseline.sql")).toHaveLength(
        1
      );
    } finally {
      db.close();
    }
  });
});
