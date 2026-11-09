import type { Env } from "../index";
import { dayKey } from "../services/analytics_service";
import { error, ErrorCodes, successResponse } from "../utils/response";

/**
 * 阅读统计后台只读接口（issue #55 / docs/READER_ANALYTICS.md §6、§7.2）。
 * 全部接口由 router 以 `requireAuth + requireAdmin` 注册；`range` 走白名单。
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

/** 概览卡：Tier 0 可见 PV / UV / 过滤 bot；有效阅读属 Tier 1，恒为 null */
export async function handleAnalyticsOverview(
  request: Request,
  env: Env
): Promise<Response> {
  const range = new URL(request.url).searchParams.get("range");
  if (!isAnalyticsRange(range)) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      "无效的 range 参数（仅支持 today / 7d / 30d / 90d）"
    );
  }

  const days = RANGE_DAYS[range];
  const to = dayKey();
  const from = dayKey(new Date(Date.now() - (days - 1) * DAY_MS));

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
