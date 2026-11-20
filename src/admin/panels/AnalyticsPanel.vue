<template>
  <!-- 阅读统计（issue #58）：Tier 0 概览 / 趋势 / 文章表 / 分布 / 质量 -->
  <div class="admin-panel analytics-panel">
    <div class="panel-header analytics-header">
      <h2>{{ t("analytics.title") }}</h2>
      <div class="analytics-filters">
        <label>
          {{ t("analytics.range") }}
          <select v-model="analyticsRange" @change="loadAnalytics()">
            <option value="today">
              {{ t("analytics.range_today") }}
            </option>
            <option value="7d">{{ t("analytics.range_7d") }}</option>
            <option value="30d">{{ t("analytics.range_30d") }}</option>
            <option value="90d">{{ t("analytics.range_90d") }}</option>
          </select>
        </label>
        <label>
          {{ t("analytics.article_filter") }}
          <input
            v-model="analyticsArticleQuery"
            list="analytics-article-options"
            :placeholder="t('analytics.article_all')"
            @change="applyAnalyticsArticleFilter"
          />
          <datalist id="analytics-article-options">
            <option
              v-for="option in analyticsArticleOptions"
              :key="option.id"
              :value="option.title"
            ></option>
          </datalist>
        </label>
        <span
          v-if="analyticsArticleQuery.trim() && !analyticsArticleId"
          class="analytics-article-not-found"
        >
          {{ t("analytics.article_not_found") }}
        </span>
        <span class="analytics-updated">{{
          t("analytics.updated_at", { time: analyticsUpdatedAt })
        }}</span>
      </div>
    </div>

    <div v-if="analyticsLoading" class="loading">
      {{ t("analytics.loading") }}
    </div>
    <div v-else-if="analyticsError" class="error-msg">
      {{ t("analytics.error") }}
      <small v-if="analyticsErrorDetail" class="analytics-error-detail">
        {{ analyticsErrorDetail }}
      </small>
      <button class="btn-secondary" @click="loadAnalytics()">
        {{ t("analytics.retry") }}
      </button>
    </div>
    <div v-else class="analytics-body">
      <!-- §7.2：Tier 0 仅 3 张卡；Tier 1 卡片完全不渲染 -->
      <div class="analytics-cards">
        <div
          v-for="card in analyticsCards"
          :key="card.key"
          class="analytics-card"
        >
          <span class="analytics-card-label">{{ card.label }}</span>
          <strong class="analytics-card-value">{{ card.value }}</strong>
        </div>
      </div>

      <!-- §7.3：PV / UV 双线，手写 SVG -->
      <section class="analytics-section">
        <h3>{{ t("analytics.trend_title") }}</h3>
        <div v-if="!analyticsTrendReady" class="empty">
          {{ t("analytics.trend_pending") }}
        </div>
        <template v-else>
          <svg
            class="analytics-trend"
            viewBox="0 0 600 160"
            preserveAspectRatio="none"
          >
            <path
              :d="analyticsTrendPaths.pvPath"
              fill="none"
              stroke="#d64545"
              stroke-width="2"
            />
            <path
              :d="analyticsTrendPaths.uvPath"
              fill="none"
              stroke="#3b7ddd"
              stroke-width="2"
            />
            <circle
              v-for="point in analyticsTrendPaths.points"
              :key="point.day"
              :cx="point.x"
              :cy="point.yPv"
              r="3"
              fill="#d64545"
            >
              <title>
                {{ point.day }} · {{ t("analytics.trend_pv") }} {{ point.pv }} ·
                {{ t("analytics.trend_uv") }} {{ point.uv }} ·
                {{ t("analytics.trend_bot", { count: point.bot_filtered }) }}
              </title>
            </circle>
          </svg>
          <div class="analytics-legend">
            <span
              ><i class="analytics-dot analytics-dot-pv"></i
              >{{ t("analytics.trend_pv") }}</span
            >
            <span
              ><i class="analytics-dot analytics-dot-uv"></i
              >{{ t("analytics.trend_uv") }}</span
            >
          </div>
        </template>
      </section>

      <!-- §7.4：文章表；Tier 1 两列完全不渲染 -->
      <section class="analytics-section">
        <h3>
          {{ t("analytics.articles_title") }}
          <small v-if="analyticsArticlesData?.since"
            >{{
              t("analytics.table_since", {
                day: analyticsArticlesData.since,
              })
            }}
          </small>
        </h3>
        <table class="analytics-table">
          <thead>
            <tr>
              <th>{{ t("analytics.table_title") }}</th>
              <th>{{ t("analytics.table_pv") }}</th>
              <th>{{ t("analytics.table_uv") }}</th>
              <th>{{ t("analytics.table_referrer") }}</th>
              <th>{{ t("analytics.table_sparkline") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in analyticsArticlesData?.items || []" :key="row.id">
              <td>
                <a
                  :href="'/articles/' + encodeURIComponent(row.slug)"
                  target="_blank"
                  rel="noopener"
                  >{{ row.title }}</a
                >
              </td>
              <td>{{ row.pv }}</td>
              <td>{{ row.uv }}</td>
              <td>
                {{ row.top_referrer ?? t("analytics.no_data") }}
              </td>
              <td>
                <svg
                  v-if="row.sparkline?.filter((v) => v > 0).length >= 2"
                  class="analytics-spark"
                  viewBox="0 0 80 24"
                  preserveAspectRatio="none"
                >
                  <path
                    :d="buildSparklinePath(row.sparkline)"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                  />
                </svg>
                <span v-else>{{ t("analytics.no_data") }}</span>
              </td>
            </tr>
            <tr v-if="!analyticsArticlesData?.items?.length">
              <td colspan="5" class="empty">
                {{ t("analytics.table_empty") }}
              </td>
            </tr>
          </tbody>
        </table>
        <div class="analytics-pager">
          <button
            class="btn-secondary"
            :disabled="analyticsPage <= 1"
            @click="
              analyticsPage--;
              loadAnalytics();
            "
          >
            {{ t("analytics.prev") }}
          </button>
          <span>{{
            t("analytics.table_page", {
              page: analyticsPage,
              pages: analyticsArticlesData?.total_pages || 1,
            })
          }}</span>
          <button
            class="btn-secondary"
            :disabled="
              analyticsPage >= (analyticsArticlesData?.total_pages || 1)
            "
            @click="
              analyticsPage++;
              loadAnalytics();
            "
          >
            {{ t("analytics.next") }}
          </button>
        </div>
      </section>

      <!-- §7.5：设备 / 地区条形图 + 来源表；Tier 1 图完全不渲染 -->
      <section class="analytics-section">
        <h3>{{ t("analytics.dim_title") }}</h3>
        <div class="analytics-dims">
          <div
            v-for="dim in analyticsDimensionViews"
            :key="dim.key"
            class="analytics-dim"
          >
            <h4>{{ dim.label }}</h4>
            <div v-if="dim.view.insufficient" class="empty">
              {{ t("analytics.dim_insufficient") }}
            </div>
            <div v-else-if="dim.view.rows.length === 0" class="empty">
              {{ t("analytics.no_data") }}
            </div>
            <div v-else-if="dim.key !== 'referrer'" class="analytics-bars">
              <div
                v-for="row in dim.view.rows"
                :key="row.label"
                class="analytics-bar-row"
              >
                <span class="analytics-bar-label">{{ row.label }}</span>
                <div class="analytics-bar-track">
                  <div
                    class="analytics-bar-fill"
                    :style="{ width: row.percent }"
                  ></div>
                </div>
                <span>{{ row.count }} · {{ row.percent }}</span>
              </div>
            </div>
            <table v-else class="analytics-table">
              <thead>
                <tr>
                  <th>{{ t("analytics.dim_bucket") }}</th>
                  <th>{{ t("analytics.dim_count") }}</th>
                  <th>{{ t("analytics.dim_percent") }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in dim.view.rows" :key="row.label">
                  <td>{{ row.label }}</td>
                  <td>{{ row.count }}</td>
                  <td>{{ row.percent }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- §7.6：数据质量（全站口径，不随文章筛选变化） -->
      <section class="analytics-section">
        <h3>
          {{ t("analytics.quality_title") }}
          <small class="analytics-quality-scope">{{
            t("analytics.quality_scope")
          }}</small>
        </h3>
        <div class="analytics-quality">
          <div
            v-for="row in analyticsQualityRows"
            :key="row.key"
            :class="[
              'analytics-quality-row',
              { alert: row.alert, critical: row.critical },
            ]"
          >
            <span>{{ row.label }}</span>
            <strong>{{ row.value }}</strong>
            <span v-if="row.alert" class="analytics-alert-tag">{{
              t("analytics.quality_alert")
            }}</span>
          </div>
        </div>
        <!-- §4.1：规则改动时同步的解释文案，说明免费版守卫分支 -->
        <p class="analytics-bot-hint">{{ t("analytics.bot_hint") }}</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useAdminContext } from "../composables/adminContext";
import { t, getLocale } from "../../utils/i18n.ts";
import {
  analyticsRequestPaths,
  analyticsStamp,
  articleFilterId,
  collectAnalyticsFailures,
} from "./analytics.logic";
import {
  TIER0_CARDS,
  TIER0_DIMENSIONS,
  buildSparklinePath,
  buildTrendPaths,
  dimensionRows,
  formatAnalyticsFailures,
  formatMetric,
  formatRatio,
  hasAnalyticsData,
  hasEnoughTrendDays,
  type AnalyticsFailure,
  type DimensionData,
  type TrendDay,
} from "../../utils/analyticsView.ts";

const { api, session, locale } = useAdminContext();

const userRole = session.role;

/* ── 阅读统计面板（issue #58 / docs/READER_ANALYTICS.md §7） ─────────────── */
const analyticsRange = ref("7d");
const analyticsArticleQuery = ref("");
const analyticsArticleId = ref("");
const analyticsPage = ref(1);
const analyticsLoading = ref(false);
const analyticsError = ref(false);
/** 失败接口 / code / 服务端消息，错误态里一并展示（2026-11-11 可诊断性加固） */
const analyticsErrorDetail = ref("");
const analyticsUpdatedAt = ref("—");
const analyticsOverview = ref<any>(null);
const analyticsTrend = ref<TrendDay[]>([]);
const analyticsArticlesData = ref<any>(null);
const analyticsQuality = ref<any>(null);
const analyticsDimensions = ref<Record<string, DimensionData | null>>({
  device: null,
  country: null,
  referrer: null,
});
const analyticsArticleOptions = ref<Array<{ id: number; title: string }>>([]);

const analyticsCards = computed(() => {
  // t() 读模块级 locale，显式依赖以便切语言时 computed 重新求值（不重挂载、不丢状态）
  void locale.value;
  const overview = analyticsOverview.value;
  const empty = !hasAnalyticsData(overview);
  const values: Record<string, string> = {
    pv: empty ? formatMetric(null) : formatMetric(overview?.pv ?? null),
    uv: empty ? formatMetric(null) : formatMetric(overview?.uv ?? null),
    bot_filtered: formatMetric(overview?.bot_filtered ?? 0),
  };
  const labels: Record<string, string> = {
    pv: t("analytics.pv"),
    uv: t("analytics.uv"),
    bot_filtered: t("analytics.bot_filtered"),
  };
  // Tier 1 卡片不在清单里，关闭时完全不渲染
  return TIER0_CARDS.map((key) => ({
    key,
    label: labels[key],
    value: values[key],
  }));
});

const analyticsTrendPaths = computed(() =>
  buildTrendPaths(analyticsTrend.value, 600, 160)
);
const analyticsTrendReady = computed(() =>
  hasEnoughTrendDays(analyticsTrend.value)
);

const analyticsDimensionViews = computed(() => {
  void locale.value;
  return TIER0_DIMENSIONS.map((dim) => ({
    key: dim,
    label: t(`analytics.dim_${dim}`),
    view: dimensionRows(
      analyticsDimensions.value[dim] ?? null,
      t,
      dim,
      locale.value
    ),
  }));
});

const analyticsQualityRows = computed(() => {
  void locale.value;
  const quality = analyticsQuality.value;
  return [
    {
      key: "bot_ratio",
      label: t("analytics.quality_bot_ratio"),
      value: formatRatio(quality?.bot_ratio ?? null),
      alert: !!quality?.bot_ratio_alert,
    },
    {
      key: "coverage",
      label: t("analytics.quality_coverage"),
      value: formatRatio(quality?.proxy_coverage ?? null),
      alert: !!quality?.proxy_coverage_alert,
    },
    {
      key: "heartbeat",
      label: t("analytics.quality_heartbeat"),
      value: quality?.heartbeat_at ?? t("analytics.quality_heartbeat_missing"),
      alert: !!quality?.heartbeat_alert,
      // §7.6：心跳超 26h 标红，其余告警标黄
      critical: !!quality?.heartbeat_alert,
    },
    {
      key: "anomaly",
      label: t("analytics.quality_anomaly"),
      value: quality?.anomaly
        ? t("analytics.quality_anomaly_hint")
        : t("analytics.quality_ok"),
      alert: !!quality?.anomaly,
    },
    {
      key: "tokens",
      label: t("analytics.quality_tokens"),
      value: formatMetric(quality?.token_rows ?? 0),
      alert: !!quality?.token_rows_alert,
    },
  ];
});

async function loadAnalytics() {
  if (userRole.value !== "admin") return;
  analyticsLoading.value = true;
  analyticsError.value = false;
  analyticsErrorDetail.value = "";
  const range = analyticsRange.value;
  const paths = analyticsRequestPaths(
    range,
    analyticsPage.value,
    analyticsArticleId.value
  );
  try {
    const [
      overview,
      trend,
      articles,
      quality,
      device,
      country,
      referrer,
      list,
    ] = await Promise.all(paths.map((path) => api("GET", path)));
    const checks = [
      { name: "overview", res: overview },
      { name: "trend", res: trend },
      { name: "articles", res: articles },
      { name: "quality", res: quality },
      { name: "device", res: device },
      { name: "country", res: country },
      { name: "referrer", res: referrer },
      { name: "articles_list", res: list },
    ];
    const failures: AnalyticsFailure[] = collectAnalyticsFailures(checks);
    if (failures.length > 0) {
      analyticsError.value = true;
      analyticsErrorDetail.value = formatAnalyticsFailures(failures);
      return;
    }
    analyticsOverview.value = overview.data;
    analyticsTrend.value = trend.data?.days ?? [];
    analyticsArticlesData.value = articles.data;
    analyticsQuality.value = quality.data;
    analyticsDimensions.value = {
      device: device.data,
      country: country.data,
      referrer: referrer.data,
    };
    if (list?.code === 0 && Array.isArray(list.data?.items)) {
      analyticsArticleOptions.value = list.data.items.map((item: any) => ({
        id: item.id,
        title: item.title,
      }));
    }
    // §7.1「数据时间」优先用清理任务心跳；无心跳时回落到本次取数时刻
    analyticsUpdatedAt.value = analyticsStamp(
      quality.data?.heartbeat_at,
      new Date(),
      getLocale()
    );
  } catch (error) {
    analyticsError.value = true;
    // 只展示错误类型，不把任意异常文本写进 DOM
    analyticsErrorDetail.value = formatAnalyticsFailures([
      { name: "request", code: error instanceof Error ? error.name : "Error" },
    ]);
  } finally {
    analyticsLoading.value = false;
  }
}

function applyAnalyticsArticleFilter() {
  analyticsArticleId.value = articleFilterId(
    analyticsArticleQuery.value,
    analyticsArticleOptions.value
  );
  analyticsPage.value = 1;
  loadAnalytics();
}

// 壳层 v-if 切 tab 会销毁 / 重建本面板，等价于拆分前 watch(currentTab) 的加载时机
onMounted(() => {
  analyticsPage.value = 1;
  void loadAnalytics();
});
</script>
