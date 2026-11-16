/**
 * CI 自动 D1 迁移后的对象核对（issue：CI/CD 自动迁移）。
 *
 * 背景：两个增量 DDL（schema-tier0-incremental.sql / schema-m22-incremental.sql）
 * 都是 IF NOT EXISTS 幂等语句，CI 每次 push 重放；本脚本在重放后查 sqlite_master，
 * 断言这些语句产出的表 / 索引确实存在——避免迁移命令「跑成功了但没生效」
 * （例如表名写错、前置列缺失导致语句被跳过）却无人察觉。
 *
 * 用法（CI，仓库根目录）：
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
 *     node scripts/verify-d1-migrations.mjs
 * 本地冒烟（用本地 D1，预期会因空库报缺失，仅验证脚本能跑通）：
 *   node scripts/verify-d1-migrations.mjs --local
 *
 * 纯函数（parseWranglerJson / findMissingObjects）导出供 node 单测锁定；
 * CLI 部分仅在主模块时执行。
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * 迁移完成后必须存在的 D1 对象（表 / 索引），来自两个增量 DDL：
 * - schema-tier0-incremental.sql：3 表 + 2 索引
 * - schema-m22-incremental.sql：3 索引
 * 新增增量 DDL 时须同步此清单（tests/d1-migration-verify.test.ts 锁定数量与成员）。
 */
export const EXPECTED_D1_OBJECTS = [
  "analytics_article_daily",
  "analytics_view_token",
  "analytics_dim_daily",
  "idx_view_token_expires",
  "idx_dim_daily_lookup",
  "idx_media_assets_uploaded_by",
  "idx_comments_article_id_status",
  "idx_friend_links_is_active",
];

/** wrangler d1 execute --json 输出解析：取第一组 results，坏输入抛错（fail-closed）。 */
export function parseWranglerJson(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("wrangler --json 返回空数组");
  }
  const results = parsed[0]?.results;
  if (!Array.isArray(results)) {
    throw new Error("wrangler --json 首项无 results 数组");
  }
  return results;
}

/** 对比 sqlite_master 的 name 集合与预期清单，返回缺失项（顺序按预期清单）。 */
export function findMissingObjects(rows) {
  const present = new Set(rows.map((r) => String(r.name)));
  return EXPECTED_D1_OBJECTS.filter((name) => !present.has(name));
}

// 核对 SQL 固化在 worker/schema-verify.sql（--file 传入），避免 --command 在
// Windows shell 下的引号问题；清单与 EXPECTED_D1_OBJECTS 的一致性由单测锁定。
const VERIFY_SQL_FILE = "schema-verify.sql";

function isMainModule() {
  try {
    return (
      process.argv[1] &&
      path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
    );
  } catch {
    return false;
  }
}

function main() {
  const local = process.argv.includes("--local");
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const workerDir = path.join(repoRoot, "worker");
  const args = [
    "wrangler",
    "d1",
    "execute",
    "blog-db",
    "--json",
    local ? "--local" : "--remote",
    "--file",
    VERIFY_SQL_FILE,
  ];
  const raw = execFileSync("npx", args, {
    cwd: workerDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    // Windows 下 npx 是 .cmd，不经 shell 无法执行；CI(Linux) 同样兼容。
    // 参数均为无空格字面量（SQL 在文件里），shell 拼接无注入风险。
    shell: process.platform === "win32",
  });
  const missing = findMissingObjects(parseWranglerJson(raw));
  if (missing.length > 0) {
    console.error(
      `D1 迁移核对失败：缺少 ${missing.length} 个对象：\n  ${missing.join("\n  ")}`
    );
    process.exit(1);
  }
  console.log(
    `D1 迁移核对通过：${EXPECTED_D1_OBJECTS.length} 个表 / 索引均存在。`
  );
}

if (isMainModule()) main();
