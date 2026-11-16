import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * issue #73 / M22：索引幂等 + SELECT * 清零（结构断言）。
 *
 * 这些是「代码/迁移形状」的行为锁：schema 必须含三个幂等索引（全新部署与存量库
 * 都能生效），目标文件不得遗留 SELECT * / SELECT <alias>.*（全列读取）。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("M22 索引幂等（#73）", () => {
  it("schema 含三个新增索引，且均为 CREATE INDEX IF NOT EXISTS", () => {
    const schema = readFileSync(path.join(ROOT, "schema.sql"), "utf8");
    expect(schema).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_media_assets_uploaded_by\s+ON\s+media_assets\s*\(\s*uploaded_by\s*\)/i
    );
    expect(schema).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_comments_article_id_status\s+ON\s+comments\s*\(\s*article_id\s*,\s*status\s*\)/i
    );
    expect(schema).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_friend_links_is_active\s+ON\s+friend_links\s*\(\s*is_active\s*\)/i
    );
  });

  it("依赖迁移列的索引位于 ALTER TABLE 之后（全新库初始化不报 no such column）", () => {
    const schema = readFileSync(path.join(ROOT, "schema.sql"), "utf8");
    const alterUploadedBy = schema.search(
      /ALTER\s+TABLE\s+media_assets\s+ADD\s+COLUMN\s+uploaded_by/i
    );
    const indexUploadedBy = schema.search(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_media_assets_uploaded_by/i
    );
    expect(alterUploadedBy).toBeGreaterThan(-1);
    expect(indexUploadedBy).toBeGreaterThan(-1);
    expect(indexUploadedBy).toBeGreaterThan(alterUploadedBy);
  });
});

describe("M22 SELECT * 清零（#73）", () => {
  const FILES = [
    "src/handlers/admin.ts",
    "src/handlers/category.ts",
    "src/handlers/friend_link.ts",
    "src/handlers/media.ts",
    "src/handlers/tag.ts",
    "src/services/article_service.ts",
  ];

  it("目标文件内无遗留裸 SELECT *", () => {
    // 票面 #73 点名的是裸 `SELECT *`（全列读取）。带别名的 `a.*` 仅出现在
    // 详情/编辑器共用的 join 查询（ARTICLE_DETAIL_SELECT），详情需要完整正文列，
    // 且属 M2（列表正文裁剪）独立票范围，不在本票清零目标内。
    for (const file of FILES) {
      const src = readFileSync(path.join(ROOT, file), "utf8");
      expect(src, `${file} 不应含 SELECT *`).not.toMatch(/SELECT\s+\*/i);
    }
  });
});
