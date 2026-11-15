/**
 * AnalyticsPanel 实际消费的纯逻辑。不依赖 DOM / Vue / window / fetch。
 * 对应 loadAnalytics() 的 8 条取数 URL / 失败过滤 / 心跳时间格式化，
 * 与 applyAnalyticsArticleFilter() 的匹配逻辑；由 `tests/admin-scrape-analytics.test.ts`
 * 在 node 环境锁定，面板与测试共用同一份实现，不存在镜像自证。
 */

export interface AnalyticsCheck {
  name: string;
  res?: { code?: number | null } | null;
}

export interface CollectedFailure {
  name: string;
  code: number | string | null;
}

/** 对应 checks.filter(item => item.res?.code !== 0).map(...) */
export function collectAnalyticsFailures(
  checks: readonly AnalyticsCheck[]
): CollectedFailure[] {
  return checks
    .filter((item) => item.res?.code !== 0)
    .map((item) => ({ name: item.name, code: item.res?.code ?? null }));
}

/** 对应 loadAnalytics() 的 8 条并发 GET URL */
export function analyticsRequestPaths(
  range: string,
  page: number,
  articleId: string
): string[] {
  const articleQuery = articleId
    ? `&article_id=${encodeURIComponent(articleId)}`
    : "";
  const base = "/admin/analytics";
  return [
    `${base}/overview?range=${range}`,
    `${base}/trend?range=${range}`,
    `${base}/articles?range=${range}&page=${page}`,
    `${base}/quality?range=${range}`,
    `${base}/dimensions?dim=device&range=${range}${articleQuery}`,
    `${base}/dimensions?dim=country&range=${range}${articleQuery}`,
    `${base}/dimensions?dim=referrer&range=${range}${articleQuery}`,
    "/articles?page_size=50",
  ];
}

/** 对应 applyAnalyticsArticleFilter() 的匹配逻辑 */
export function articleFilterId(
  query: string,
  options: readonly { id: number; title: string }[]
): string {
  const trimmed = query.trim();
  const match = options.find((item) => item.title === trimmed);
  return trimmed !== "" && match ? String(match.id) : "";
}

/** 对应 §7.1 数据时间：优先心跳，无心跳回落本次取数时刻，坏值显示「—」 */
export function analyticsStamp(
  heartbeat: unknown,
  now: Date,
  locale: string
): string {
  const stamp = heartbeat
    ? new Date(String(heartbeat).replace(" ", "T") + "Z")
    : now;
  return Number.isFinite(stamp.getTime())
    ? stamp.toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}
