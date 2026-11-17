<template>
  <div class="search-box">
    <div class="search-input-wrapper">
      <input
        v-model="query"
        type="text"
        :placeholder="t('search.placeholder')"
        class="search-input"
        @keyup.enter="doSearch"
      />
      <button class="search-btn" @click="doSearch" :disabled="loading">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
      </button>
    </div>

    <div v-if="activeFilter" class="active-filter">
      <span class="active-filter-label">
        {{ filterLabelText }}
      </span>
      <button
        class="active-filter-clear"
        @click="clearFilter"
        :aria-label="t('taxonomy.clear_filter')"
      >
        &times;
      </button>
    </div>

    <div v-if="results.length > 0" class="search-results">
      <p class="results-info">
        <template v-if="activeFilter">{{
          t("search.results_filtered", { count: total })
        }}</template>
        <template v-else>{{
          t("search.results_found", { count: total })
        }}</template>
      </p>
      <TransitionGroup name="result" tag="div" class="search-results-list">
        <div v-for="item in results" :key="item.id" class="search-result-item">
          <h3 class="result-title">
            <a
              :href="`/articles/${safePathSegment(item.slug)}`"
              v-html="sanitizeHighlight(item.title_highlight || item.title)"
            ></a>
          </h3>
          <p
            class="result-excerpt"
            v-html="sanitizeHighlight(item.content_highlight || item.summary)"
          ></p>
          <!-- taxonomy v2（#81 §6）：关键词结果带分类 badge（链接分类页）与日期 -->
          <div class="result-meta">
            <a
              v-if="item.category"
              class="result-category"
              :href="`/categories/${safePathSegment(item.category.slug)}`"
              >{{ item.category.name }}</a
            >
            <span class="result-date">{{
              formatDate(item.published_at || item.created_at)
            }}</span>
          </div>
        </div>
      </TransitionGroup>
    </div>

    <div v-else-if="searched && !loading" class="no-results">
      <p v-if="activeFilter">{{ t("search.no_results_filtered") }}</p>
      <p v-else>{{ t("search.no_results") }}</p>
    </div>

    <div v-if="loading" class="search-loading">
      <p>{{ t("search.searching") }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { t } from "../utils/i18n";
import { sanitizeHighlight, safePathSegment } from "../utils/escape";

const query = ref("");
const results = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const searched = ref(false);
const activeFilter = ref<{
  type: "tag" | "category";
  slug: string;
  name: string;
  /** taxonomy v2（#81 §6）：标签的所属分类名（可选，仅 tag 类型且有分组信息时）。 */
  categoryName?: string | null;
} | null>(null);

// locale-changed 触发重算，保证筛选条 / 空态文案随语言切换刷新
const localeTick = ref(0);
function onLocaleChanged() {
  localeTick.value += 1;
}

const filterLabelText = computed(() => {
  void localeTick.value;
  const f = activeFilter.value;
  if (!f) return "";
  const prefix = f.type === "tag" ? t("page.tags") : t("page.categories");
  let label = `${prefix}：<strong>${f.name}</strong>`;
  if (f.type === "tag" && f.categoryName) {
    label += `（${t("page.categories")}：${f.categoryName}）`;
  }
  return label;
});

async function doSearch() {
  const q = query.value.trim();
  if (!q || q.length > 100) return;

  // 关键词搜索时清除标签/分类筛选
  activeFilter.value = null;
  loading.value = true;
  searched.value = true;

  try {
    const response = await fetch(
      `/api/v1/search?q=${encodeURIComponent(q)}&page_size=20`
    );
    const data = await response.json();

    if (data.code === 0 && data.data) {
      results.value = data.data.items || [];
      total.value = data.data.total || 0;
    }
  } catch (e) {
    console.error("Search failed:", e);
  } finally {
    loading.value = false;
  }
}

async function filterByTaxonomy(
  type: "tag" | "category",
  slug: string,
  name: string,
  categoryName?: string | null
) {
  if (!slug) return;

  activeFilter.value = { type, slug, name, categoryName: categoryName ?? null };
  query.value = "";
  loading.value = true;
  searched.value = true;
  results.value = [];

  try {
    const param =
      type === "tag"
        ? `tag_slug=${encodeURIComponent(slug)}`
        : `category_slug=${encodeURIComponent(slug)}`;
    const response = await fetch(
      `/api/v1/articles?page=1&page_size=20&status=published&${param}`
    );
    const data = await response.json();

    if (data.code === 0 && data.data) {
      results.value = data.data.items || [];
      total.value = data.data.total || 0;
    }
  } catch (e) {
    console.error("Filter failed:", e);
  } finally {
    loading.value = false;
  }
}

function clearFilter() {
  activeFilter.value = null;
  results.value = [];
  total.value = 0;
  searched.value = false;
}

function handleTaxonomyFilter(e: Event) {
  const detail = (e as CustomEvent).detail;
  if (!detail) return;
  filterByTaxonomy(detail.type, detail.slug, detail.name, detail.categoryName);
}

onMounted(() => {
  window.addEventListener("taxonomy-filter", handleTaxonomyFilter);
  window.addEventListener("locale-changed", onLocaleChanged);
});

onUnmounted(() => {
  window.removeEventListener("taxonomy-filter", handleTaxonomyFilter);
  window.removeEventListener("locale-changed", onLocaleChanged);
});

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("zh-CN");
}
</script>

<style scoped>
.search-box {
  width: 100%;
  max-width: 600px;
  margin: 0 auto;
}

.search-input-wrapper {
  display: flex;
  gap: 0.5rem;
  min-width: 0;
}

.search-input {
  flex: 1;
  /* 输入框默认 min-width:auto（约 20 字符）会撑住 flex 行，窄屏时把按钮挤出面板 */
  min-width: 0;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 1rem;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  outline: none;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.search-input:focus {
  border-color: var(--color-accent);
  box-shadow: var(--motion-glow-accent);
}

.search-btn {
  flex: none;
  min-width: 48px;
  min-height: 44px;
  padding: 0.75rem 1rem;
  background-color: var(--color-accent);
  color: #fff;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s;
}

.search-btn:hover:not(:disabled) {
  background-color: var(--color-accent-hover);
}

.search-btn:disabled {
  opacity: 0.6;
}

.active-filter {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1.5rem;
  padding: 0.5rem 0.9rem;
  background: var(--color-accent-subtle);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  width: fit-content;
  max-width: 100%;
  min-width: 0;
}

.active-filter-label {
  min-width: 0;
  font-size: 0.85rem;
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.active-filter-label strong {
  color: var(--color-accent);
}

.active-filter-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: var(--color-text-tertiary);
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
  transition: all 0.2s;
}

.active-filter-clear:hover {
  background: var(--color-accent);
  color: #fff;
}

.search-results {
  margin-top: 1.5rem;
}

.results-info {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  margin-bottom: 1rem;
}

.search-result-item {
  padding: 1rem 0;
  border-bottom: 1px solid var(--color-border-light);
}

.search-result-item:last-child {
  border-bottom: none;
}

/* 搜索结果逐条入场（TransitionGroup） */
.search-results-list {
  display: block;
}
.result-enter-active,
.result-leave-active {
  transition:
    opacity var(--motion-duration-base) var(--motion-ease-standard),
    transform var(--motion-duration-base) var(--motion-ease-standard);
}
.result-enter-from,
.result-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.result-title {
  font-size: clamp(1rem, 1.6vw, 1.1rem);
  font-weight: 600;
  margin-bottom: 0.3rem;
  overflow-wrap: anywhere;
}

.result-title a {
  color: var(--color-text-primary);
}

.result-title a:hover {
  color: var(--color-accent);
}

.result-excerpt {
  color: var(--color-text-secondary);
  font-size: 0.9rem;
  margin-bottom: 0.3rem;
  line-height: 1.5;
}

.result-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.result-category {
  padding: 0.1rem 0.5rem;
  background: var(--color-accent-subtle);
  color: var(--color-accent);
  border-radius: var(--radius-sm);
  font-size: 0.72rem;
  text-decoration: none;
  overflow-wrap: anywhere;
}

.result-category:hover {
  filter: brightness(0.92);
}

.result-date {
  color: var(--color-text-tertiary);
  font-size: 0.8rem;
}

.no-results,
.search-loading {
  text-align: center;
  padding: clamp(1.25rem, 4vw, 2rem);
  color: var(--color-text-secondary);
}
</style>
