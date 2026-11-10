import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import zh from "../src/i18n/zh.json";
import en from "../src/i18n/en.json";

/**
 * 手写字面量的词条期望清单（独立于被测实现的 ANALYTICS_I18N_KEYS，
 * 见 docs/agents/testing.md:88「期望值须有独立来源」）。
 */
const EXPECTED_KEYS = [
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
import {
  ANALYTICS_I18N_KEYS,
  TIER0_CARDS,
  TIER0_DIMENSIONS,
  TIER1_CARDS,
  TIER1_DIMENSIONS,
  buildSparklinePath,
  buildTrendPaths,
  dimensionRows,
  formatMetric,
  formatRatio,
  hasAnalyticsData,
  hasEnoughTrendDays,
  type TrendDay,
} from "../src/utils/analyticsView";

/**
 * issue #58：后台「统计」面板的可测部分（纯函数 / 契约常量 / i18n 词条）。
 *
 * 接缝：面板的 SVG 路径、空态与小样本展示逻辑收敛在
 * `src/utils/analyticsView.ts`，组件本身由 npm run check 与浏览器回归覆盖。
 * 期望值均为手写字面量，不从被测实现反推。
 */

const day = (
  day: string,
  pv: number,
  uv: number,
  bot_filtered = 0
): TrendDay => ({ day, pv, uv, bot_filtered });

describe("issue #58：空态与比率格式化（验收 1）", () => {
  it("空库：PV / UV 显示 —，过滤 bot 显示 0", () => {
    expect(hasAnalyticsData(null)).toBe(false);
    expect(hasAnalyticsData({ pv: 0, uv: 0, bot_filtered: 0 })).toBe(false);
    expect(hasAnalyticsData({ pv: 0, uv: 0, bot_filtered: 2 })).toBe(true);
    expect(hasAnalyticsData({ pv: 3, uv: 1, bot_filtered: 0 })).toBe(true);
  });

  it("formatMetric：null / undefined 回落到 —，0 是有效值照显", () => {
    expect(formatMetric(null)).toBe("—");
    expect(formatMetric(undefined)).toBe("—");
    expect(formatMetric(0)).toBe("0");
    expect(formatMetric(1234)).toBe("1234");
  });

  it("formatRatio：null 回落到 —，其余按百分比", () => {
    expect(formatRatio(null)).toBe("—");
    expect(formatRatio(undefined)).toBe("—");
    expect(formatRatio(0.846)).toBe("84.6%");
    expect(formatRatio(0.5, 0)).toBe("50%");
  });
});

describe("issue #58：趋势与 sparkline SVG（验收 2）", () => {
  it("少于 2 个有数据的日界显示「数据积累中」", () => {
    expect(hasEnoughTrendDays([])).toBe(false);
    expect(hasEnoughTrendDays([day("2026-11-09", 0, 0, 3)])).toBe(false);
    // 只有 1 个有效日：仍显示「数据积累中」，不画 0 值折线
    expect(
      hasEnoughTrendDays([day("2026-11-08", 0, 0), day("2026-11-09", 5, 2)])
    ).toBe(false);
    expect(
      hasEnoughTrendDays([day("2026-11-08", 3, 1), day("2026-11-09", 5, 2)])
    ).toBe(true);
    expect(
      hasEnoughTrendDays([day("2026-11-08", 0, 0), day("2026-11-09", 0, 0)])
    ).toBe(false);
  });

  it("PV / UV 双线 path 按同一最大值缩放", () => {
    const paths = buildTrendPaths(
      [
        day("2026-11-07", 0, 0),
        day("2026-11-08", 10, 5),
        day("2026-11-09", 20, 10),
      ],
      200,
      100
    );

    expect(paths.pvPath).toBe("M0,100 L100,50 L200,0");
    expect(paths.uvPath).toBe("M0,100 L100,75 L200,50");
    expect(paths.max).toBe(20);
    expect(paths.points).toHaveLength(3);
    expect(paths.points[1]).toMatchObject({
      day: "2026-11-08",
      pv: 10,
      uv: 5,
    });
  });

  it("全 0 序列不除以 0，路径仍是合法 SVG", () => {
    const paths = buildTrendPaths([day("a", 0, 0), day("b", 0, 0)], 100, 50);
    expect(paths.pvPath).toBe("M0,50 L100,50");
    expect(paths.max).toBe(1);
  });

  it("sparkline 路径按最大值缩放，空序列返回空串", () => {
    expect(buildSparklinePath([0, 5, 10], 80, 24)).toBe("M0,24 L40,12 L80,0");
    expect(buildSparklinePath([], 80, 24)).toBe("");
    expect(buildSparklinePath([0, 0], 80, 24)).toBe("M0,24 L80,24");
  });
});

describe("issue #58：小样本保护与 Tier 1 隐藏（验收 3、5）", () => {
  const t = (key: string) => (key === "analytics.other" ? "其他" : key);

  it("insufficient 时不返回任何桶，由前台显示「数据不足」", () => {
    expect(
      dimensionRows({ total: 11, insufficient: true, buckets: [] }, t)
    ).toEqual({ insufficient: true, rows: [] });
  });

  it("other 桶由 t() 映射文案，百分比按 total 计算", () => {
    expect(
      dimensionRows(
        {
          total: 20,
          insufficient: false,
          buckets: [
            { bucket: "desktop", count: 15 },
            { bucket: "other", count: 5 },
          ],
        },
        t
      )
    ).toEqual({
      insufficient: false,
      rows: [
        { label: "desktop", count: 15, percent: "75.0%" },
        { label: "其他", count: 5, percent: "25.0%" },
      ],
    });
  });

  it("Tier 1 卡片 / 维度与 Tier 0 清单完全不相交", () => {
    expect(TIER0_CARDS).toEqual(["pv", "uv", "bot_filtered"]);
    expect(TIER0_DIMENSIONS).toEqual(["device", "country", "referrer"]);
    for (const card of TIER1_CARDS) {
      expect(TIER0_CARDS).not.toContain(card);
    }
    for (const dim of TIER1_DIMENSIONS) {
      expect(TIER0_DIMENSIONS).not.toContain(dim);
    }
  });

  it("§7.5 设备桶名走 t() 中英映射", () => {
    const translate = (key: string) =>
      key === "analytics.device_desktop" ? "桌面" : key;
    const view = dimensionRows(
      {
        total: 20,
        insufficient: false,
        buckets: [{ bucket: "desktop", count: 20 }],
      },
      translate,
      "device",
      "zh"
    );
    expect(view.rows[0].label).toBe("桌面");
  });

  it("§7.5 地区补区域名并 Top 8 截断", () => {
    const codes = ["CN", "US", "JP", "GB", "DE", "FR", "SG", "AU", "BR", "CA"];
    const view = dimensionRows(
      {
        total: 200,
        insufficient: false,
        buckets: codes.map((bucket) => ({ bucket, count: 20 })),
      },
      (key) => key,
      "country",
      "zh"
    );
    expect(view.rows).toHaveLength(8);
    // Intl.DisplayNames 的中文区域名随 ICU 版本略有差异，只钉住「保留两位码」不变量
    expect(view.rows[0].label.startsWith("CN")).toBe(true);
  });
});

describe("issue #58：中英文案同步（验收 4）", () => {
  it("实现清单与手写字面量清单完全一致", () => {
    expect([...ANALYTICS_I18N_KEYS]).toEqual([...EXPECTED_KEYS]);
  });

  it("所有 analytics.* 词条在 zh / en 都存在且非空", () => {
    for (const key of EXPECTED_KEYS) {
      expect(
        String((zh as Record<string, string>)[key] ?? ""),
        `zh ${key}`
      ).not.toBe("");
      expect(
        String((en as Record<string, string>)[key] ?? ""),
        `en ${key}`
      ).not.toBe("");
    }
  });

  it("zh / en 的 analytics.* 键集合双向一致，不残留死词条", () => {
    const keysOf = (messages: Record<string, string>) =>
      Object.keys(messages)
        .filter((key) => key.startsWith("analytics."))
        .sort();
    expect(keysOf(zh as Record<string, string>)).toEqual(
      [...EXPECTED_KEYS].sort()
    );
    expect(keysOf(en as Record<string, string>)).toEqual(
      [...EXPECTED_KEYS].sort()
    );
  });

  it("面板模板里用到的 analytics.* key 全部在词条清单中", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "src", "admin", "App.vue"),
      "utf8"
    );
    const used = Array.from(
      source.matchAll(/t\("(analytics\.[a-z0-9_]+)"\)/g),
      (match) => match[1]
    );
    expect(used.length).toBeGreaterThan(0);
    for (const key of used) {
      expect(ANALYTICS_I18N_KEYS).toContain(key);
    }
  });

  it("setLocale 切换后词条真的换语言，切回可复原", async () => {
    const { setLocale, t } = await import("../src/utils/i18n.ts");
    setLocale("zh");
    const zhLabel = t("analytics.title");
    setLocale("en");
    expect(t("analytics.title")).not.toBe(zhLabel);
    setLocale("zh");
    expect(t("analytics.title")).toBe(zhLabel);
  });
});
