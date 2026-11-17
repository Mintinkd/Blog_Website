<script setup lang="ts">
import { computed, ref } from "vue";
import { useAdminContext } from "../composables/adminContext";
import { t } from "../../utils/i18n.ts";
import { buildCategoryRequest } from "./categories.logic";
import { buildTagRequest, buildMoveTagRequest } from "./tags.logic";
import { canEditCategory, canManageTag } from "./shared.logic";

const { api, feedback, catalog, session } = useAdminContext();

const categories = catalog.categories;
const tags = catalog.tags;
const userRole = session.role;
const currentUserId = session.userId;
const loadCategories = catalog.loadCategories;
const loadTags = catalog.loadTags;

const showCategoryForm = ref(false);
const categoryForm = ref({ name: "", slug: "", description: "" });
const editingCategoryId = ref<number | null>(null);

/** 展开行的分类 id（taxonomy v2 / #80：分类下直接建 / 移 / 删标签）。 */
const expandedCategoryId = ref<number | null>(null);

/** 各分类名下的标签（来自 catalog.tags，worker 已带 category_id）。 */
const tagsByCategory = computed<Record<number, any[]>>(() => {
  const map: Record<number, any[]> = {};
  for (const tag of tags.value) {
    if (tag.category_id == null) continue;
    (map[tag.category_id] ??= []).push(tag);
  }
  return map;
});

const newTagForm = ref({ name: "", slug: "" });

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
  const count = (tagsByCategory.value[id] || []).length;
  // taxonomy v2（#79 / #80）：有标签的分类删除会被服务端 400 拒绝，提前提示。
  const message =
    count > 0
      ? t("admin.delete_category_with_tags", { count })
      : t("admin.delete_confirm");
  if (!feedback.confirm(message)) return;
  const data = await api("DELETE", `/categories/${id}`);
  if (data.code === 0) {
    await Promise.all([loadCategories(), loadTags()]);
  } else {
    feedback.alert(data.message || t("admin.delete_failed"));
  }
}

async function createTagInCategory(categoryId: number) {
  const name = newTagForm.value.name.trim();
  const slug = newTagForm.value.slug.trim();
  if (!name || !slug) return;
  const { method, path, body } = buildTagRequest({
    name,
    slug,
    category_id: categoryId,
  });
  const data = await api(method, path, body);
  if (data.code === 0) {
    newTagForm.value = { name: "", slug: "" };
    await loadTags();
  } else {
    feedback.alert(data.message || t("admin.save_failed"));
  }
}

/** 行内移动：目标分类 = 当前编辑者可管理（canManageTag）的全部分类。 */
const moveTarget = ref<number | "">("");
const movingTagId = ref<number | null>(null);

const movableCategories = computed(() =>
  categories.value.filter((c: any) => {
    if (movingTagId.value == null) return false;
    const tag = tags.value.find((tg: any) => tg.id === movingTagId.value);
    return canManageTag(
      userRole.value,
      tag?.created_by,
      c.created_by,
      currentUserId.value
    );
  })
);

async function moveTag(tagId: number) {
  if (!moveTarget.value) return;
  const { method, path, body } = buildMoveTagRequest(
    tagId,
    Number(moveTarget.value)
  );
  const data = await api(method, path, body);
  if (data.code === 0) {
    movingTagId.value = null;
    moveTarget.value = "";
    await loadTags();
  } else {
    feedback.alert(data.message || t("admin.save_failed"));
  }
}

async function deleteTagFromCategory(id: number) {
  if (!feedback.confirm(t("admin.delete_confirm"))) return;
  const data = await api("DELETE", `/tags/${id}`);
  if (data.code === 0) await loadTags();
  else feedback.alert(data.message || t("admin.delete_failed"));
}

function toggleExpand(id: number) {
  expandedCategoryId.value = expandedCategoryId.value === id ? null : id;
  movingTagId.value = null;
  moveTarget.value = "";
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
          <th>{{ t("admin.tag_count") }}</th>
          <th>{{ t("admin.actions") }}</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="c in categories" :key="c.id">
          <tr>
            <td :data-label="t('admin.name')">{{ c.name }}</td>
            <td :data-label="t('admin.slug')">{{ c.slug }}</td>
            <td :data-label="t('admin.article_count')">
              {{ c.article_count || 0 }}
            </td>
            <td :data-label="t('admin.tag_count')">
              <button
                type="button"
                class="tag-count-btn"
                @click="toggleExpand(c.id)"
              >
                {{ c.tag_count || 0 }}
                <span aria-hidden="true">{{
                  expandedCategoryId === c.id ? "▾" : "▸"
                }}</span>
                <span class="sr-only">{{ t("admin.expand_tags") }}</span>
              </button>
            </td>
            <td class="actions" :data-label="t('admin.actions')">
              <button
                v-if="canEditCategory(userRole, c.created_by, currentUserId)"
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
          <tr v-if="expandedCategoryId === c.id">
            <td colspan="5" class="tags-expand-cell">
              <div class="tags-expand">
                <div class="tags-expand-chips">
                  <span
                    v-for="tag in tagsByCategory[c.id] || []"
                    :key="tag.id"
                    class="tag-chip-in-cat"
                  >
                    {{ tag.name }}（{{ tag.article_count || 0 }}）
                    <select
                      v-if="movingTagId === tag.id"
                      class="tag-move-select"
                      :aria-label="t('admin.move_tag_to')"
                      @change="
                        moveTarget = Number(
                          ($event.target as HTMLSelectElement).value
                        );
                        moveTag(tag.id);
                      "
                    >
                      <option value="" disabled selected>
                        {{ t("admin.move_tag_placeholder") }}
                      </option>
                      <option
                        v-for="mc in movableCategories"
                        :key="mc.id"
                        :value="String(mc.id)"
                      >
                        {{ mc.name }}
                      </option>
                    </select>
                    <button
                      v-else
                      type="button"
                      class="tag-mini-btn"
                      @click="
                        movingTagId = tag.id;
                        moveTarget = '';
                      "
                    >
                      {{ t("admin.move_tag") }}
                    </button>
                    <button
                      v-if="userRole === 'admin'"
                      type="button"
                      class="tag-mini-btn tag-mini-danger"
                      @click="deleteTagFromCategory(tag.id)"
                    >
                      {{ t("admin.delete") }}
                    </button>
                  </span>
                  <span
                    v-if="(tagsByCategory[c.id] || []).length === 0"
                    class="meta-hint"
                  >
                    {{ t("admin.category_no_tags") }}
                  </span>
                </div>
                <div
                  v-if="canEditCategory(userRole, c.created_by, currentUserId)"
                  class="tags-expand-new"
                >
                  <input
                    v-model="newTagForm.name"
                    :placeholder="t('admin.name')"
                    :aria-label="t('admin.name')"
                  />
                  <input
                    v-model="newTagForm.slug"
                    :placeholder="t('admin.slug')"
                    :aria-label="t('admin.slug')"
                  />
                  <button
                    type="button"
                    class="btn-secondary"
                    @click="createTagInCategory(c.id)"
                  >
                    {{ t("admin.meta_tag_add") }}
                  </button>
                </div>
              </div>
            </td>
          </tr>
        </template>
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

<style scoped>
.tag-count-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  color: inherit;
  font: inherit;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.tags-expand-cell {
  background: var(--admin-bg-subtle, rgba(127, 127, 127, 0.06));
}

.tags-expand {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.tags-expand-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.tag-chip-in-cat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--admin-border, rgba(127, 127, 127, 0.35));
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 0.85em;
}

.tag-mini-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0 2px;
  font-size: 0.85em;
  color: var(--admin-accent, #49b1f5);
}

.tag-mini-danger {
  color: var(--admin-danger, #e5484d);
}

.tag-move-select {
  max-width: 140px;
  font-size: 0.85em;
}

.tags-expand-new {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tags-expand-new input {
  max-width: 160px;
}
</style>
