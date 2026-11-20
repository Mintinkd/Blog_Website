import { describe, expect, it } from "vitest";
import {
  UNCATEGORIZED_LOOKUP_SQL,
  backupQuerySql,
  countQuerySql,
  deleteAllSql,
  deleteSkipSql,
  exportQuerySql,
  insertSql,
} from "../src/services/admin_sql";

/**
 * issue #112 item 13：admin SQL 构造模块单测。
 *
 * 从 admin.ts 下沉的 SQL 拼接逻辑，handler 不再内联 SQL 字符串。
 * 本测试钉住各 builder 的输出格式，改 SQL 构造但改 handler 不红。
 */

describe("admin_sql builders（#112 item 13）", () => {
  it("exportQuerySql: 分页导出查询", () => {
    expect(exportQuerySql("articles", "id, title, content")).toBe(
      "SELECT id, title, content FROM articles LIMIT ? OFFSET ?"
    );
  });

  it("countQuerySql: 全表计数", () => {
    expect(countQuerySql("tags")).toBe("SELECT COUNT(*) AS count FROM tags");
  });

  it("backupQuerySql: 全量备份查询", () => {
    expect(backupQuerySql("categories", "id, slug, name")).toBe(
      "SELECT id, slug, name FROM categories"
    );
  });

  it("deleteAllSql: 全表删除", () => {
    expect(deleteAllSql("articles")).toBe("DELETE FROM articles");
  });

  it("deleteSkipSql: 跳过密钥行的删除", () => {
    expect(deleteSkipSql("config", 3)).toBe(
      "DELETE FROM config WHERE key NOT IN (?, ?, ?)"
    );
  });

  it("insertSql: 插入语句", () => {
    expect(insertSql("tags", ["id", "slug", "name"])).toBe(
      "INSERT INTO tags (id, slug, name) VALUES (?, ?, ?)"
    );
  });

  it("UNCATEGORIZED_LOOKUP_SQL: 未分类查找常量", () => {
    expect(UNCATEGORIZED_LOOKUP_SQL).toBe(
      "SELECT id FROM categories WHERE slug = 'uncategorized'"
    );
  });
});

describe("admin.ts 不再内联 SQL 拼接（#112 item 13 守卫）", () => {
  it("admin.ts 不含模板字符串 SQL（SELECT / INSERT / DELETE / COUNT）", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(
      resolve(import.meta.dirname, "../src/handlers/admin.ts"),
      "utf8"
    );
    // 不应有内联的 SQL 模板字符串（已下沉到 admin_sql.ts）
    expect(src).not.toMatch(/`SELECT\s+\$\{/);
    expect(src).not.toMatch(/`INSERT\s+INTO\s+\$\{/);
    expect(src).not.toMatch(/`DELETE\s+FROM\s+\$\{/);
    expect(src).not.toMatch(/`SELECT\s+COUNT/);
  });
});
