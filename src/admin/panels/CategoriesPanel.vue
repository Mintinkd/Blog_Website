<script setup lang="ts">
import { ref } from "vue";
import { useAdminContext } from "../composables/adminContext";
import { t } from "../../utils/i18n.ts";
import { buildCategoryRequest } from "./categories.logic";

const { api, feedback, catalog, session, locale } = useAdminContext();

const categories = catalog.categories;
const userRole = session.role;
const currentUserId = session.userId;
const loadCategories = catalog.loadCategories;

const showCategoryForm = ref(false);
const categoryForm = ref({ name: "", slug: "", description: "" });
const editingCategoryId = ref<number | null>(null);

async function saveCategory() {
  let data;
  const { method, path, body } = buildCategoryRequest(
    categoryForm.value,
    editingCategoryId.value
  );
  data = await api(method, path, body);
  if (data.code === 0) {
    showCategoryForm.value = false;
    editingCategoryId.value = null;
    await loadCategories();
  } else {
    feedback.alert(data.message || t("admin.save_failed"));
  }
}

async function deleteCategory(id: number) {
  if (!feedback.confirm(t("admin.delete_confirm"))) return;
  const data = await api("DELETE", `/categories/${id}`);
  if (data.code === 0) await loadCategories();
  else feedback.alert(data.message || t("admin.delete_failed"));
}
</script>

<template>
  <div class="admin-panel">
    <div class="panel-header">
      <h2>{{ t("admin.categories") }}</h2>
      <button
        class="btn-primary"
        @click="
          editingCategoryId = null;
          showCategoryForm = true;
          categoryForm = { name: '', slug: '', description: '' };
        "
      >
        {{ t("admin.new_category") }}
      </button>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>{{ t("admin.name") }}</th>
          <th>{{ t("admin.slug") }}</th>
          <th>{{ t("admin.article_count") }}</th>
          <th>{{ t("admin.actions") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in categories" :key="c.id">
          <td :data-label="t('admin.name')">{{ c.name }}</td>
          <td :data-label="t('admin.slug')">{{ c.slug }}</td>
          <td :data-label="t('admin.article_count')">
            {{ c.article_count || 0 }}
          </td>
          <td class="actions" :data-label="t('admin.actions')">
            <button
              v-if="
                userRole === 'admin' ||
                !c.created_by ||
                c.created_by === currentUserId
              "
              @click="
                categoryForm = {
                  name: c.name,
                  slug: c.slug,
                  description: c.description || '',
                };
                editingCategoryId = c.id;
                showCategoryForm = true;
              "
            >
              {{ t("admin.edit") }}
            </button>
            <button
              v-if="userRole === 'admin'"
              @click="deleteCategory(c.id)"
              class="btn-danger"
            >
              {{ t("admin.delete") }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <div
      v-if="showCategoryForm"
      class="modal-overlay"
      @click.self="showCategoryForm = false"
    >
      <div class="modal">
        <h3>
          {{
            editingCategoryId
              ? t("admin.edit") + t("admin.categories")
              : t("admin.new_category")
          }}
        </h3>
        <div class="form-group">
          <label>{{ t("admin.name") }}</label
          ><input v-model="categoryForm.name" />
        </div>
        <div class="form-group">
          <label>{{ t("admin.slug") }}</label
          ><input v-model="categoryForm.slug" />
        </div>
        <div class="form-group">
          <label>{{ t("admin.description") }}</label
          ><textarea v-model="categoryForm.description" rows="3"></textarea>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showCategoryForm = false">
            {{ t("admin.cancel") }}
          </button>
          <button class="btn-primary" @click="saveCategory">
            {{ t("admin.save") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
