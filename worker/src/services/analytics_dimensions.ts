import type { Env } from "../index";
import type { VisitorContext } from "../utils/visitor_context";

/**
 * 阅读统计 Tier 0 维度桶（issue #56 / docs/READER_ANALYTICS.md §3、§5、§7.5）。
 *
 * - `dimensionBuckets()`：device / country / referrer 的纯映射，输入来自 #54 的
 *   `readVisitorContext`；同站 Referer 以 Worker 请求的 hostname 判定。
 * - `upsertDimensionStatements()`：只写单篇 `article_id` 行，不写全站行（§11 决策 4）；
 *   由 `recordArticleView` 放进同一 D1 `batch()`，与日聚合 `uv` 列同口径。
 * - `protectSmallSamples()`：查询层小样本保护（§7.5），供分布接口使用。
 *
 * 口径裁定（#56）：维度桶按**去重访客**计，不按每次页面请求；缺失值落
 * `unknown` / `direct`；桶 < 5 合并到稳定 key `other`，总样本 < 20 返回数据不足。
 */

/** Tier 0 三个维度；Tier 1 的 browser / os / language / screen / dwell / scroll 不在此列 */
export const ANALYTICS_DIMENSIONS = ["device", "country", "referrer"] as const;

export type AnalyticsDimension = (typeof ANALYTICS_DIMENSIONS)[number];

export function isAnalyticsDimension(
  value: string | null
): value is AnalyticsDimension {
  return (
    value !== null &&
    (ANALYTICS_DIMENSIONS as readonly string[]).includes(value)
  );
}

export const UNKNOWN_BUCKET = "unknown";
export const DIRECT_BUCKET = "direct";
export const INTERNAL_BUCKET = "internal";
export const OTHER_BUCKET = "other";

/** §3 设备类别；桶名与其它维度一样集中在常量，避免多处裸字面量漂移 */
export const DEVICE_BUCKETS = {
  desktop: "desktop",
  mobile: "mobile",
  tablet: "tablet",
} as const;

/** §7.5：桶计数小于该值合并进「其他」，维度总样本小于该值整块显示「数据不足」 */
export const SMALL_BUCKET_THRESHOLD = 5;
export const MIN_SAMPLE_SIZE = 20;

/**
 * §3：UA-CH `Sec-CH-UA-Mobile` 优先，缺失时回退 UA 解析。
 * `?0` 只表示「非手机」——平板同样上报 `?0`，故仍先按 UA 识别平板，
 * 再让 `?0` 压过 UA 中的手机特征（避免 UA-CH 与伪造 UA 冲突时误判）。
 */
function deviceBucket(context: VisitorContext): string {
  const hint = context.clientHints["sec-ch-ua-mobile"]?.trim();
  if (hint === "?1") return DEVICE_BUCKETS.mobile;

  const ua = context.userAgent;
  if (!ua) {
    return hint === "?0" ? DEVICE_BUCKETS.desktop : UNKNOWN_BUCKET;
  }
  if (/ipad|tablet|playbook|silk/i.test(ua)) return DEVICE_BUCKETS.tablet;
  if (/android/i.test(ua) && !/mobile/i.test(ua)) return DEVICE_BUCKETS.tablet;
  if (hint === "?0") return DEVICE_BUCKETS.desktop;
  if (/mobile|iphone|ipod|windows phone/i.test(ua)) {
    return DEVICE_BUCKETS.mobile;
  }
  return DEVICE_BUCKETS.desktop;
}

/** §3：只取域名、剥 path/query；同站记 `internal`，缺失 / 非法记 `direct` */
function referrerBucket(referer: string | null, siteHost: string): string {
  if (!referer) return DIRECT_BUCKET;
  try {
    const url = new URL(referer);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return DIRECT_BUCKET;
    }
    const host = url.hostname.toLowerCase();
    if (!host) return DIRECT_BUCKET;
    if (host === siteHost.toLowerCase()) return INTERNAL_BUCKET;
    return host;
  } catch {
    return DIRECT_BUCKET;
  }
}

/** 一次算出三个维度的桶值；键顺序即 `ANALYTICS_DIMENSIONS` 顺序 */
export function dimensionBuckets(
  context: VisitorContext,
  siteHost: string
): Record<AnalyticsDimension, string> {
  return {
    device: deviceBucket(context),
    country: context.country ?? UNKNOWN_BUCKET,
    referrer: referrerBucket(context.referer, siteHost),
  };
}

/**
 * 单篇维度桶 upsert。三条语句随 #55 的令牌 / 日聚合 / `view_count` 一起
 * 进入 D1 `batch()`，保证 UV 与维度桶原子一致；不写 `article_id = 0` 全站行。
 */
export function upsertDimensionStatements(
  env: Env,
  articleId: number,
  day: string,
  buckets: Record<AnalyticsDimension, string>
) {
  return ANALYTICS_DIMENSIONS.map((dim) =>
    env.DB.prepare(
      "INSERT INTO analytics_dim_daily (day, dim, bucket, article_id, count) " +
        "VALUES (?, ?, ?, ?, 1) ON CONFLICT(day, dim, bucket, article_id) " +
        "DO UPDATE SET count = count + 1"
    ).bind(day, dim, buckets[dim], articleId)
  );
}

export interface DimensionBucketRow {
  bucket: string;
  count: number;
}

export interface DimensionDistribution {
  /** 合并前的样本总数 */
  total: number;
  insufficient: boolean;
  buckets: DimensionBucketRow[];
}

/**
 * §7.5 小样本保护：桶 < 5 合并进 `other`（恒排最后）；总样本 < 20 时
 * 不返回任何桶，避免用少量样本推算百分比。
 */
export function protectSmallSamples(
  rows: readonly DimensionBucketRow[]
): DimensionDistribution {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total < MIN_SAMPLE_SIZE) {
    return { total, insufficient: true, buckets: [] };
  }

  const kept: DimensionBucketRow[] = [];
  let other = 0;
  for (const row of rows) {
    if (row.count < SMALL_BUCKET_THRESHOLD || row.bucket === OTHER_BUCKET) {
      other += row.count;
    } else {
      kept.push({ bucket: row.bucket, count: row.count });
    }
  }
  kept.sort((a, b) => b.count - a.count || a.bucket.localeCompare(b.bucket));
  if (other > 0) kept.push({ bucket: OTHER_BUCKET, count: other });
  return { total, insufficient: false, buckets: kept };
}
