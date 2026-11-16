<script setup lang="ts">
import { onMounted } from "vue";
import { useAdminContext } from "../composables/adminContext";
import { t } from "../../utils/i18n.ts";
import { resolveMediaUrl } from "./media.logic";

const { api, feedback, catalog, session } = useAdminContext();

const token = session.token;
const mediaList = catalog.mediaList;
const mediaLoading = catalog.mediaLoading;
const loadMedia = catalog.loadMedia;

onMounted(() => {
  catalog.loadMedia();
});

async function uploadMedia(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch(`${api.apiBase}/media/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.value}` },
      body: formData,
    });
    const data = await res.json();
    if (data.code === 0) await loadMedia();
    else feedback.alert(data.message || t("admin.upload_failed"));
  } catch {
    feedback.alert(t("admin.upload_failed"));
  }
  input.value = "";
}

async function deleteMedia(id: number) {
  if (!feedback.confirm(t("admin.delete_confirm"))) return;
  const data = await api("DELETE", `/media/${id}`);
  if (data.code === 0) await loadMedia();
  else feedback.alert(data.message || t("admin.delete_failed"));
}

function copyMediaUrl(url: string) {
  const fullUrl = resolveMediaUrl(url, window.location.origin);
  navigator.clipboard.writeText(fullUrl);
  feedback.alert(t("admin.copied"));
}
</script>

<template>
  <div class="admin-panel">
    <div class="panel-header">
      <h2>{{ t("admin.media") }}</h2>
      <label class="btn-primary" style="cursor: pointer">
        {{ t("admin.upload") }}
        <input
          type="file"
          accept="image/*"
          @change="uploadMedia"
          style="display: none"
        />
      </label>
    </div>
    <div v-if="mediaLoading" class="loading">
      {{ t("common.loading") }}
    </div>
    <div v-else class="media-grid">
      <div v-for="m in mediaList" :key="m.id" class="media-item">
        <img :src="m.url" :alt="m.original_name" class="media-thumb" />
        <div class="media-info">
          <span class="media-name">{{ m.original_name }}</span>
          <div class="media-actions-row">
            <button
              class="btn-secondary"
              style="font-size: 0.7rem; padding: 0.2rem 0.5rem"
              @click="copyMediaUrl(m.url)"
            >
              {{ t("admin.copy_url") }}
            </button>
            <button
              class="btn-danger"
              style="font-size: 0.7rem; padding: 0.2rem 0.5rem"
              @click="deleteMedia(m.id)"
            >
              {{ t("admin.delete") }}
            </button>
          </div>
        </div>
      </div>
    </div>
    <p v-if="mediaList.length === 0 && !mediaLoading" class="empty">
      {{ t("admin.no_media") }}
    </p>
  </div>
</template>
