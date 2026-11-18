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

    <div v-if="results.length > 0" class="search-results">
      <p class="results-info">
        {{ t("search.results_found", { count: total }) }}
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
      <p>{{ t("search.no_results") }}</p>
    </div>

    <div v-if="loading" class="search-loading">
      <p>{{ t("search.searching") }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { t } from "../utils/i18n";
import { sanitizeHighlight, safePathSegment } from "../utils/escape";

const query = ref("");
const results = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const searched = ref(false);

async function doSearch() {
  const q = query.value.trim();
  if (!q || q.length > 100) return;

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
