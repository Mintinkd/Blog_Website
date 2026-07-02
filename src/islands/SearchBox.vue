<template>
  <div class="search-box">
    <div class="search-input-wrapper">
      <input
        v-model="query"
        type="text"
        placeholder="搜索文章..."
        class="search-input"
        @keyup.enter="doSearch"
      />
      <button class="search-btn" @click="doSearch" :disabled="loading">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
      </button>
    </div>

    <div v-if="results.length > 0" class="search-results">
      <p class="results-info">找到 {{ total }} 篇相关文章</p>
      <div v-for="item in results" :key="item.id" class="search-result-item">
        <h3 class="result-title">
          <a :href="`/articles/${item.slug}`" v-html="item.title_highlight || item.title"></a>
        </h3>
        <p class="result-excerpt" v-html="item.content_highlight || item.summary"></p>
        <span class="result-date">{{ formatDate(item.published_at || item.created_at) }}</span>
      </div>
    </div>

    <div v-else-if="searched && !loading" class="no-results">
      <p>未找到相关文章，试试其他关键词？</p>
    </div>

    <div v-if="loading" class="search-loading">
      <p>搜索中...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const query = ref('');
const results = ref<any[]>([]);
const total = ref(0);
const loading = ref(false);
const searched = ref(false);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function doSearch() {
  const q = query.value.trim();
  if (!q || q.length > 100) return;

  loading.value = true;
  searched.value = true;

  try {
    const response = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}&page_size=20`);
    const data = await response.json();

    if (data.code === 0 && data.data) {
      results.value = data.data.items || [];
      total.value = data.data.total || 0;
    }
  } catch (e) {
    console.error('Search failed:', e);
  } finally {
    loading.value = false;
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('zh-CN');
}
</script>

<style scoped>
.search-box {
  max-width: 600px;
  margin: 0 auto;
}

.search-input-wrapper {
  display: flex;
  gap: 0.5rem;
}

.search-input {
  flex: 1;
  padding: 0.75rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: 1rem;
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  outline: none;
  transition: border-color 0.2s;
}

.search-input:focus {
  border-color: var(--color-accent);
}

.search-btn {
  padding: 0.75rem 1rem;
  background-color: var(--color-accent);
  color: #fff;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
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

.result-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 0.3rem;
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

.result-date {
  color: var(--color-text-tertiary);
  font-size: 0.8rem;
}

.no-results, .search-loading {
  text-align: center;
  padding: 2rem;
  color: var(--color-text-secondary);
}
</style>