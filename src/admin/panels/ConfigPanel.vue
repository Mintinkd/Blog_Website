<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAdminContext } from "../composables/adminContext";
import { t } from "../../utils/i18n.ts";
import { toConfigPayload } from "../../utils/config-payload";
import { normalizeConfigForm } from "./config.logic";

const { api } = useAdminContext();

const configForm = ref({
  site_title: "",
  site_subtitle: "",
  site_description: "",
  posts_per_page: 10,
});
const configLoading = ref(false);
const configMsg = ref("");

async function loadConfig() {
  configLoading.value = true;
  try {
    const data = await api("GET", "/config/all");
    if (data.code === 0 && data.data) {
      configForm.value = normalizeConfigForm(data.data);
    }
  } finally {
    configLoading.value = false;
  }
}
onMounted(loadConfig);

async function saveConfig() {
  configMsg.value = "";
  const data = await api("PUT", "/config", toConfigPayload(configForm.value));
  if (data.code === 0) configMsg.value = t("admin.save_success");
  else configMsg.value = data.message || t("admin.save_failed");
}
</script>

<template>
  <div class="admin-panel">
    <div class="panel-header">
      <h2>{{ t("admin.site_config") }}</h2>
    </div>
    <div v-if="configLoading" class="loading">
      {{ t("common.loading") }}
    </div>
    <div v-else class="config-form">
      <div class="form-group">
        <label>{{ t("admin.site_title") }}</label
        ><input v-model="configForm.site_title" />
      </div>
      <div class="form-group">
        <label>{{ t("admin.site_subtitle") }}</label
        ><input v-model="configForm.site_subtitle" />
      </div>
      <div class="form-group">
        <label>{{ t("admin.site_description") }}</label
        ><textarea v-model="configForm.site_description" rows="2"></textarea>
      </div>

      <div class="form-group">
        <label>{{ t("admin.posts_per_page") }}</label
        ><input
          v-model.number="configForm.posts_per_page"
          type="number"
          min="1"
          max="50"
        />
      </div>
      <button class="btn-primary" @click="saveConfig">
        {{ t("admin.save") }}
      </button>
      <p v-if="configMsg" class="msg">{{ configMsg }}</p>
    </div>
  </div>
</template>
