<script setup lang="ts">
import { onMounted } from "vue";
import { useAdminContext } from "../composables/adminContext";
import { t, getLocale } from "../../utils/i18n.ts";
import { formatDate as formatDatePure } from "./shared.logic";

const { api, feedback, catalog, session, locale } = useAdminContext();

const comments = catalog.comments;
const commentFilter = catalog.commentFilter;
const loadComments = catalog.loadComments;

function formatDate(d: string) {
  return formatDatePure(d, getLocale() === "zh" ? "zh" : "en");
}

onMounted(() => {
  catalog.loadComments();
});

async function approveComment(id: number) {
  const data = await api("PUT", `/comments/${id}/approve`);
  if (data.code === 0) await loadComments();
  else feedback.alert(data.message || t("admin.save_failed"));
}

async function rejectComment(id: number) {
  const data = await api("PUT", `/comments/${id}/reject`);
  if (data.code === 0) await loadComments();
  else feedback.alert(data.message || t("admin.save_failed"));
}

async function deleteComment(id: number) {
  if (!feedback.confirm(t("admin.delete_confirm"))) return;
  const data = await api("DELETE", `/comments/${id}`);
  if (data.code === 0) await loadComments();
  else feedback.alert(data.message || t("admin.delete_failed"));
}
</script>

<template>
  <div class="admin-panel">
    <div class="panel-header">
      <h2>{{ t("admin.comments") }}</h2>
      <div style="display: flex; gap: 0.5rem">
        <button
          :class="['btn-secondary', { active: commentFilter === '' }]"
          style="font-size: 0.8rem; padding: 0.3rem 0.6rem"
          @click="
            commentFilter = '';
            loadComments();
          "
        >
          {{ t("admin.all") }}
        </button>
        <button
          :class="['btn-secondary', { active: commentFilter === 'pending' }]"
          style="font-size: 0.8rem; padding: 0.3rem 0.6rem"
          @click="
            commentFilter = 'pending';
            loadComments();
          "
        >
          {{ t("admin.pending") }}
        </button>
        <button
          :class="['btn-secondary', { active: commentFilter === 'approved' }]"
          style="font-size: 0.8rem; padding: 0.3rem 0.6rem"
          @click="
            commentFilter = 'approved';
            loadComments();
          "
        >
          {{ t("admin.approved") }}
        </button>
      </div>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>{{ t("admin.nickname") }}</th>
          <th>{{ t("admin.content") }}</th>
          <th>{{ t("admin.articles") }}</th>
          <th>{{ t("admin.status") }}</th>
          <th>{{ t("admin.created_at") }}</th>
          <th>{{ t("admin.actions") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in comments" :key="c.id">
          <td :data-label="t('admin.nickname')">{{ c.nickname }}</td>
          <td class="cell-clip" :data-label="t('admin.content')">
            {{ c.content }}
          </td>
          <td :data-label="t('admin.articles')">
            <a
              :href="`/articles/${c.article_slug || ''}`"
              target="_blank"
              style="font-size: 0.8rem"
              >{{ c.article_title }}</a
            >
          </td>
          <td :data-label="t('admin.status')">
            <span :class="['status-badge', c.status]">{{
              c.status === "pending"
                ? t("admin.pending")
                : c.status === "approved"
                  ? t("admin.approved")
                  : t("admin.rejected")
            }}</span>
          </td>
          <td :data-label="t('admin.created_at')">
            {{ formatDate(c.created_at) }}
          </td>
          <td class="actions" :data-label="t('admin.actions')">
            <button
              v-if="c.status === 'pending'"
              @click="approveComment(c.id)"
              style="color: var(--color-success)"
            >
              {{ t("admin.approve") }}
            </button>
            <button
              v-if="c.status === 'pending'"
              @click="rejectComment(c.id)"
              style="color: var(--color-warning)"
            >
              {{ t("admin.reject") }}
            </button>
            <button @click="deleteComment(c.id)" class="btn-danger">
              {{ t("admin.delete") }}
            </button>
          </td>
        </tr>
        <tr v-if="comments.length === 0">
          <td colspan="6" class="empty">{{ t("admin.no_comments") }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
