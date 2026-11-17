<script setup lang="ts">
import { computed, ref } from "vue";
import { useAdminContext } from "../composables/adminContext";
import { t } from "../../utils/i18n.ts";
import { buildTagRequest, buildMoveTagRequest } from "./tags.logic";
import { canManageTag } from "./shared.logic";

const { api, feedback, catalog, session } = useAdminContext();

const tags = catalog.tags;
const categories = catalog.categories;
const userRole = session.role;
const currentUserId = session.userId;
const loadTags = catalog.loadTags;

const showTagForm = ref(false);
const tagForm = ref<{ name: string; slug: string; category_id: number | "" }>({
  name: "",
  slug: "",
  category_id: "",
});
const categoryFilter = ref("");

/** taxonomy v2（#80）：客户端按归属分类筛选（空 = 全部）。 */
const filteredTags = computed(() => {
  if (!categoryFilter.value) return tags.value;
  return tags.value.filter(
    (tag) => String(tag.category_id) === String(categoryFilter.value)
  );
});

/** 新建表单可见的分类：admin 全部；editor 仅自己拥有的分类（服务端同口径强制）。 */
const creatableCategories = computed(() =>
  categories.value.filter((c: any) =>
    canManageTag(userRole.value, null, c.created_by, currentUserId.value)
  )
);

/** 列表里「移动」按钮的可见性：精确的目标校验在弹窗选项与服务端两侧做
 * （GET /tags 的 category 概要不含 created_by，列表层只做粗筛）。 */
const ownsAnyCategory = computed(() =>
  categories.value.some((c: any) => c.created_by === currentUserId.value)
);
const canShowMoveButton = computed(
  () =>
    userRole.value === "admin" ||
    ownsAnyCategory.value ||
    tags.value.some((tag: any) => tag.created_by === currentUserId.value)
);

async function saveTag() {
  const category_id = tagForm.value.category_id
    ? Number(tagForm.value.category_id)
    : undefined;
  const { method, path, body } = buildTagRequest({
    name: tagForm.value.name,
    slug: tagForm.value.slug,
    category_id,
  });
  const data = await api(method, path, body);
  if (data.code === 0) {
    showTagForm.value = false;
    await loadTags();
  } else {
    feedback.alert(data.message || t("admin.save_failed"));
  }
}

/** 移动归属弹窗：可选目标 = admin 全部 / editor 按 canManageTag 过滤。 */
const movingTag = ref<any | null>(null);
const moveTarget = ref<number | "">("");

const movableCategories = computed(() => {
  if (!movingTag.value) return [];
  return categories.value.filter((c: any) =>
    canManageTag(
      userRole.value,
      movingTag.value.created_by,
      c.created_by,
      currentUserId.value
    )
  );
});

function openMoveModal(tag: any) {
  movingTag.value = tag;
  moveTarget.value = tag.category_id ?? "";
}

async function submitMove() {
  if (!movingTag.value || !moveTarget.value) return;
  const { method, path, body } = buildMoveTagRequest(
    movingTag.value.id,
    Number(moveTarget.value)
  );
  const data = await api(method, path, body);
  if (data.code === 0) {
    movingTag.value = null;
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
          tagForm = { name: '', slug: '', category_id: '' };
        "
      >
        {{ t("admin.new_tag") }}
      </button>
    </div>
    <div class="form-group">
      <label for="tags-category-filter">{{ t("admin.tag_category") }}</label>
      <select id="tags-category-filter" v-model="categoryFilter">
        <option value="">{{ t("admin.all_categories") }}</option>
        <option v-for="c in categories" :key="c.id" :value="String(c.id)">
          {{ c.name }}
        </option>
      </select>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>{{ t("admin.name") }}</th>
          <th>{{ t("admin.slug") }}</th>
          <th>{{ t("admin.tag_category") }}</th>
          <th>{{ t("admin.article_count") }}</th>
          <th>{{ t("admin.actions") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="tag in filteredTags" :key="tag.id">
          <td :data-label="t('admin.name')">{{ tag.name }}</td>
          <td :data-label="t('admin.slug')">{{ tag.slug }}</td>
          <td :data-label="t('admin.tag_category')">
            {{ tag.category?.name || t("admin.uncategorized") }}
          </td>
          <td :data-label="t('admin.article_count')">
            {{ tag.article_count || 0 }}
          </td>
          <td class="actions" :data-label="t('admin.actions')">
            <button v-if="canShowMoveButton" @click="openMoveModal(tag)">
              {{ t("admin.move_tag") }}
            </button>
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
        <div class="form-group">
          <label for="new-tag-category">{{ t("admin.tag_category") }}</label>
          <select id="new-tag-category" v-model="tagForm.category_id">
            <option value="">{{ t("admin.uncategorized") }}</option>
            <option
              v-for="c in creatableCategories"
              :key="c.id"
              :value="String(c.id)"
            >
              {{ c.name }}
            </option>
          </select>
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
    <div v-if="movingTag" class="modal-overlay" @click.self="movingTag = null">
      <div class="modal">
        <h3>{{ t("admin.move_tag_to") }} — {{ movingTag.name }}</h3>
        <div class="form-group">
          <label for="move-tag-category">{{ t("admin.tag_category") }}</label>
          <select id="move-tag-category" v-model="moveTarget">
            <option value="" disabled>
              {{ t("admin.move_tag_placeholder") }}
            </option>
            <option
              v-for="c in movableCategories"
              :key="c.id"
              :value="String(c.id)"
            >
              {{ c.name }}
            </option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="movingTag = null">
            {{ t("admin.cancel") }}
          </button>
          <button
            class="btn-primary"
            :disabled="!moveTarget"
            @click="submitMove"
          >
            {{ t("admin.save") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
