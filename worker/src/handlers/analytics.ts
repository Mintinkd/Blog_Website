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
 * 阅读统计后台只读接口（issue #55 / #56 / docs/READER_ANALYTICS.md §6、§7.2、§7.5）。
 * 全部接口由 router 以 `requireAuth + requireAdmin` 注册；`range` / `dim` 走白名单。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** 含当日在内的 [from, to] 日界，概览与分布共用一套时区口径 */
function rangeBounds(range: AnalyticsRange): { from: string; to: string } {
  const days = RANGE_DAYS[range];
  const to = dayKey();
  return {
    from: dayKey(new Date(Date.now() - (days - 1) * DAY_MS)),
    to,
  };
}

/** 两个只读接口共用的 range 校验；错误文案由白名单派生，避免两处各自维护 */
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

/** 概览卡：Tier 0 可见 PV / UV / 过滤 bot；有效阅读属 Tier 1，恒为 null */
export async function handleAnalyticsOverview(
  request: Request,
  env: Env
): Promise<Response> {
  const range = parseRange(new URL(request.url).searchParams);
  if (range instanceof Response) return range;

  const { from, to } = rangeBounds(range);

  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(pv), 0) AS pv, COALESCE(SUM(uv), 0) AS uv, " +
      "COALESCE(SUM(bot_filtered), 0) AS bot_filtered " +
      "FROM analytics_article_daily WHERE day >= ? AND day <= ?"
  )
    .bind(from, to)
    .first<{ pv: number; uv: number; bot_filtered: number }>();

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
