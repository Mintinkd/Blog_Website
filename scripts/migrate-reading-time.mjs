/**
 * reading_time 落库的幂等迁移（issue #90 / M2）。
 *
 * 背景：SQLite/D1 的 `ALTER TABLE ... ADD COLUMN` 不支持 IF NOT EXISTS，
 * 而 CI 每次 push 都重放迁移——裸 ALTER 第二次必报 duplicate column。
 * 本脚本先查 PRAGMA table_info(articles)：
 *   - 已有 reading_time 列 → 跳过（幂等，不回填，避免覆盖人工修正 / 已落库值）；
 *   - 无列 → ALTER ADD COLUMN reading_time INTEGER，再按与 Worker 完全一致的
 *     calculateReadingTime 算法回填存量文章（分页拉取 id + content，逐条 UPDATE）。
 *
 * 全新库不经过这里：schema.sql 的 CREATE TABLE articles 直接带列。
 *
 * 用法（CI，仓库根目录）：
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
 *     node scripts/migrate-reading-time.mjs
 * 纯函数（calculateReadingTime / buildUpdateSql / needsColumn）导出供单测锁定。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** 与 worker/src/services/article_service.ts 的 calculateReadingTime 逐字一致。 */
export function calculateReadingTime(text) {
  const s = String(text ?? "");
  const chineseChars = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const englishWords = s
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  const minutes = chineseChars / 300 + englishWords / 200;
  return Math.max(1, Math.ceil(minutes));
}

/** 判断 table_info 结果里是否已有 reading_time 列。 */
export function needsColumn(rows) {
  return !Array.isArray(rows) || !rows.some((r) => r?.name === "reading_time");
}

/** 回填 UPDATE 语句（单条，参数化），与列绑定值分离。 */
export function buildUpdateSql() {
  return "UPDATE articles SET reading_time = ? WHERE id = ?";
}

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

function d1Config(repoRoot) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    throw new Error("需要 CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ACCOUNT_ID");
  }
  const config = readFileSync(
    path.join(repoRoot, "worker", "wrangler.jsonc"),
    "utf8"
  );
  const dbId = config.match(/"database_id"\s*:\s*"([^"]+)"/)?.[1];
  if (!dbId) throw new Error("wrangler.jsonc 中找不到 database_id");
  return { token, accountId, dbId };
}

async function query(sql, cfg, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/d1/database/${cfg.dbId}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    }
  );
  const body = await res.json();
  if (
    !body?.success ||
    !Array.isArray(body.result) ||
    body.result[0]?.success === false
  ) {
    const errs = (body?.errors ?? [])
      .map((e) => `${e.code}: ${e.message}`)
      .join("; ");
    throw new Error(
      `D1 query 失败：${errs || JSON.stringify(body?.errors || body)}`
    );
  }
  return body.result[0]?.results ?? [];
}

async function main() {
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const cfg = d1Config(repoRoot);

  const info = await query("PRAGMA table_info(articles)", cfg);
  if (!needsColumn(info)) {
    console.log("reading_time 列已存在，跳过迁移（幂等）。");
    return;
  }

  console.log("reading_time 列不存在，执行 ALTER TABLE ADD COLUMN...");
  // 与 schema.sql 的新建库定义一致：NOT NULL DEFAULT 1，保证无回填值的行也有合法时长。
  await query(
    "ALTER TABLE articles ADD COLUMN reading_time INTEGER NOT NULL DEFAULT 1",
    cfg
  );

  // 分页回填存量文章，避免一次性拉全表。
  const updateSql = buildUpdateSql();
  const PAGE = 100;
  let offset = 0;
  let filled = 0;
  for (;;) {
    const rows = await query(
      "SELECT id, content FROM articles ORDER BY id LIMIT ? OFFSET ?",
      cfg,
      [PAGE, offset]
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      await query(updateSql, cfg, [calculateReadingTime(row.content), row.id]);
      filled++;
    }
    offset += rows.length;
  }
  // fail-closed：回填后再查一次，确认列真的建出来（迁移命令返回 0 不等于生效）。
  const after = await query("PRAGMA table_info(articles)", cfg);
  if (needsColumn(after)) {
    throw new Error("迁移后 reading_time 列仍不存在，核对失败");
  }
  console.log(`reading_time 迁移完成：新增列并回填 ${filled} 篇文章。`);
}

if (isMainModule()) {
  main().catch((e) => {
    console.error(e?.message ?? String(e));
    process.exit(1);
  });
}
