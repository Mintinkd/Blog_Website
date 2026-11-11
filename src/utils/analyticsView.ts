/**
 * 后台「统计」面板的可测展示逻辑（issue #58 / docs/READER_ANALYTICS.md §7）。
 *
 * SVG 路径、空态 / 比率格式、小样本展示与 Tier 0 白名单收敛在此纯模块：
 * App.vue 只负责取数与模板，浏览器回归与 vitest 各自覆盖一层。
 * 不引入图表库；所有坐标按传入宽高缩放，调用方决定 viewBox。
 */

export const EMPTY_VALUE = "—";

/** §7.2：Tier 0 可见 3 张卡；Tier 1 的 3 张在关闭时完全不渲染 */
export const TIER0_CARDS = ["pv", "uv", "bot_filtered"] as const;
export const TIER1_CARDS = ["engaged", "engaged_rate", "consent_rate"] as const;

/** §7.5：Tier 0 两个图 + 一个表；Tier 1 维度在关闭时完全不渲染 */
export const TIER0_DIMENSIONS = ["device", "country", "referrer"] as const;
export const TIER1_DIMENSIONS = [
  "browser",
  "os",
  "language",
  "screen",
  "dwell",
  "scroll",
] as const;

/** 面板使用的全部 i18n key：zh.json / en.json 必须同步（见 tests/analytics-view.test.ts） */
export const ANALYTICS_I18N_KEYS = [
  "analytics.nav",
  "analytics.title",
  "analytics.range",
  "analytics.range_today",
  "analytics.range_7d",
  "analytics.range_30d",
  "analytics.range_90d",
  "analytics.article_filter",
  "analytics.article_all",
  "analytics.updated_at",
  "analytics.loading",
  "analytics.error",
  "analytics.retry",
  "analytics.no_data",
  "analytics.pv",
  "analytics.uv",
  "analytics.bot_filtered",
  "analytics.trend_title",
  "analytics.trend_pv",
  "analytics.trend_uv",
  "analytics.trend_pending",
  "analytics.trend_bot",
  "analytics.articles_title",
  "analytics.table_title",
  "analytics.table_pv",
  "analytics.table_uv",
  "analytics.table_referrer",
  "analytics.table_sparkline",
  "analytics.table_since",
  "analytics.table_empty",
  "analytics.table_page",
  "analytics.prev",
  "analytics.next",
  "analytics.dim_title",
  "analytics.dim_device",
  "analytics.dim_country",
  "analytics.dim_referrer",
  "analytics.dim_insufficient",
  "analytics.dim_bucket",
  "analytics.dim_count",
  "analytics.dim_percent",
  "analytics.device_desktop",
  "analytics.device_mobile",
  "analytics.device_tablet",
  "analytics.device_unknown",
  "analytics.bot_hint",
  "analytics.quality_title",
  "analytics.quality_bot_ratio",
  "analytics.quality_coverage",
  "analytics.quality_heartbeat",
  "analytics.quality_anomaly",
  "analytics.quality_tokens",
  "analytics.quality_ok",
  "analytics.quality_alert",
  "analytics.quality_heartbeat_missing",
  "analytics.quality_anomaly_hint",
  "analytics.other",
] as const;

export interface TrendDay {
  day: string;
  pv: number;
  uv: number;
  bot_filtered: number;
}

export interface TrendPoint extends TrendDay {
  x: number;
  yPv: number;
  yUv: number;
}

export interface DimensionBucket {
  bucket: string;
  count: number;
}

export interface DimensionData {
  total: number;
  insufficient: boolean;
  buckets: DimensionBucket[];
}

export interface DimensionRow {
  label: string;
  count: number;
  percent: string;
}

/** 空库判定：概览三项全 0 时 PV / UV 显示「—」，过滤 bot 仍显示 0（§7.2） */
export function hasAnalyticsData(
  overview: { pv: number; uv: number; bot_filtered: number } | null
): boolean {
  if (!overview) return false;
  return overview.pv > 0 || overview.uv > 0 || overview.bot_filtered > 0;
}

export function formatMetric(
  value: number | null | undefined,
  empty = EMPTY_VALUE
): string {
  return value === null || value === undefined ? empty : String(value);
}

export function formatRatio(
  value: number | null | undefined,
  digits = 1
): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  return `${(value * 100).toFixed(digits)}%`;
}

/** §7.3：少于 2 个有数据的日界显示「数据积累中」，不画 0 值折线 */
export function hasEnoughTrendDays(days: readonly TrendDay[]): boolean {
  return days.filter((item) => item.pv > 0 || item.uv > 0).length >= 2;
}

/** PV / UV 双线共用同一个最大值缩放，保证两条线可直接比较 */
export function buildTrendPaths(
  days: readonly TrendDay[],
  width = 600,
  height = 160
): { pvPath: string; uvPath: string; points: TrendPoint[]; max: number } {
  const max = Math.max(1, ...days.flatMap((item) => [item.pv, item.uv]));
  const stepX = days.length > 1 ? width / (days.length - 1) : 0;
  const points: TrendPoint[] = days.map((item, index) => ({
    ...item,
    x: Number((index * stepX).toFixed(2)),
    yPv: Number((height - (item.pv / max) * height).toFixed(2)),
    yUv: Number((height - (item.uv / max) * height).toFixed(2)),
  }));
  const toPath = (key: "yPv" | "yUv") =>
    points
      .map(
        (point, index) => `${index === 0 ? "M" : "L"}${point.x},${point[key]}`
      )
      .join(" ");
  return {
    pvPath: toPath("yPv"),
    uvPath: toPath("yUv"),
    points,
    max,
  };
}

/** §7.4 内联 sparkline：固定 7 点，接口已补 0 */
export function buildSparklinePath(
  values: readonly number[],
  width = 80,
  height = 24
): string {
  if (values.length === 0) return "";
  const max = Math.max(1, ...values);
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      const x = Number((index * stepX).toFixed(2));
      const y = Number((height - (value / max) * height).toFixed(2));
      return `${index === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");
}

const DEVICE_BUCKET_KEYS: Record<string, string> = {
  desktop: "analytics.device_desktop",
  mobile: "analytics.device_mobile",
  tablet: "analytics.device_tablet",
  unknown: "analytics.device_unknown",
};

/** §7.5：设备名走 t() 中英词条；地区补 Intl 区域名（不维护易过期的国家名表） */
function bucketLabel(
  bucket: string,
  dim: string | undefined,
  t: (key: string) => string,
  locale: string
): string {
  if (bucket === "other") return t("analytics.other");
  if (dim === "device" && DEVICE_BUCKET_KEYS[bucket]) {
    return t(DEVICE_BUCKET_KEYS[bucket]);
  }
  if (dim === "country" && /^[A-Z0-9]{2}$/.test(bucket)) {
    const DisplayNames = (
      Intl as unknown as {
        DisplayNames?: new (
          locales: string[],
          options: { type: string }
        ) => { of(code: string): string | undefined };
      }
    ).DisplayNames;
    if (DisplayNames) {
      const name = new DisplayNames([locale], { type: "region" }).of(bucket);
      if (name && name !== bucket) return `${bucket} · ${name}`;
    }
  }
  return bucket;
}

export interface AnalyticsFailure {
  name: string;
  code: number | string | null;
}

/**
 * 失败接口清单 → 错误态里可直接展示的技术细节（接口名 / code）。
 * 不透传服务端 message，避免内部错误文本进入 DOM；中英切换由 t() 的标题负责。
 */
export function formatAnalyticsFailures(
  failures: readonly AnalyticsFailure[]
): string {
  return failures.map((item) => `${item.name}: ${item.code ?? "?"}`).join("; ");
}

/** §7.5：`insufficient` 时不返回桶；`other` 由 t() 映射；地区 Top 8 截断 */
export function dimensionRows(
  data: DimensionData | null,
  t: (key: string) => string,
  dim?: string,
  locale = "zh"
): { insufficient: boolean; rows: DimensionRow[] } {
  if (!data) return { insufficient: false, rows: [] };
  if (data.insufficient) return { insufficient: true, rows: [] };
  const buckets = dim === "country" ? data.buckets.slice(0, 8) : data.buckets;
  return {
    insufficient: false,
    rows: buckets.map((bucket) => ({
      label: bucketLabel(bucket.bucket, dim, t, locale),
      count: bucket.count,
      percent: formatRatio(data.total > 0 ? bucket.count / data.total : null),
    })),
  };
}
