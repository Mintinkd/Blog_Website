import { Env } from '../index';
import { successResponse, error, ErrorCodes } from '../utils/response';
import { sanitizeHtml } from '../utils/sanitizer';

/**
 * 管理端数据导出/导入（P1-7 / issue #12 安全改造）
 *
 * - 导入分两阶段：先对请求体做全量校验（未知表 / 未知列 / 非对象行 / 非原始值
 *   一律 400），通过后才执行任何 DELETE/INSERT —— 被拒的请求不产生副作用；
 * - INSERT 的列名只从下方 TABLE_COLUMNS 白名单常量中取（与行键比对后过滤），
 *   不再把请求体中的任意键名拼接进 SQL（原 M1 SQL 注入点）；
 * - site_config 的密钥行（jwt_secret / admin_password_hash / admin_username）
 *   导入时默认跳过，且 DELETE 只清理非密钥行 —— 跨环境导入「备份」不会覆盖
 *   本机密钥与管理员凭据，被跳过的键在响应 data.skipped_secret_rows 中列出；
 * - 文章 content/content_html 与评论 content 入库前过 sanitizeHtml（与评论
 *   常规写入路径同一净化器），防止恶意备份把 XSS 载荷导入库中；
 * - 删除/插入按 FK 安全顺序执行（先子后父删、先父后子插），兼容存量库中
 *   articles.category_id 为 ON DELETE RESTRICT 的旧 schema（新 schema 为 SET NULL）。
 */

/** 可导入的表及列白名单（与 worker/schema.sql 保持一致；schema 新增列需同步维护） */
const TABLE_COLUMNS: Record<string, readonly string[]> = {
  categories: ['id', 'name', 'slug', 'description', 'created_at', 'updated_at', 'created_by'],
  tags: ['id', 'name', 'slug', 'created_at', 'created_by'],
  articles: ['id', 'title', 'slug', 'content', 'content_html', 'summary', 'cover_image', 'category_id', 'status', 'view_count', 'like_count', 'comment_count', 'published_at', 'created_at', 'updated_at', 'author_id'],
  article_tags: ['article_id', 'tag_id'],
  comments: ['id', 'article_id', 'nickname', 'content', 'status', 'ip_hash', 'created_at'],
  article_likes: ['id', 'article_id', 'ip_hash', 'created_at'],
  media_assets: ['id', 'filename', 'original_name', 'mime_type', 'file_size', 'kv_key', 'storage_type', 'alt_text', 'created_at', 'uploaded_by'],
  friend_links: ['id', 'name', 'url', 'description', 'logo_url', 'sort_order', 'is_active', 'created_at', 'updated_at'],
  site_config: ['key', 'value', 'is_public', 'updated_at'],
};

/** site_config 不参与导入的密钥行（跨环境导入时保留本机值） */
const SKIP_CONFIG_KEYS = ['jwt_secret', 'admin_password_hash', 'admin_username'];

/** 导入时需要服务端净化的文本列 */
const SANITIZE_COLUMNS: Record<string, readonly string[]> = {
  articles: ['content', 'content_html'],
  comments: ['content'],
};

/** 删除顺序：先子后父（兼容 ON DELETE RESTRICT 的存量库） */
const DELETE_ORDER = ['article_tags', 'comments', 'article_likes', 'articles', 'tags', 'categories', 'media_assets', 'friend_links', 'site_config'];

/** 插入顺序：先父后子（categories/tags 先于 articles/article_tags） */
const INSERT_ORDER = ['categories', 'tags', 'articles', 'article_tags', 'comments', 'article_likes', 'media_assets', 'friend_links', 'site_config'];

export async function handleExport(request: Request, env: Env): Promise<Response> {
  const tables = Object.keys(TABLE_COLUMNS);
  const export_data: Record<string, unknown[]> = {};

  for (const table of tables) {
    const result = await env.DB.prepare(`SELECT * FROM ${table}`).all();
    export_data[table] = result.results as unknown[];
  }

  return new Response(JSON.stringify({ export_data, exported_at: new Date().toISOString() }), {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename=blog-export.json' },
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** D1 bind 仅接受原始值；嵌套对象/数组一律视为非法输入 */
function isPrimitiveValue(v: unknown): boolean {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

export async function handleImport(request: Request, env: Env): Promise<Response> {
  try {
    const raw = (await request.json()) as { export_data?: unknown };
    if (!isPlainObject(raw) || !isPlainObject(raw.export_data)) {
      return error(ErrorCodes.PARAM_ERROR, 'Invalid import data format');
    }

    // ── 阶段 1：全量校验（此阶段不执行任何 SQL） ──
    const validated: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [];
    for (const [table, value] of Object.entries(raw.export_data)) {
      const columns = TABLE_COLUMNS[table];
      if (!columns) {
        return error(ErrorCodes.VALIDATION_FAILED, `导入被拒绝：未知表 ${JSON.stringify(table)}`);
      }
      if (!Array.isArray(value)) {
        return error(ErrorCodes.VALIDATION_FAILED, `导入被拒绝：表 ${table} 的数据不是数组`);
      }
      const rows: Array<Record<string, unknown>> = [];
      for (let i = 0; i < value.length; i++) {
        const row: unknown = value[i];
        if (!isPlainObject(row)) {
          return error(ErrorCodes.VALIDATION_FAILED, `导入被拒绝：表 ${table} 第 ${i + 1} 行不是对象`);
        }
        const keys = Object.keys(row);
        if (keys.length === 0) {
          return error(ErrorCodes.VALIDATION_FAILED, `导入被拒绝：表 ${table} 第 ${i + 1} 行为空对象`);
        }
        const unknownCols = keys.filter((k) => !columns.includes(k));
        if (unknownCols.length > 0) {
          return error(ErrorCodes.VALIDATION_FAILED, `导入被拒绝：表 ${table} 第 ${i + 1} 行含未知列 ${unknownCols.join(', ')}`);
        }
        const badValueKey = keys.find((k) => !isPrimitiveValue(row[k]));
        if (badValueKey) {
          return error(ErrorCodes.VALIDATION_FAILED, `导入被拒绝：表 ${table} 第 ${i + 1} 行列 ${badValueKey} 的值类型非法（仅支持字符串/数字/布尔/null）`);
        }
        rows.push(row);
      }
      validated.push({ table, rows });
    }

    // ── 阶段 2：入库（列名只取自白名单常量；空表跳过，保持「提供即替换」语义） ──
    const byTable = new Map(validated.map((v) => [v.table, v.rows]));
    const imported: Record<string, number> = {};
    const skippedSecretRows: string[] = [];

    // 2a) 删除：先子后父（兼容 ON DELETE RESTRICT 的存量库）
    for (const table of DELETE_ORDER) {
      const rows = byTable.get(table);
      if (!rows || rows.length === 0) continue;
      if (table === 'site_config') {
        // 只清理非密钥行，本机密钥/凭据保留
        await env.DB.prepare(`DELETE FROM site_config WHERE key NOT IN (${SKIP_CONFIG_KEYS.map(() => '?').join(', ')})`)
          .bind(...SKIP_CONFIG_KEYS)
          .run();
      } else {
        await env.DB.prepare(`DELETE FROM ${table}`).run();
      }
    }

    // 2b) 插入：先父后子；净化 + 密钥行跳过
    for (const table of INSERT_ORDER) {
      const rows = byTable.get(table);
      if (!rows || rows.length === 0) continue;

      const sanitizeKeys = SANITIZE_COLUMNS[table];
      const writable = rows
        .map((row) => {
          if (!sanitizeKeys) return row;
          const out = { ...row };
          for (const key of sanitizeKeys) {
            if (typeof out[key] === 'string') out[key] = sanitizeHtml(out[key] as string);
          }
          return out;
        })
        .filter((row) => {
          if (table !== 'site_config') return true;
          if (typeof row.key === 'string' && SKIP_CONFIG_KEYS.includes(row.key)) {
            skippedSecretRows.push(row.key);
            return false;
          }
          return true;
        });

      for (const row of writable) {
        const cols = TABLE_COLUMNS[table].filter((c) => c in row);
        const placeholders = cols.map(() => '?').join(', ');
        await env.DB.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`)
          .bind(...cols.map((c) => row[c]))
          .run();
      }
      imported[table] = writable.length;
    }

    const note = skippedSecretRows.length > 0 ? `；已跳过密钥行：${skippedSecretRows.join(', ')}` : '';
    return successResponse(
      { imported, skipped_secret_rows: skippedSecretRows },
      'Data imported successfully' + note
    );
  } catch (e) {
    return error(ErrorCodes.SERVER_ERROR, 'Import failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
  }
}
