import { Env } from "../index";
import { successResponse, error, ErrorCodes } from "../utils/response";
import { sanitizeHtml } from "../utils/sanitizer";
import { isPlainObject } from "../utils/object";
import { isValidUrl } from "../utils/validator";

/**
 * 管理端数据导出/导入（P1-7 / issue #12 安全改造）
 *
 * - 导入分两阶段：先对请求体做全量校验（未知表 / 未知列 / 非对象行 / 非原始值
 *   一律 400），通过后才执行任何 DELETE/INSERT —— 被拒的请求不产生副作用；
 * - INSERT 的列名只从下方 IMPORTABLE_TABLES 描述符的 columns 白名单中取（与行键
 *   比对后过滤），不再把请求体中的任意键名拼接进 SQL（原 M1 SQL 注入点）；
 * - site_config 的密钥行（jwt_secret / analytics_hmac_secret / admin_password_hash /
 *   admin_username）与统计任务心跳（analytics_last_job_at）导入时默认跳过，且
 *   DELETE 只清理非名单行 —— 跨环境导入「备份」不会覆盖本机密钥、管理员凭据或
 *   心跳，被跳过的键在响应 data.skipped_secret_rows 中列出；
 * - 文章 content/content_html 与评论 content 入库前过 sanitizeHtml（与评论
 *   常规写入路径同一净化器），防止恶意备份把 XSS 载荷导入库中；
 * - friend_links.url 导入时须过 isValidUrl 的 http/https scheme 白名单
 *   （与友链常规写入路径同一校验器），防止 bulk import 旁路该防线；
 * - 删除/插入按 FK 安全顺序执行（先子后父删、先父后子插），兼容存量库中
 *   articles.category_id 为 ON DELETE RESTRICT 的旧 schema（新 schema 为 SET NULL）。
 */

/**
 * 每张可导入表一份描述符（issue #23：原五个并行按表结构 TABLE_COLUMNS /
 * SKIP_CONFIG_KEYS / SANITIZE_COLUMNS / DELETE_ORDER / INSERT_ORDER 收敛于此）。
 *
 * 新增表/列的唯一编辑点就是这张表 —— schema.sql 新增列需同步维护。
 * 阅读统计三表（analytics_*）为派生数据，刻意不列入：不参与备份导出/导入，
 * 避免把 24h 令牌与可重算聚合跨环境搬运。
 *   - columns：可导入列白名单（与 worker/schema.sql 保持一致）；
 *   - sanitizeColumns：入库前需要服务端净化（sanitizeHtml）的文本列；
 *   - skipKeys：site_config 密钥/心跳行按行 key 跳过名单（跨环境导入时保留本机值），
 *     启用该名单的表在 DELETE 阶段同样只清非名单行；个别行在 INSERT 阶段漏过；
 *   - deleteRank / insertRank：FK 安全序（先子后父删 / 先父后子插，1 = 最先），
 *     DELETE_ORDER / INSERT_ORDER 由数值派生，须与 schema FK 依赖吻合。
 */
interface ImportableTable {
  readonly columns: readonly string[];
  readonly sanitizeColumns?: readonly string[];
  readonly skipKeys?: readonly string[];
  readonly deleteRank: number;
  readonly insertRank: number;
}

const IMPORTABLE_TABLES: Record<string, ImportableTable> = {
  categories: {
    columns: [
      "id",
      "name",
      "slug",
      "description",
      "created_at",
      "updated_at",
      "created_by",
    ],
    deleteRank: 6,
    insertRank: 1,
  },
  tags: {
    columns: ["id", "name", "slug", "created_at", "created_by"],
    deleteRank: 5,
    insertRank: 2,
  },
  articles: {
    columns: [
      "id",
      "title",
      "slug",
      "content",
      "content_html",
      "summary",
      "cover_image",
      "category_id",
      "status",
      "view_count",
      "like_count",
      "comment_count",
      "published_at",
      "created_at",
      "updated_at",
      "author_id",
    ],
    sanitizeColumns: ["content", "content_html"],
    deleteRank: 4,
    insertRank: 3,
  },
  article_tags: {
    columns: ["article_id", "tag_id"],
    deleteRank: 1,
    insertRank: 4,
  },
  comments: {
    columns: [
      "id",
      "article_id",
      "nickname",
      "content",
      "status",
      "ip_hash",
      "created_at",
    ],
    sanitizeColumns: ["content"],
    deleteRank: 2,
    insertRank: 5,
  },
  article_likes: {
    columns: ["id", "article_id", "ip_hash", "created_at"],
    deleteRank: 3,
    insertRank: 6,
  },
  media_assets: {
    columns: [
      "id",
      "filename",
      "original_name",
      "mime_type",
      "file_size",
      "kv_key",
      "storage_type",
      "alt_text",
      "created_at",
      "uploaded_by",
    ],
    deleteRank: 7,
    insertRank: 7,
  },
  friend_links: {
    columns: [
      "id",
      "name",
      "url",
      "description",
      "logo_url",
      "sort_order",
      "is_active",
      "created_at",
      "updated_at",
    ],
    deleteRank: 8,
    insertRank: 8,
  },
  site_config: {
    columns: ["key", "value", "is_public", "updated_at"],
    skipKeys: [
      "jwt_secret",
      "analytics_hmac_secret",
      "admin_password_hash",
      "admin_username",
      "analytics_last_job_at",
    ],
    deleteRank: 9,
    insertRank: 9,
  },
};

/** 删除顺序（先子后父，兼容 ON DELETE RESTRICT 的存量库）—— 自描述符 deleteRank 派生 */
const DELETE_ORDER = Object.keys(IMPORTABLE_TABLES).sort(
  (a, b) => IMPORTABLE_TABLES[a].deleteRank - IMPORTABLE_TABLES[b].deleteRank
);

/** 插入顺序（先父后子；categories/tags 先于 articles/article_tags）—— 自描述符 insertRank 派生 */
const INSERT_ORDER = Object.keys(IMPORTABLE_TABLES).sort(
  (a, b) => IMPORTABLE_TABLES[a].insertRank - IMPORTABLE_TABLES[b].insertRank
);

/**
 * 单次导出每张表的行数硬上限（issue #73 / M22）：避免一次性把 9 张表全表全列
 * 载入内存。超过上限的数据用 page 参数分片拉取；page_size 钳制到本值。
 */
export const MAX_EXPORT_ROWS = 5000;

export async function handleExport(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const tableParam = url.searchParams.get("table");

  // table 白名单：只认 IMPORTABLE_TABLES 自有属性。
  // 用 hasOwn 而非 `IMPORTABLE_TABLES[x]` 真值判断——后者会被 constructor /
  // toString 等原型属性绕过，进而在 .columns.join 抛未捕获 500（review 发现）。
  if (
    tableParam !== null &&
    !Object.prototype.hasOwnProperty.call(IMPORTABLE_TABLES, tableParam)
  ) {
    return error(ErrorCodes.PARAM_ERROR, "Invalid export table");
  }

  const rawPage = url.searchParams.get("page") ?? "1";
  const rawSize = url.searchParams.get("page_size") ?? String(MAX_EXPORT_ROWS);
  const page = Number(rawPage);
  const rawSizeNum = Number(rawSize);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(rawSizeNum) ||
    rawSizeNum < 1
  ) {
    return error(ErrorCodes.PARAM_ERROR, "Invalid pagination parameters");
  }
  const pageSize = Math.min(rawSizeNum, MAX_EXPORT_ROWS);
  const offset = (page - 1) * pageSize;

  // 默认导出所有 IMPORTABLE_TABLES；带 table 参数时只导该表。
  const tables = tableParam ? [tableParam] : Object.keys(IMPORTABLE_TABLES);
  const export_data: Record<string, unknown[]> = {};
  // 每表是否还有下一页：让调用方能可靠翻页，避免静默截断被当成完整备份（review F2/F4）。
  const has_more: Record<string, boolean> = {};

  for (const table of tables) {
    // 列清单取自描述符白名单（与导入白名单同一来源），不再全列读取。
    const cols = IMPORTABLE_TABLES[table].columns.join(", ");
    // 多取一行判断是否还有数据：有则 has_more=true 并裁掉哨兵行。
    const result = await env.DB.prepare(
      `SELECT ${cols} FROM ${table} LIMIT ? OFFSET ?`
    )
      .bind(pageSize + 1, offset)
      .all();
    const rows = result.results as unknown[];
    has_more[table] = rows.length > pageSize;
    export_data[table] = has_more[table] ? rows.slice(0, pageSize) : rows;
  }

  return new Response(
    JSON.stringify({
      export_data,
      exported_at: new Date().toISOString(),
      page,
      page_size: pageSize,
      has_more,
      ...(tableParam ? { table: tableParam } : {}),
      total_tables: tables.length,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": "attachment; filename=blog-export.json",
      },
    }
  );
}

/** D1 bind 仅接受原始值；嵌套对象/数组一律视为非法输入 */
function isPrimitiveValue(v: unknown): boolean {
  return (
    v === null ||
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  );
}

/** #86 / H5：KV 备份键前缀与 TTL（7 天） */
const BACKUP_KEY_PREFIX = "backup:";
const BACKUP_TTL_SECONDS = 7 * 24 * 60 * 60;
/** #86 / H5：异常规模阈值——某表新行数 > 10× 现有行数（现有 0 行时基线取 10）需 confirm */
const IMPORT_GROWTH_FACTOR = 10;
const IMPORT_ZERO_BASELINE = 10;

interface TableCounts {
  /** 每张表当前行数（仅统计本次导入涉及的表） */
  existing: Record<string, number>;
  /** 每张表将插入行数（阶段 1 校验后） */
  inserting: Record<string, number>;
  totalInserting: number;
  /** 是否触发异常规模阈值 */
  needsConfirm: boolean;
  /** 触发阈值的表及原因，供日志/诊断；不回显 SQL */
  reasons: string[];
}

/**
 * #86 / H5：统计现有行数与将插入行数，判定是否需要二次确认。
 * 只读，不改变数据；现有 0 行表用基线 10 避免「空库导入任意行数都需确认」的过度告警。
 */
async function assessImportScale(
  env: Env,
  byTable: Map<string, Array<Record<string, unknown>>>
): Promise<TableCounts> {
  const existing: Record<string, number> = {};
  const inserting: Record<string, number> = {};
  const reasons: string[] = [];
  let totalInserting = 0;
  let needsConfirm = false;

  for (const [table, rows] of byTable) {
    const result = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM ${table}`
    ).all();
    const countRow = result.results?.[0] as { count?: number } | undefined;
    const oldCount = Number(countRow?.count ?? 0);
    existing[table] = oldCount;
    inserting[table] = rows.length;
    totalInserting += rows.length;

    const baseline = oldCount === 0 ? IMPORT_ZERO_BASELINE : oldCount;
    if (rows.length > baseline * IMPORT_GROWTH_FACTOR) {
      needsConfirm = true;
      reasons.push(
        `${table}: ${rows.length} > ${baseline * IMPORT_GROWTH_FACTOR}`
      );
    }
  }
  if (totalInserting === 0) {
    needsConfirm = true;
    reasons.push("empty import: 0 rows");
  }
  return { existing, inserting, totalInserting, needsConfirm, reasons };
}

/**
 * #86 / H5：导入前把当前全量数据写入 KV（TTL 7 天），返回备份键。
 * 只备份本次导入涉及的表；列清单复用导入白名单，避免把密钥/派生表带入备份。
 */
async function backupBeforeImport(
  env: Env,
  byTable: Map<string, Array<Record<string, unknown>>>
): Promise<string> {
  const snapshot: Record<string, unknown[]> = {};
  for (const table of byTable.keys()) {
    const cols = IMPORTABLE_TABLES[table].columns.join(", ");
    const result = await env.DB.prepare(`SELECT ${cols} FROM ${table}`).all();
    snapshot[table] = result.results as unknown[];
  }
  const key = `${BACKUP_KEY_PREFIX}${new Date().toISOString()}.${crypto.randomUUID().slice(0, 8)}`;
  await env.MEDIA.put(
    key,
    JSON.stringify({ created_at: new Date().toISOString(), tables: snapshot }),
    { expirationTtl: BACKUP_TTL_SECONDS }
  );
  return key;
}

export async function handleImport(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const confirmed = url.searchParams.get("confirm") === "1";
  try {
    const raw = (await request.json()) as { export_data?: unknown };
    if (!isPlainObject(raw) || !isPlainObject(raw.export_data)) {
      return error(ErrorCodes.PARAM_ERROR, "Invalid import data format");
    }

    // ── 阶段 1：全量校验（此阶段不执行任何 SQL） ──
    const validated: Array<{
      table: string;
      rows: Array<Record<string, unknown>>;
    }> = [];
    for (const [table, value] of Object.entries(raw.export_data)) {
      const descriptor = IMPORTABLE_TABLES[table];
      if (!descriptor) {
        return error(
          ErrorCodes.VALIDATION_FAILED,
          `导入被拒绝：未知表 ${JSON.stringify(table)}`
        );
      }
      if (!Array.isArray(value)) {
        return error(
          ErrorCodes.VALIDATION_FAILED,
          `导入被拒绝：表 ${table} 的数据不是数组`
        );
      }
      const rows: Array<Record<string, unknown>> = [];
      for (let i = 0; i < value.length; i++) {
        const row: unknown = value[i];
        if (!isPlainObject(row)) {
          return error(
            ErrorCodes.VALIDATION_FAILED,
            `导入被拒绝：表 ${table} 第 ${i + 1} 行不是对象`
          );
        }
        const keys = Object.keys(row);
        if (keys.length === 0) {
          return error(
            ErrorCodes.VALIDATION_FAILED,
            `导入被拒绝：表 ${table} 第 ${i + 1} 行为空对象`
          );
        }
        const unknownCols = keys.filter((k) => !descriptor.columns.includes(k));
        if (unknownCols.length > 0) {
          return error(
            ErrorCodes.VALIDATION_FAILED,
            `导入被拒绝：表 ${table} 第 ${i + 1} 行含未知列 ${unknownCols.join(", ")}`
          );
        }
        const badValueKey = keys.find((k) => !isPrimitiveValue(row[k]));
        if (badValueKey) {
          return error(
            ErrorCodes.VALIDATION_FAILED,
            `导入被拒绝：表 ${table} 第 ${i + 1} 行列 ${badValueKey} 的值类型非法（仅支持字符串/数字/布尔/null）`
          );
        }
        // C1 / issue #43：friend_links.url 与常规写入路径同一 scheme 白名单，
        // 防止 bulk import 旁路防线一（阶段一全量校验，被拒即零副作用）
        if (
          table === "friend_links" &&
          row.url !== undefined &&
          !isValidUrl(String(row.url))
        ) {
          return error(
            ErrorCodes.VALIDATION_FAILED,
            `导入被拒绝：表 ${table} 第 ${i + 1} 行 url 非 http/https（${String(
              row.url
            ).slice(0, 64)}）`
          );
        }
        rows.push(row);
      }
      validated.push({ table, rows });
    }

    // ── 阶段 1.5：#86 / H5 刹车（dry-run / 异常规模确认 / KV 备份） ──
    const byTable = new Map(validated.map((v) => [v.table, v.rows]));
    const scale = await assessImportScale(env, byTable);

    if (dryRun) {
      // 只读：返回将要删除/插入的行数，不写 KV、不执行任何 DELETE/INSERT
      return successResponse(
        {
          dry_run: true,
          would_delete: scale.existing,
          would_insert: scale.inserting,
          total_inserting: scale.totalInserting,
          needs_confirm: scale.needsConfirm,
          backup_key: null,
        },
        "Dry run: no changes applied"
      );
    }

    if (scale.needsConfirm && !confirmed) {
      return error(
        ErrorCodes.VALIDATION_FAILED,
        "导入规模异常（空导入或超过现有行数 10 倍），请显式带 confirm=1 重试"
      );
    }

    // 备份当前全量数据到 KV（7 天 TTL），失败即中止导入——宁可不写也不留无备份的破坏性操作
    const backupKey = await backupBeforeImport(env, byTable);

    // ── 阶段 2：入库（列名只取自白名单常量；空表跳过，保持「提供即替换」语义） ──
    const imported: Record<string, number> = {};
    const skippedSecretRows: string[] = [];

    // 2a) 删除：先子后父（兼容 ON DELETE RESTRICT 的存量库）
    for (const table of DELETE_ORDER) {
      const rows = byTable.get(table);
      if (!rows || rows.length === 0) continue;
      const skipKeys = IMPORTABLE_TABLES[table].skipKeys;
      if (skipKeys) {
        // 密钥行所在的表（见描述符 skipKeys）：只清理非密钥行，本机密钥/凭据保留
        await env.DB.prepare(
          `DELETE FROM ${table} WHERE key NOT IN (${skipKeys.map(() => "?").join(", ")})`
        )
          .bind(...skipKeys)
          .run();
      } else {
        await env.DB.prepare(`DELETE FROM ${table}`).run();
      }
    }

    // 2b) 插入：先父后子；净化 + 密钥行跳过
    for (const table of INSERT_ORDER) {
      const descriptor = IMPORTABLE_TABLES[table];
      const rows = byTable.get(table);
      if (!rows || rows.length === 0) continue;

      const writable = rows
        .map((row) => {
          if (!descriptor.sanitizeColumns) return row;
          const out = { ...row };
          for (const key of descriptor.sanitizeColumns) {
            if (typeof out[key] === "string")
              out[key] = sanitizeHtml(out[key] as string);
          }
          return out;
        })
        .filter((row) => {
          // 密钥行跳过（见描述符 skipKeys）：跨环境导入保留本机密钥/凭据
          const skipKeys = descriptor.skipKeys;
          if (!skipKeys) return true;
          if (typeof row.key === "string" && skipKeys.includes(row.key)) {
            skippedSecretRows.push(row.key);
            return false;
          }
          return true;
        });

      for (const row of writable) {
        const cols = descriptor.columns.filter((c) => c in row);
        const placeholders = cols.map(() => "?").join(", ");
        await env.DB.prepare(
          `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`
        )
          .bind(...cols.map((c) => row[c]))
          .run();
      }
      imported[table] = writable.length;
    }

    const note =
      skippedSecretRows.length > 0
        ? `；已跳过密钥行：${skippedSecretRows.join(", ")}`
        : "";
    return successResponse(
      {
        imported,
        skipped_secret_rows: skippedSecretRows,
        backup_key: backupKey,
      },
      "Data imported successfully" + note
    );
  } catch (e) {
    // #86 / H5：不回显内部异常原文（可能含 SQL 表名 / 语句），只记服务端日志
    console.error("Import failed:", e instanceof Error ? e.message : String(e));
    return error(ErrorCodes.SERVER_ERROR, "Import failed: internal error", 500);
  }
}
