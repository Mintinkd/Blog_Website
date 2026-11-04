import type { Env } from "../index";

/**
 * 阅读统计 Tier 0 的数据层（issue #53 / docs/READER_ANALYTICS.md §5、§9 第 1 步）。
 *
 * - `dayKey()`：站点时区常量 `Asia/Shanghai` 的日界；清理边界与后续计数共用，
 *   避免 UTC 与本地时区各算一套「今天」。
 * - `runAnalyticsCleanup()`：每日 cron 的清理骨架——过期令牌、400 天保留窗口、
 *   心跳 `site_config.analytics_last_job_at`。
 * - `getAnalyticsHmacSecret()`：`site_config.analytics_hmac_secret` 首次使用时
 *   懒生成；独立于 `jwt_secret`，轮换 JWT 不影响去重令牌。
 */

/** 站点时区常量（ADR 0005：不进 site_settings，改时区按数据迁移处理） */
export const ANALYTICS_TIME_ZONE = "Asia/Shanghai";

/** 日聚合与维度桶保留天数；令牌另按 24 小时过期删除 */
export const ANALYTICS_RETENTION_DAYS = 400;

const DAY_MS = 24 * 60 * 60 * 1000;

const dayPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: ANALYTICS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 按站点时区生成 `YYYY-MM-DD`（清理边界与后续计数共用） */
export function dayKey(date: Date = new Date()): string {
  const parts = dayPartsFormatter.formatToParts(date);
  const part = (type: "year" | "month" | "day"): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * 保留窗口起点（含）：最近 `ANALYTICS_RETENTION_DAYS` 个日界的第一天。
 * `day < 该值` 的行删除；399 天前保留、400 天前删除。
 */
export function retentionCutoffDay(now: Date = new Date()): string {
  return dayKey(
    new Date(now.getTime() - (ANALYTICS_RETENTION_DAYS - 1) * DAY_MS)
  );
}

/** D1 `datetime('now')` 同格式（UTC，秒精度），用于令牌过期与心跳比较 */
export function sqliteUtcTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export interface AnalyticsCleanupResult {
  expiredTokens: number;
  articleDays: number;
  dimDays: number;
  heartbeatAt: string;
}

/**
 * 每日清理：删除过期令牌、保留窗口外的日聚合与维度桶，最后写心跳。
 * 心跳只在全部删除成功后写入；失败时保持旧值，让质量面板能发现任务停摆。
 */
export async function runAnalyticsCleanup(
  env: Env,
  now: Date = new Date()
): Promise<AnalyticsCleanupResult> {
  const heartbeatAt = sqliteUtcTimestamp(now);
  const cutoffDay = retentionCutoffDay(now);

  const expiredTokens = await env.DB.prepare(
    "DELETE FROM analytics_view_token WHERE expires_at <= ?"
  )
    .bind(heartbeatAt)
    .run();

  const articleDays = await env.DB.prepare(
    "DELETE FROM analytics_article_daily WHERE day < ?"
  )
    .bind(cutoffDay)
    .run();

  const dimDays = await env.DB.prepare(
    "DELETE FROM analytics_dim_daily WHERE day < ?"
  )
    .bind(cutoffDay)
    .run();

  await env.DB.prepare(
    "INSERT OR REPLACE INTO site_config (key, value, is_public, updated_at) VALUES ('analytics_last_job_at', ?, 0, datetime('now'))"
  )
    .bind(heartbeatAt)
    .run();

  return {
    expiredTokens: expiredTokens.meta.changes,
    articleDays: articleDays.meta.changes,
    dimDays: dimDays.meta.changes,
    heartbeatAt,
  };
}

const ANALYTICS_SECRET_BYTES = 32;

/** 32 字节随机数的 hex 表示（64 字符），与 jwt_secret 的 base64url 形态刻意区分 */
function generateAnalyticsHmacSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ANALYTICS_SECRET_BYTES));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

/** 取阅读统计 HMAC 密钥；首次使用时懒生成并持久化（独立于 jwt_secret） */
export async function getAnalyticsHmacSecret(env: Env): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT value FROM site_config WHERE key = 'analytics_hmac_secret'"
  ).first<{ value: string }>();
  if (row?.value) return row.value;

  const secret = generateAnalyticsHmacSecret();
  await env.DB.prepare(
    "INSERT OR REPLACE INTO site_config (key, value, is_public, updated_at) VALUES ('analytics_hmac_secret', ?, 0, datetime('now'))"
  )
    .bind(secret)
    .run();
  return secret;
}
