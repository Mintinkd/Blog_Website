import type { Env } from "../index";
import { dayKey } from "../services/analytics_service";
import {
  ANALYTICS_DIMENSIONS,
  isAnalyticsDimension,
  protectSmallSamples,
  type DimensionBucketRow,
} from "../services/analytics_dimensions";
import { error, ErrorCodes, successResponse } from "../utils/response";

/**
 * 阅读统计后台只读接口（issue #55 / #56 / #57 / docs/READER_ANALYTICS.md §6、§7.2、§7.4–§7.6）。
 * 全部接口由 router 以 `requireAuth + requireAdmin` 注册；`range` / `dim` / `page` 走白名单。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 文章表分页与 7 日 sparkline（§7.4） */
const ARTICLES_PAGE_SIZE = 20;
const SPARKLINE_DAYS = 7;

/** 质量面板告警阈值（§7.6） */
const BOT_RATIO_ALERT = 0.4;
const PROXY_COVERAGE_ALERT = 0.9;
const HEARTBEAT_MAX_AGE_MS = 26 * 60 * 60 * 1000;
const TOKEN_ROWS_ALERT = 100_000;
const ANOMALY_SIGMA = 3;

/** 心跳是 UTC `YYYY-MM-DD HH:MM:SS`（`datetime('now')` 同格式），不接受残缺值 */
const HEARTBEAT_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** 概览与质量共用的日聚合汇总：同一份 SQL，避免两处各写一份后漂移 */
const DAILY_TOTALS_SQL =
  "SELECT COALESCE(SUM(pv), 0) AS pv, COALESCE(SUM(uv), 0) AS uv, " +
  "COALESCE(SUM(requests), 0) AS requests, " +
  "COALESCE(SUM(bot_filtered), 0) AS bot_filtered " +
  "FROM analytics_article_daily WHERE day >= ? AND day <= ?";

interface TotalsRow {
  pv: number;
  uv: number;
  requests: number;
  bot_filtered: number;
}

/** range → 含当日在内的日历天数；站点时区日界由 dayKey() 统一切分 */
const RANGE_DAYS = {
  today: 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
} as const;

export type AnalyticsRange = keyof typeof RANGE_DAYS;

export function isAnalyticsRange(
  value: string | null
): value is AnalyticsRange {
  return (
    value !== null && Object.prototype.hasOwnProperty.call(RANGE_DAYS, value)
  );
}

/** 含当日在内的 [from, to] 日界，四个只读接口共用一套时区口径 */
function rangeBounds(range: AnalyticsRange): { from: string; to: string } {
  const days = RANGE_DAYS[range];
  const to = dayKey();
  return {
    from: dayKey(new Date(Date.now() - (days - 1) * DAY_MS)),
    to,
  };
}

/** 四个只读接口共用的 range 校验；错误文案由白名单派生，避免多处各自维护 */
function parseRange(params: URLSearchParams): AnalyticsRange | Response {
  const value = params.get("range");
  if (!isAnalyticsRange(value)) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      `无效的 range 参数（仅支持 ${Object.keys(RANGE_DAYS).join(" / ")}）`
    );
  }
  return value;
}

/** 最近 `days` 个站点时区日界，升序，最后一项是今天 */
function daySequence(days: number): string[] {
  return Array.from({ length: days }, (_, i) =>
    dayKey(new Date(Date.now() - (days - 1 - i) * DAY_MS))
  );
}

/** 文章表页码：省略为 1，非正整数 400（与其它后台参数的严格校验一致） */
function parsePage(params: URLSearchParams): number | Response {
  const value = params.get("page");
  if (value === null) return 1;
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      "无效的 page 参数（须为正整数）"
    );
  }
  return Number(value);
}

/** 心跳缺失 / 格式非法 / 超 26h 都算告警 */
function isFreshHeartbeat(value: string): boolean {
  if (!HEARTBEAT_PATTERN.test(value)) return false;
  const parsed = Date.parse(`${value.replace(" ", "T")}Z`);
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed <= HEARTBEAT_MAX_AGE_MS;
}

/** 概览卡：Tier 0 可见 PV / UV / 过滤 bot；有效阅读属 Tier 1，恒为 null */
export async function handleAnalyticsOverview(
  request: Request,
  env: Env
): Promise<Response> {
  const range = parseRange(new URL(request.url).searchParams);
  if (range instanceof Response) return range;

  const { from, to } = rangeBounds(range);

  const row = await env.DB.prepare(DAILY_TOTALS_SQL)
    .bind(from, to)
    .first<TotalsRow>();

  return successResponse({
    range,
    pv: row?.pv ?? 0,
    uv: row?.uv ?? 0,
    bot_filtered: row?.bot_filtered ?? 0,
    // Tier 1（同意后有效阅读）未实施，概览保留字段但不编造数据
    engaged: null,
  });
}

/** 分布：按文章或全站聚合（`GROUP BY bucket`），查询层做小样本保护（§7.5） */
export async function handleAnalyticsDimensions(
  request: Request,
  env: Env
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const range = parseRange(params);
  if (range instanceof Response) return range;
  const dim = params.get("dim");
  const articleIdParam = params.get("article_id");

  if (!isAnalyticsDimension(dim)) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      `无效的 dim 参数（仅支持 ${ANALYTICS_DIMENSIONS.join(" / ")}）`
    );
  }

  let articleId: number | null = null;
  if (articleIdParam !== null) {
    if (!/^\d+$/.test(articleIdParam) || Number(articleIdParam) <= 0) {
      return error(
        ErrorCodes.VALIDATION_FAILED,
        "无效的 article_id 参数（须为正整数）"
      );
    }
    articleId = Number(articleIdParam);
  }

  const { from, to } = rangeBounds(range);
  // 全站视图由 GROUP BY 聚合，不读也不写 article_id = 0 的全站行（§11 决策 4）
  const sql =
    "SELECT bucket, SUM(count) AS count FROM analytics_dim_daily " +
    "WHERE day >= ? AND day <= ? AND dim = ?" +
    (articleId === null ? "" : " AND article_id = ?") +
    " GROUP BY bucket";
  const binds =
    articleId === null ? [from, to, dim] : [from, to, dim, articleId];
  const result = await env.DB.prepare(sql)
    .bind(...binds)
    .all<DimensionBucketRow>();

  return successResponse({
    dim,
    range,
    article_id: articleId,
    ...protectSmallSamples(result.results ?? []),
  });
}

interface ArticleAggregateRow {
  id: number;
  title: string;
  slug: string;
  pv: number;
  uv: number;
}

interface ReferrerAggregateRow {
  article_id: number;
  bucket: string;
  total: number;
}

interface SparkRow {
  article_id: number;
  day: string;
  pv: number;
}

/**
 * 文章明细表（§7.4）：PV 降序、分页 20、来源 Top1、固定 7 日 sparkline、
 * `MIN(day)` 起点标注。Tier 1 的有效阅读率 / 平均停留档返回 null。
 */
export async function handleAnalyticsArticles(
  request: Request,
  env: Env
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const range = parseRange(params);
  if (range instanceof Response) return range;
  const page = parsePage(params);
  if (page instanceof Response) return page;

  const { from, to } = rangeBounds(range);
  const days = daySequence(SPARKLINE_DAYS);

  const [totalRow, sinceRow, articles, referrers, sparks] = await Promise.all([
    // 与 items 一样 JOIN articles：文章删除后日聚合仍保留 400 天，
    // 悬空 article_id 不得计入 total，否则分页会多出空页
    env.DB.prepare(
      "SELECT COUNT(DISTINCT d.article_id) AS total FROM analytics_article_daily d " +
        "JOIN articles a ON a.id = d.article_id " +
        "WHERE d.day >= ? AND d.day <= ?"
    )
      .bind(from, to)
      .first<{ total: number }>(),
    env.DB.prepare(
      "SELECT MIN(day) AS since FROM analytics_article_daily"
    ).first<{ since: string | null }>(),
    env.DB.prepare(
      "SELECT d.article_id AS id, a.title AS title, a.slug AS slug, " +
        "SUM(d.pv) AS pv, SUM(d.uv) AS uv FROM analytics_article_daily d " +
        "JOIN articles a ON a.id = d.article_id " +
        "WHERE d.day >= ? AND d.day <= ? GROUP BY d.article_id " +
        "ORDER BY pv DESC, d.article_id ASC LIMIT ? OFFSET ?"
    )
      .bind(from, to, ARTICLES_PAGE_SIZE, (page - 1) * ARTICLES_PAGE_SIZE)
      .all<ArticleAggregateRow>(),
    env.DB.prepare(
      "SELECT article_id, bucket, SUM(count) AS total FROM analytics_dim_daily " +
        "WHERE day >= ? AND day <= ? AND dim = 'referrer' " +
        "GROUP BY article_id, bucket"
    )
      .bind(from, to)
      .all<ReferrerAggregateRow>(),
    env.DB.prepare(
      "SELECT article_id, day, SUM(pv) AS pv FROM analytics_article_daily " +
        "WHERE day >= ? AND day <= ? GROUP BY article_id, day"
    )
      .bind(days[0], to)
      .all<SparkRow>(),
  ]);

  const topByArticle = new Map<number, { bucket: string; total: number }>();
  for (const row of referrers.results ?? []) {
    const current = topByArticle.get(row.article_id);
    if (
      !current ||
      row.total > current.total ||
      (row.total === current.total && row.bucket < current.bucket)
    ) {
      topByArticle.set(row.article_id, {
        bucket: row.bucket,
        total: row.total,
      });
    }
  }

  const sparkByArticle = new Map<number, Map<string, number>>();
  for (const row of sparks.results ?? []) {
    let perDay = sparkByArticle.get(row.article_id);
    if (!perDay) {
      perDay = new Map();
      sparkByArticle.set(row.article_id, perDay);
    }
    perDay.set(row.day, (perDay.get(row.day) ?? 0) + row.pv);
  }

  const items = (articles.results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    pv: row.pv,
    uv: row.uv,
    top_referrer: topByArticle.get(row.id)?.bucket ?? null,
    sparkline: days.map((day) => sparkByArticle.get(row.id)?.get(day) ?? 0),
    // Tier 1 未实施：返回 null，由 #58 隐藏对应列
    engaged_rate: null,
    avg_dwell_bucket: null,
  }));

  const total = totalRow?.total ?? 0;
  return successResponse({
    range,
    page,
    page_size: ARTICLES_PAGE_SIZE,
    total,
    total_pages: Math.ceil(total / ARTICLES_PAGE_SIZE),
    // MIN(day) 为空时返回 null，前台不显示「自 … 起」（§7.4）
    since: sinceRow?.since ?? null,
    items,
  });
}

/**
 * 数据质量面板（§7.6）：过滤 bot 占比、代理覆盖率、清理心跳、3σ 异常波动、
 * 令牌表行数。分母为 0 的比率返回 null（前台显示「—」）。
 */
export async function handleAnalyticsQuality(
  request: Request,
  env: Env
): Promise<Response> {
  const range = parseRange(new URL(request.url).searchParams);
  if (range instanceof Response) return range;
  const { from, to } = rangeBounds(range);

  // 8 个日界：前 7 个为基线，最后一个是当日
  const days = daySequence(SPARKLINE_DAYS + 1);
  const [totals, heartbeat, tokenRow, daily] = await Promise.all([
    env.DB.prepare(DAILY_TOTALS_SQL).bind(from, to).first<TotalsRow>(),
    env.DB.prepare(
      "SELECT value FROM site_config WHERE key = 'analytics_last_job_at'"
    ).first<{ value: string }>(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM analytics_view_token").first<{
      count: number;
    }>(),
    env.DB.prepare(
      "SELECT day, SUM(pv) AS pv FROM analytics_article_daily " +
        "WHERE day >= ? AND day <= ? GROUP BY day ORDER BY day"
    )
      .bind(days[0], to)
      .all<{ day: string; pv: number }>(),
  ]);

  const pv = totals?.pv ?? 0;
  const uv = totals?.uv ?? 0;
  const requests = totals?.requests ?? 0;
  const botFiltered = totals?.bot_filtered ?? 0;
  // 原始请求 = 通过过滤的 requests + 被丢弃的 bot_filtered（§7.6「占原始请求」）
  const rawRequests = requests + botFiltered;
  const proxyCoverage = requests > 0 ? pv / requests : null;
  const botRatio = rawRequests > 0 ? botFiltered / rawRequests : null;

  const heartbeatAt = heartbeat?.value ?? null;
  const tokenRows = tokenRow?.count ?? 0;

  const pvByDay = new Map(
    (daily.results ?? []).map((row) => [row.day, row.pv])
  );
  const baseline = days
    .slice(0, SPARKLINE_DAYS)
    .map((day) => pvByDay.get(day) ?? 0);
  const todayPv = pvByDay.get(days[SPARKLINE_DAYS]) ?? 0;
  const mean =
    baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
  const sigma = Math.sqrt(
    baseline.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      baseline.length
  );
  // 基线全 0（刚上线 / 无历史）不误报；其余按 |当日 - 均值| > 3σ 判定
  const anomaly = mean > 0 && Math.abs(todayPv - mean) > ANOMALY_SIGMA * sigma;

  return successResponse({
    range,
    from,
    to,
    pv,
    uv,
    requests,
    bot_filtered: botFiltered,
    bot_ratio: botRatio,
    bot_ratio_alert: botRatio !== null && botRatio > BOT_RATIO_ALERT,
    proxy_coverage: proxyCoverage,
    proxy_coverage_alert:
      proxyCoverage !== null && proxyCoverage < PROXY_COVERAGE_ALERT,
    heartbeat_at: heartbeatAt,
    heartbeat_alert: heartbeatAt === null || !isFreshHeartbeat(heartbeatAt),
    anomaly,
    today_pv: todayPv,
    baseline_mean: mean,
    baseline_sigma: sigma,
    token_rows: tokenRows,
    token_rows_alert: tokenRows > TOKEN_ROWS_ALERT,
    // Tier 1 未实施
    engaged_rate: null,
  });
}
