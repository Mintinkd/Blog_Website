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
import { readFileSync } from "node:fs";
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

/**
 * 迁移脚本添加的列（#111 item 8）。
 * migrate-reading-time.mjs 给 articles 表加 reading_time 列；
 * 此列不在 sqlite_master 中（它是表内列，不是独立对象），
 * 需通过 PRAGMA table_info 检查。schema-verify.sql 用 UNION 合并查询。
 * 新增迁移脚本加列时须同步此清单（tests/d1-migration-verify.test.ts 锁定）。
 */
export const EXPECTED_D1_COLUMNS = [
  { table: "articles", column: "reading_time" },
];

/**
 * wrangler d1 execute --json 输出解析：取第一组 results，坏输入抛错（fail-closed）。
 *
 * CI 实测（2026-11-16）：wrangler 会把进度行（「├ Checking if file needs uploading」
 * 等）也打印到 stdout，JSON 数组夹在中间，直接 JSON.parse(整段) 必炸。
 * 容忍前导/尾随噪声：逐个尝试以每个 `[` 开头、截到最后一个 `]` 的子串做 JSON.parse，
 * 取第一个满足「非空数组且首项含 results[]」的结果；全失败则抛错。
 */
export function parseWranglerJson(raw) {
  const text = String(raw ?? "");
  const opens = [...text.matchAll(/\[/g)].map((m) => m.index);
  const closes = [...text.matchAll(/\]/g)].map((m) => m.index);
  if (opens.length === 0 || closes.length === 0) {
    throw new Error("wrangler 输出中找不到 JSON 数组");
  }

  const candidates = [];
  let lastError;
  // 对每个 `[` × 每个 `]` 组合尝试（从长到短，优先取完整数组）；
  // 文本只有几 KB，O(n²) 可接受，换来对进度行/前后噪声的完全容忍。
  for (const from of opens) {
    for (let ci = closes.length - 1; ci >= 0; ci--) {
      const end = closes[ci];
      if (end <= from) continue;
      let parsed;
      try {
        parsed = JSON.parse(text.slice(from, end + 1));
      } catch (e) {
        lastError = e;
        continue;
      }
      if (!Array.isArray(parsed) || parsed.length === 0) continue;
      if (!Array.isArray(parsed[0]?.results)) continue;
      candidates.push(parsed[0].results);
    }
  }
  if (candidates.length === 0) {
    throw (
      lastError ?? new Error("wrangler --json 输出中未找到有效 results 数组")
    );
  }
  // --remote 上传文件阶段会先打印一个 results:[] 的合法 JSON；真正的查询
  // 结果在其后且 results 非空。优先取非空候选，否则（确实是空库）取第一个。
  return candidates.find((r) => r.length > 0) ?? candidates[0];
}

/**
 * Cloudflare D1 REST API（POST .../query）响应解析：取 result[0].results。
 * CI 实测 wrangler --remote --json 对 SELECT 只回统计、不回查询行，故 remote
 * 核对走 REST API（D1 Read 权限即可），它返回完整 rows。坏结构抛错 fail-closed。
 */
export function parseD1ApiResponse(body) {
  if (!body || body.success !== true) {
    const msg = (body?.errors ?? [])
      .map((e) => `${e.code}: ${e.message}`)
      .join("; ");
    throw new Error(`D1 query API 失败：${msg || "success=false"}`);
  }
  const result = body.result;
  if (!Array.isArray(result) || result.length === 0) {
    throw new Error("D1 query API 返回空 result");
  }
  const first = result[0];
  if (first?.success === false || !Array.isArray(first?.results)) {
    throw new Error("D1 query API 首项无有效 results（可能 SQL 执行失败）");
  }
  return first.results;
}

/** 对比 sqlite_master 的 name 集合与预期清单，返回缺失项（顺序按预期清单）。 */
export function findMissingObjects(rows) {
  const present = new Set(rows.map((r) => String(r.name)));
  return EXPECTED_D1_OBJECTS.filter((name) => !present.has(name));
}

// 核对 SQL 固化在 worker/schema-verify.sql（单一来源，清单一致性由单测锁定）；
// remote 走 REST API 时直接读文件正文，local 仍用 wrangler --file。
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

async function fetchRemoteRows(repoRoot) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    throw new Error(
      "remote 核对需要 CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ACCOUNT_ID"
    );
  }
  // database_id 来自 wrangler.jsonc（与迁移/Worker 绑定同一来源），不另存常量。
  // CI 可用 D1_DATABASE_ID 覆盖（与 render-worker-config.mjs 渲染口径一致）。
  const wranglerConfig = readFileSync(
    path.join(repoRoot, "worker", "wrangler.jsonc"),
    "utf8"
  );
  const dbId =
    process.env.D1_DATABASE_ID?.trim() ||
    wranglerConfig.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1];
  if (!dbId)
    throw new Error("wrangler.jsonc 中找不到 d1_databases[].database_id");
  // SQL 去掉注释行后作为单条语句传入（REST API 不接受 --file）。
  const sql = readFileSync(
    path.join(repoRoot, "worker", VERIFY_SQL_FILE),
    "utf8"
  )
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .trim();
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql }),
    }
  );
  const body = await res.json();
  return parseD1ApiResponse(body);
}

function fetchLocalRows(repoRoot) {
  const raw = execFileSync(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      process.env.D1_DATABASE_NAME?.trim() || "blog-db",
      "--json",
      "--local",
      "--file",
      VERIFY_SQL_FILE,
    ],
    {
      cwd: path.join(repoRoot, "worker"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
      shell: process.platform === "win32",
    }
  );
  return parseWranglerJson(raw);
}

async function main() {
  const local = process.argv.includes("--local");
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const rows = local
    ? fetchLocalRows(repoRoot)
    : await fetchRemoteRows(repoRoot);
  console.log(
    `sqlite_master 命中 ${rows.length} 项：${rows.map((r) => r.name).join(", ") || "(空)"}`
  );
  const missing = findMissingObjects(rows);
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

if (isMainModule()) {
  main().catch((e) => {
    console.error(e?.message ?? String(e));
    process.exit(1);
  });
}
