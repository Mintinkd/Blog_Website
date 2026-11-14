<script setup lang="ts">
/**
 * 文章列表、筛选、分页与操作列（T3 #64）。
 *
 * 只消费宿主传入的数据并抛事件，不自己发请求：筛选 / 加载时机仍由 App.vue
 * 的 loadArticles() 决定，保持行为等价。分页沿用现有 `page_size=100` 单次取全量，
 * 本票不新增分页 UI（母票要求「除已列修复外行为等价」）。
 * 样式沿用 src/admin/admin-shared.css 的既有类名，CI 的后台移动端 / 观感门禁
 * 依赖 `.admin-panel` / `.data-table` / `data-label` / `.btn-primary`。
 */
import { t, getLocale } from "../../utils/i18n.ts";

export interface ArticleRow {
  id: number;
  title: string;
  slug: string;
  status: string;
  author_name?: string;
  category?: { id: number; name: string } | null;
  view_count?: number;
  created_at?: string;
}

const props = defineProps<{
  articles: ArticleRow[];
  loading: boolean;
  authorFilter: string;
  users: { id: number; username: string; display_name?: string }[];
  userRole: string;
}>();

const emit = defineEmits<{
  (e: "new"): void;
  (e: "edit", article: ArticleRow): void;
  (e: "delete", id: number): void;
  (e: "update:authorFilter", value: string): void;
  (e: "filter-change"): void;
}>();

function formatDate(d?: string): string {
  if (!d) return "-";
  return new Date(d).toLocaleDateString(
    getLocale() === "zh" ? "zh-CN" : "en-US"
  );
}

function onFilterChange(event: Event): void {
  emit("update:authorFilter", (event.target as HTMLSelectElement).value);
  emit("filter-change");
}
</script>

<template>
  <div class="admin-panel">
    <div class="panel-header">
      <h2>{{ t("admin.articles") }}</h2>
      <div style="display: flex; gap: 0.5rem; align-items: center">
        <select
          v-if="props.userRole === 'admin'"
          :value="props.authorFilter"
          style="padding: 0.4rem 0.6rem; font-size: 0.85rem"
          @change="onFilterChange"
        >
          <option value="">{{ t("admin.all_authors") }}</option>
          <option v-for="u in props.users" :key="u.id" :value="u.id">
            {{ u.display_name || u.username }}
          </option>
        </select>
        <button class="btn-primary" @click="emit('new')">
          {{ t("admin.new_article") }}
        </button>
      </div>
    </div>
    <div v-if="props.loading" class="loading">
      {{ t("common.loading") }}
    </div>
    <table v-else class="data-table">
      <thead>
        <tr>
          <th>{{ t("admin.title") }}</th>
          <th>{{ t("admin.author") }}</th>
          <th>{{ t("admin.status") }}</th>
          <th>{{ t("admin.category") }}</th>
          <th>{{ t("article.views") }}</th>
          <th>{{ t("admin.created_at") }}</th>
          <th>{{ t("admin.actions") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="a in props.articles" :key="a.id">
          <td :data-label="t('admin.title')">
            <a :href="`/articles/${a.slug}`" target="_blank">{{ a.title }}</a>
          </td>
          <td :data-label="t('admin.author')">{{ a.author_name || "-" }}</td>
          <td :data-label="t('admin.status')">
            <span :class="['status-badge', a.status]">{{
              a.status === "published"
                ? t("article.published")
                : t("article.draft")
            }}</span>
          </td>
          <td :data-label="t('admin.category')">
            {{ a.category?.name || "-" }}
          </td>
          <td :data-label="t('article.views')">{{ a.view_count ?? 0 }}</td>
          <td :data-label="t('admin.created_at')">
            {{ formatDate(a.created_at) }}
          </td>
          <td class="actions" :data-label="t('admin.actions')">
            <button @click="emit('edit', a)">{{ t("admin.edit") }}</button>
            <button class="btn-danger" @click="emit('delete', a.id)">
              {{ t("admin.delete") }}
            </button>
          </td>
        </tr>
        <tr v-if="props.articles.length === 0">
          <td colspan="7" class="empty">
            {{ t("article.no_articles") }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
