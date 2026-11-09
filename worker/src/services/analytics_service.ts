import type { Env } from "../index";
import {
  readVisitorContext,
  type VisitorContext,
} from "../utils/visitor_context";

/**
 * 阅读统计 Tier 0 的数据层（issue #53 / #55 / docs/READER_ANALYTICS.md §5、§9 第 1 步）。
 *
 * - `dayKey()`：站点时区常量 `Asia/Shanghai` 的日界；清理边界与后续计数共用，
 *   避免 UTC 与本地时区各算一套「今天」。
 * - `runAnalyticsCleanup()`：每日 cron 的清理骨架——过期令牌、400 天保留窗口、
 *   心跳 `site_config.analytics_last_job_at`。
 * - `getAnalyticsHmacSecret()`：`site_config.analytics_hmac_secret` 首次使用时
 *   懒生成；独立于 `jwt_secret`，轮换 JWT 不影响去重令牌。
 * - `recordArticleView()`：详情 200 的过滤、24h 去重与日聚合（§4.1 / §4.2）。
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
  expiredTokensDeleted: number;
  articleRowsDeleted: number;
  dimRowsDeleted: number;
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
    expiredTokensDeleted: expiredTokens.meta.changes,
    articleRowsDeleted: articleDays.meta.changes,
    dimRowsDeleted: dimDays.meta.changes,
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

/**
 * 取阅读统计 HMAC 密钥；首次使用时懒生成并持久化（独立于 jwt_secret）。
 * 并发首次使用用「仅填空值」的 upsert + 回读收敛：所有调用方拿到同一落库值，
 * 避免两个请求各生成一份、后写覆盖前写导致 24h 内去重令牌失配。
 */
export async function getAnalyticsHmacSecret(env: Env): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT value FROM site_config WHERE key = 'analytics_hmac_secret'"
  ).first<{ value: string }>();
  if (row?.value) return row.value;

  const secret = generateAnalyticsHmacSecret();
  await env.DB.prepare(
    "INSERT INTO site_config (key, value, is_public, updated_at) VALUES ('analytics_hmac_secret', ?, 0, datetime('now')) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now') WHERE site_config.value = ''"
  )
    .bind(secret)
    .run();

  const stored = await env.DB.prepare(
    "SELECT value FROM site_config WHERE key = 'analytics_hmac_secret'"
  ).first<{ value: string }>();
  return stored?.value || secret;
}

/* ── 详情访问计数（issue #55 / docs/READER_ANALYTICS.md §4） ────────────── */

/** §4.1 规则 4：爬虫 / 预览 / 命令行 UA 片段（大小写不敏感） */
const BOT_UA_PATTERN =
  /bot|crawler|spider|preview|headless|curl|wget|python-requests|Go-http-client|facebookexternalhit|Twitterbot|Slackbot|TelegramBot|WhatsApp|Discordbot|Pinterest/i;

/** 24h 去重令牌有效期（§4.2）；清理任务按 expires_at 删除 */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

type DailyCounter = "pv" | "uv" | "requests" | "bot_filtered";

/**
 * 日聚合自增。列名来自内部白名单常量，不拼接外部输入；
 * `ON CONFLICT` 让首行与后续行共用一条语句，配合 batch 原子提交。
 */
function bumpDaily(
  env: Env,
  articleId: number,
  day: string,
  counters: readonly DailyCounter[]
) {
  const columns = counters.join(", ");
  const ones = counters.map(() => "1").join(", ");
  const increments = counters
    .map((column) => `${column} = ${column} + 1`)
    .join(", ");
  return env.DB.prepare(
    `INSERT INTO analytics_article_daily (article_id, day, ${columns}) ` +
      `VALUES (?, ?, ${ones}) ON CONFLICT(article_id, day) DO UPDATE SET ` +
      `${increments}, updated_at = datetime('now')`
  ).bind(articleId, day);
}

/**
 * §4.1 的 7 条过滤规则，命中即丢弃。规则 5/6 依赖付费版 Bot Management：
 * 本部署不可用，仅保留守卫分支（spec §4.1 注），正常链路永不触发。
 */
export function isBotRequest(
  request: Request,
  context: VisitorContext
): boolean {
  if (request.method !== "GET") return true;

  const purposes = [context.secPurpose, context.purpose]
    .filter((value): value is string => value !== null)
    .join(" ")
    .toLowerCase();
  if (purposes.includes("prefetch")) return true;
  if (context.xPurpose?.toLowerCase().includes("preview")) return true;

  if (
    context.secFetchMode &&
    context.secFetchMode.toLowerCase() !== "navigate"
  ) {
    return true;
  }

  if (!context.userAgent || BOT_UA_PATTERN.test(context.userAgent)) return true;

  const botManagement = (
    request as Request & {
      cf?: { botManagement?: { verifiedBot?: boolean; score?: number } };
    }
  ).cf?.botManagement;
  if (botManagement?.verifiedBot) return true;
  if (typeof botManagement?.score === "number" && botManagement.score < 30) {
    return true;
  }

  if (!context.accept?.toLowerCase().includes("text/html")) return true;
  return false;
}

/** §4.2：HMAC-SHA256(secret, IP + UA + article_id + day)；分隔符避免字段边界歧义 */
async function viewToken(
  secret: string,
  ip: string,
  userAgent: string,
  articleId: number,
  day: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode([ip, userAgent, articleId, day].join("\u001f"))
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function hasViewCookie(
  cookieHeader: string | null,
  articleId: number
): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(";")
    .some((cookie) => cookie.trim().startsWith(`view_${articleId}=`));
}

export interface ArticleViewResult {
  /** 请求未带 `view_<id>` 时下发 Cookie，保持既有响应契约（§4.2 第 5 步） */
  setCookie: boolean;
}

/**
 * 已发布文章详情 200 的计数入口，替换 `incrementViewCount`。
 *
 * 口径（§2 / §4）：
 * - 过滤命中：仅 SSR 链路（带 `X-Real-IP`）累加 `bot_filtered`；直连被丢弃的请求不写库；
 * - 直连 API（无 `X-Real-IP`）：过滤后只累加 `requests`；
 * - SSR 链路：每次过滤后 200 都累加 `pv` / `requests`；Cookie 命中或令牌命中时
 *   跳过 UV 与累计阅读量（快路径）；首次命中按 §4.2 用一次 D1 batch 原子写入。
 *
 * 注：§4.2 伪代码第 1 步写「Cookie 命中直接跳过、不写库」，与 §10 验收
 * 「同 Cookie 连续两次 pv +2、uv +1」冲突；此处以验收与 §2 的 PV 定义为准。
 */
export async function recordArticleView(
  env: Env,
  request: Request,
  articleId: number
): Promise<ArticleViewResult> {
  const context = readVisitorContext(request);
  const ip = context.ip;
  const userAgent = context.userAgent;
  const cookieHit = hasViewCookie(request.headers.get("cookie"), articleId);
  const setCookie = !cookieHit;
  const day = dayKey();

  if (isBotRequest(request, context)) {
    if (ip !== null)
      await bumpDaily(env, articleId, day, ["bot_filtered"]).run();
    return { setCookie };
  }

  if (ip === null || userAgent === null) {
    await bumpDaily(env, articleId, day, ["requests"]).run();
    return { setCookie };
  }

  // Cookie / 令牌命中：仍是过滤后 200，PV 与 requests 照计，只跳过 UV 去重。
  if (cookieHit) {
    await bumpDaily(env, articleId, day, ["pv", "requests"]).run();
    return { setCookie };
  }

  const secret = await getAnalyticsHmacSecret(env);
  const token = await viewToken(secret, ip, userAgent, articleId, day);
  const existing = await env.DB.prepare(
    "SELECT token FROM analytics_view_token WHERE token = ?"
  )
    .bind(token)
    .first();
  if (existing) {
    await bumpDaily(env, articleId, day, ["pv", "requests"]).run();
    return { setCookie };
  }

  const expiresAt = sqliteUtcTimestamp(new Date(Date.now() + TOKEN_TTL_MS));
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO analytics_view_token (token, day, expires_at) VALUES (?, ?, ?)"
    ).bind(token, day, expiresAt),
    bumpDaily(env, articleId, day, ["pv", "uv", "requests"]),
    env.DB.prepare(
      "UPDATE articles SET view_count = view_count + 1 WHERE id = ?"
    ).bind(articleId),
  ]);
  return { setCookie };
}
