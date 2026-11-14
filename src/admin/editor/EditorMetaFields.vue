<script setup lang="ts">
/**
 * 文章编辑器元信息面板（T3 #64）：标题 / slug / 分类 / 状态 / 标签 / 摘要 / 封面。
 *
 * 本票只做组件拆分，不新增「根据标题生成 slug」按钮、字数统计或元信息抽屉
 * （属 T6 #67）。字段与 emptyArticleForm() 一一对应，保持保存请求体不变。
 */
import { ref } from "vue";
import { t } from "../../utils/i18n.ts";
import type { EditorFormSnapshot } from "../../utils/editor/editorState";

const props = defineProps<{
  form: EditorFormSnapshot;
  categories: { id: number; name: string }[];
  tags: { id: number; name: string }[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:form", form: EditorFormSnapshot): void;
  (e: "add-tag", name: string): void;
}>();

const newTagInput = ref("");

function patch(partial: Partial<EditorFormSnapshot>): void {
  emit("update:form", { ...props.form, ...partial });
}

function toggleTag(name: string): void {
  const tags = [...props.form.tags];
  const index = tags.indexOf(name);
  if (index >= 0) tags.splice(index, 1);
  else tags.push(name);
  patch({ tags });
}

function addNewTag(): void {
  const name = newTagInput.value.trim();
  if (!name) return;
  if (!props.form.tags.includes(name)) emit("add-tag", name);
  newTagInput.value = "";
}
</script>

<template>
  <div class="editor-meta-fields">
    <div class="form-group">
      <label>{{ t("admin.title") }}</label>
      <input
        :value="props.form.title"
        :disabled="props.disabled"
        @input="patch({ title: ($event.target as HTMLInputElement).value })"
      />
    </div>
    <div class="form-group">
      <label>{{ t("admin.slug") }}</label>
      <input
        :value="props.form.slug"
        :disabled="props.disabled"
        @input="patch({ slug: ($event.target as HTMLInputElement).value })"
      />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>{{ t("admin.category") }}</label>
        <select
          :value="props.form.category_id"
          :disabled="props.disabled"
          @change="
            patch({
              category_id: ($event.target as HTMLSelectElement).value,
            })
          "
        >
          <option value="">{{ t("admin.no_category") }}</option>
          <option v-for="c in props.categories" :key="c.id" :value="c.id">
            {{ c.name }}
          </option>
        </select>
      </div>
      <div class="form-group">
        <label>{{ t("admin.status") }}</label>
        <select
          :value="props.form.status"
          :disabled="props.disabled"
          @change="
            patch({ status: ($event.target as HTMLSelectElement).value })
          "
        >
          <option value="draft">{{ t("article.draft") }}</option>
          <option value="published">{{ t("article.published") }}</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label>{{ t("admin.tags_label") }}</label>
      <div class="tag-selector">
        <div class="tag-chips">
          <button
            v-for="tag in props.tags"
            :key="tag.id"
            type="button"
            :class="[
              'tag-chip',
              { active: props.form.tags.includes(tag.name) },
            ]"
            :disabled="props.disabled"
            @click="toggleTag(tag.name)"
          >
            {{ tag.name }}
          </button>
        </div>
        <div class="tag-input-row">
          <input
            v-model="newTagInput"
            :disabled="props.disabled"
            :placeholder="t('admin.add_tag_placeholder')"
            @keydown.enter.prevent="addNewTag"
          />
        </div>
      </div>
    </div>
    <div class="form-group">
      <label>{{ t("admin.summary") }}</label>
      <textarea
        :value="props.form.summary"
        rows="2"
        :disabled="props.disabled"
        @input="
          patch({ summary: ($event.target as HTMLTextAreaElement).value })
        "
      ></textarea>
    </div>
    <div class="form-group">
      <label>{{ t("admin.cover") }}</label>
      <input
        :value="props.form.cover_image"
        :placeholder="t('admin.cover_placeholder')"
        :disabled="props.disabled"
        @input="
          patch({ cover_image: ($event.target as HTMLInputElement).value })
        "
      />
    </div>
  </div>
</template>
