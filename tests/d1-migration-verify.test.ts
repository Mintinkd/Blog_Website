// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_D1_OBJECTS,
  findMissingObjects,
  parseWranglerJson,
} from "../scripts/verify-d1-migrations.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * issue：CI 自动 D1 迁移后的对象核对（纯逻辑 seam）。
 * 期望清单来自两个增量 DDL 的单一来源；判定函数不得从被测数据推回期望值。
 */

describe("D1 迁移核对", () => {
  it("EXPECTED_D1_OBJECTS 覆盖两个增量文件的全部对象（8 个）", () => {
    expect(EXPECTED_D1_OBJECTS).toHaveLength(8);
    expect(EXPECTED_D1_OBJECTS).toEqual(
      expect.arrayContaining([
        "analytics_article_daily",
        "analytics_view_token",
        "analytics_dim_daily",
        "idx_view_token_expires",
        "idx_dim_daily_lookup",
        "idx_media_assets_uploaded_by",
        "idx_comments_article_id_status",
        "idx_friend_links_is_active",
      ])
    );
  });

  it("schema-verify.sql 的对象清单与 EXPECTED_D1_OBJECTS 一致（单一来源守卫）", () => {
    const sql = readFileSync(
      path.join(ROOT, "worker", "schema-verify.sql"),
      "utf8"
    );
    for (const name of EXPECTED_D1_OBJECTS) {
      expect(sql, `${name} 应在核对 SQL 中`).toContain(`'${name}'`);
    }
    const quoted = [...sql.matchAll(/'([a-zA-Z0-9_]+)'/g)].map((m) => m[1]);
    expect(quoted.sort()).toEqual([...EXPECTED_D1_OBJECTS].sort());
  });

  it("parseWranglerJson 解析 wrangler --json 的输出并取第一组 results", () => {
    const raw = JSON.stringify([
      { results: [{ name: "a" }, { name: "b" }], success: true, meta: {} },
    ]);
    expect(parseWranglerJson(raw)).toEqual([{ name: "a" }, { name: "b" }]);
  });

  it("parseWranglerJson 对空/坏 JSON 抛错（fail-closed，不静默通过）", () => {
    expect(() => parseWranglerJson("")).toThrow();
    expect(() => parseWranglerJson("not json")).toThrow();
    expect(() => parseWranglerJson("[]")).toThrow();
  });

  it("findMissingObjects 找出缺失对象；全部存在时返回空数组", () => {
    const present = EXPECTED_D1_OBJECTS.map((name) => ({ name }));
    expect(findMissingObjects(present)).toEqual([]);
    const partial = present.filter(
      (r) => r.name !== "idx_friend_links_is_active"
    );
    expect(findMissingObjects(partial)).toEqual(["idx_friend_links_is_active"]);
    expect(findMissingObjects([])).toEqual(EXPECTED_D1_OBJECTS);
  });
});
