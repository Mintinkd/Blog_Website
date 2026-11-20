// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_D1_COLUMNS,
  EXPECTED_D1_OBJECTS,
  findMissingObjects,
  parseD1ApiResponse,
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

  it("EXPECTED_D1_COLUMNS 覆盖迁移脚本添加的列（#111 item 8）", () => {
    // migrate-reading-time.mjs 给 articles 表加 reading_time 列
    expect(EXPECTED_D1_COLUMNS).toEqual([
      { table: "articles", column: "reading_time" },
    ]);
  });

  it("schema-verify.sql 包含 EXPECTED_D1_COLUMNS 的列核对（#111 item 8）", () => {
    const sql = readFileSync(
      path.join(ROOT, "worker", "schema-verify.sql"),
      "utf8"
    );
    // 每个预期列都应在 schema-verify.sql 中出现
    for (const { table, column } of EXPECTED_D1_COLUMNS) {
      expect(sql, `${table}.${column} 应在核对 SQL 中`).toContain(column);
      expect(sql).toContain(`pragma_table_info('${table}')`);
    }
  });

  it("迁移脚本加的列必须在核对清单里（#111 item 8 守卫）", () => {
    // 从 migrate-reading-time.mjs 源码提取 ALTER TABLE ADD COLUMN 语句
    const migrateScript = readFileSync(
      path.join(ROOT, "scripts", "migrate-reading-time.mjs"),
      "utf8"
    );
    // 提取所有 ADD COLUMN <name> 的列名
    const addedColumns = [
      ...migrateScript.matchAll(/ADD\s+COLUMN\s+(\w+)\s+/gi),
    ].map((m) => m[1]);

    // 每个脚本加的列都必须在 EXPECTED_D1_COLUMNS 中
    for (const col of addedColumns) {
      const inCheckList = EXPECTED_D1_COLUMNS.some((c) => c.column === col);
      expect(
        inCheckList,
        `迁移脚本加了列 ${col}，但不在 EXPECTED_D1_COLUMNS 核对清单里——` +
          `新增列必须在核对清单中登记（#111 item 8）`
      ).toBe(true);
    }
  });

  it("schema-verify.sql 的对象清单与 EXPECTED_D1_OBJECTS 一致（单一来源守卫）", () => {
    const sql = readFileSync(
      path.join(ROOT, "worker", "schema-verify.sql"),
      "utf8"
    );
    for (const name of EXPECTED_D1_OBJECTS) {
      expect(sql, `${name} 应在核对 SQL 中`).toContain(`'${name}'`);
    }
    // #111 item 8：SQL 现在还含 EXPECTED_D1_COLUMNS 的列名 + 表名，
    // 所以 quoted 包含对象名 + 列名 + 表名，需合并比对
    const allExpected = [
      ...EXPECTED_D1_OBJECTS,
      ...EXPECTED_D1_COLUMNS.map((c) => c.column),
      ...EXPECTED_D1_COLUMNS.map((c) => c.table),
    ];
    const quoted = [...sql.matchAll(/'([a-zA-Z0-9_]+)'/g)].map((m) => m[1]);
    expect(quoted.sort()).toEqual([...allExpected].sort());
  });

  it("parseWranglerJson 解析 wrangler --json 的输出并取第一组 results", () => {
    const raw = JSON.stringify([
      { results: [{ name: "a" }, { name: "b" }], success: true, meta: {} },
    ]);
    expect(parseWranglerJson(raw)).toEqual([{ name: "a" }, { name: "b" }]);
  });

  it("parseWranglerJson 容忍 wrangler 进度行混入 stdout（CI 实测）", () => {
    // 2026-11-16 CI 实测：wrangler 把「├ Checking if file needs uploading」
    // 这类进度行打印到 stdout，JSON 数组被夹在中间；不能对整个 stdout 直接 JSON.parse。
    const payload = JSON.stringify([
      { results: [{ name: "analytics_view_token" }], success: true, meta: {} },
    ]);
    const withProgress = [
      "├ Checking if file needs uploading",
      "└ Uploaded bundle",
      payload,
    ].join("\n");
    expect(parseWranglerJson(withProgress)).toEqual([
      { name: "analytics_view_token" },
    ]);
    // 进度行里含方括号也不能误裁（取最后一个完整 JSON 数组）
    expect(
      parseWranglerJson(`[done] step\n${payload}\n[trailing note]`)
    ).toEqual([{ name: "analytics_view_token" }]);
  });

  it("parseWranglerJson 跳过 wrangler 上传阶段的空 results，取真实查询结果", () => {
    // CI --remote 会先上传 .sql 文件；wrangler 可能先打印一个 results:[] 的
    // 合法 JSON（上传/进度确认），真正的 sqlite_master 查询 JSON 在其后。
    // 若取了第一个候选就会误报「全部缺失」——必须优先取非空 results。
    const uploadJson = JSON.stringify([{ results: [], success: true }]);
    const queryJson = JSON.stringify([
      { results: [{ name: "analytics_view_token" }], success: true },
    ]);
    const raw = `├ Uploading bundle\n${uploadJson}\n└ Done\n${queryJson}`;
    expect(parseWranglerJson(raw)).toEqual([{ name: "analytics_view_token" }]);
  });

  it("parseWranglerJson 对空/坏 JSON 抛错（fail-closed，不静默通过）", () => {
    expect(() => parseWranglerJson("")).toThrow();
    expect(() => parseWranglerJson("not json")).toThrow();
    expect(() => parseWranglerJson("[]")).toThrow();
    expect(() => parseWranglerJson("├ progress only, no JSON")).toThrow();
  });

  it("parseD1ApiResponse 解析 REST API 的 result[0].results（remote 核对路径）", () => {
    // CI 实测：wrangler --remote --json 对 SELECT 只返回统计、不返回查询行；
    // 改用 Cloudflare D1 REST API，它返回完整 rows。
    const body = {
      success: true,
      errors: [],
      result: [
        {
          success: true,
          results: [
            { name: "analytics_view_token" },
            { name: "idx_dim_daily_lookup" },
          ],
          meta: { rows_read: 41 },
        },
      ],
    };
    expect(parseD1ApiResponse(body)).toEqual([
      { name: "analytics_view_token" },
      { name: "idx_dim_daily_lookup" },
    ]);
  });

  it("parseD1ApiResponse 对失败/坏结构抛错（fail-closed）", () => {
    expect(() =>
      parseD1ApiResponse({ success: false, errors: [{ code: 1 }] })
    ).toThrow();
    expect(() => parseD1ApiResponse({ success: true, result: [] })).toThrow();
    expect(() => parseD1ApiResponse({ success: true, result: [{}] })).toThrow();
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
