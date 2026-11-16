<script setup lang="ts">
import { ref } from "vue";
import { useAdminContext } from "../composables/adminContext";
import { t } from "../../utils/i18n.ts";
import { buildTagRequest } from "./tags.logic";

const { api, feedback, catalog, session } = useAdminContext();

const tags = catalog.tags;
const userRole = session.role;
const loadTags = catalog.loadTags;

const showTagForm = ref(false);
const tagForm = ref({ name: "", slug: "" });

async function saveTag() {
  const { method, path, body } = buildTagRequest(tagForm.value);
  const data = await api(method, path, body);
  if (data.code === 0) {
    showTagForm.value = false;
    await loadTags();
  } else {
    feedback.alert(data.message || t("admin.save_failed"));
  }
}

async function deleteTag(id: number) {
  if (!feedback.confirm(t("admin.delete_confirm"))) return;
  const data = await api("DELETE", `/tags/${id}`);
  if (data.code === 0) await loadTags();
  else feedback.alert(data.message || t("admin.delete_failed"));
}
</script>

<template>
  <div class="admin-panel">
    <div class="panel-header">
      <h2>{{ t("admin.tags") }}</h2>
      <button
        class="btn-primary"
        @click="
          showTagForm = true;
          tagForm = { name: '', slug: '' };
        "
      >
        {{ t("admin.new_tag") }}
      </button>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>{{ t("admin.name") }}</th>
          <th>{{ t("admin.slug") }}</th>
          <th>{{ t("admin.actions") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="tag in tags" :key="tag.id">
          <td :data-label="t('admin.name')">{{ tag.name }}</td>
          <td :data-label="t('admin.slug')">{{ tag.slug }}</td>
          <td class="actions" :data-label="t('admin.actions')">
            <button
              v-if="userRole === 'admin'"
              @click="deleteTag(tag.id)"
              class="btn-danger"
            >
              {{ t("admin.delete") }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <div
      v-if="showTagForm"
      class="modal-overlay"
      @click.self="showTagForm = false"
    >
      <div class="modal">
        <h3>{{ t("admin.new_tag") }}</h3>
        <div class="form-group">
          <label>{{ t("admin.name") }}</label
          ><input v-model="tagForm.name" />
        </div>
        <div class="form-group">
          <label>{{ t("admin.slug") }}</label
          ><input v-model="tagForm.slug" />
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showTagForm = false">
            {{ t("admin.cancel") }}
          </button>
          <button class="btn-primary" @click="saveTag">
            {{ t("admin.save") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
