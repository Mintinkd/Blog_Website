<script setup lang="ts">
/**
 * 文章编辑器元信息面板（T6 #67）。
 *
 * 契约：
 * - 表单值只有一份事实源：props.form。本组件只 emit 补丁，slug 的「锁定」
 *   是纯 UI 状态，不复制 slug 值，避免草稿恢复 / 外部改写时两处漂移。
 * - slug 生成 / 锁定决策、发布前校验、封面 URL 白名单、标签筛选、字数与
 *   阅读时长全部走 src/utils/editor/metaFields.ts 的纯函数，不在组件里
 *   第二实现服务端口径；slug 冲突由服务端原样返回，这里不改写不加后缀。
 * - 移动端折叠为抽屉由 ArticleEditorOverlay 负责，本组件只负责字段本身。
 */
import { computed, ref, watch } from "vue";
import { t } from "../../utils/i18n.ts";
import type { EditorFormSnapshot } from "../../utils/editor/editorState";
import type { DraftArticleId } from "../../utils/editor/draftStore";
import {
  checkPublishReady,
  filterTags,
  readingStats,
  reduceSlugLock,
  safeCoverUrl,
  splitTagsByCategory,
  TITLE_MAX_LENGTH,
  type EditorTagOption,
} from "../../utils/editor/metaFields";

const props = defineProps<{
  form: EditorFormSnapshot;
  categories: { id: number; name: string }[];
  /** taxonomy v2（#80）：标签带归属分类（兼容两种携带形态：category_name 扁平字段
   * 或 worker GET /tags 的 category 概要对象；都可缺省）。 */
  tags: {
    id: number;
    name: string;
    category_id?: number | null;
    category_name?: string | null;
    category?: { id: number; name: string; slug: string } | null;
  }[];
  /** 切文章时用来重建 slug 锁定态（新建 / 编辑已有文章规则不同）。 */
  articleId: DraftArticleId | null;
  disabled?: boolean;
  /** 保存入口拦截发布前校验失败时的提示，由宿主统一设置。 */
  publishError?: string | null;
}>();

const emit = defineEmits<{
  (e: "update:form", form: EditorFormSnapshot): void;
  (e: "add-tag", name: string): void;
}>();

const newTagInput = ref("");
const tagQuery = ref("");
const coverFailed = ref(false);
const slugLocked = ref(false);

/** 打开 / 切换文章时：已有 slug 默认锁定，新建留空不锁（留给服务端生成）。 */
watch(
  () => props.articleId,
  () => {
    slugLocked.value = reduceSlugLock(
      { slug: "", locked: false },
      { type: "reset", slug: props.form.slug }
    ).locked;
  },
  { immediate: true }
);

const coverUrl = computed(() => safeCoverUrl(props.form.cover_image));
watch(coverUrl, () => {
  coverFailed.value = false;
});

const coverState = computed<"none" | "invalid" | "failed" | "ok">(() => {
  if (!props.form.cover_image.trim()) return "none";
  if (!coverUrl.value) return "invalid";
  return coverFailed.value ? "failed" : "ok";
});

const stats = computed(() => readingStats(props.form.content));
const publishCheck = computed(() => checkPublishReady(props.form));
const titleCount = computed(() => Array.from(props.form.title).length);
const summaryCount = computed(() => Array.from(props.form.summary).length);

/**
 * taxonomy v2（#80）：标签 chip 按当前分类感知。
 * - 未选分类：全部标签按本分类渲染（无跨分类标记）；
 * - 已选分类：本分类标签正常渲染；已选中的跨分类标签始终可见并带标记；
 * - 本地新建、尚未入库的标签视作本分类（extras）。
 */
const currentCategoryId = computed(() =>
  props.form.category_id ? Number(props.form.category_id) : null
);
const split = computed(() =>
  splitTagsByCategory(props.tags as EditorTagOption[], currentCategoryId.value)
);

/** 已选中但被筛掉的标签始终可见（含本地新建、尚未入库的标签）。 */
const visibleTagNames = computed(() => {
  const candidates = split.value.current.map((tag) => tag.name);
  const extras = props.form.tags.filter(
    (name) => !props.tags.some((tag) => tag.name === name)
  );
  const matched = filterTags([...extras, ...candidates], tagQuery.value);
  return matched.filter((name, index, all) => all.indexOf(name) === index);
});

/** 已选中的跨分类标签（始终可见 + 标记；随筛选 query 一起过滤）。 */
const crossCategoryTags = computed(() => {
  const selected = new Set(props.form.tags);
  return split.value.cross
    .filter((tag) => selected.has(tag.name))
    .filter((tag) => filterTags([tag.name], tagQuery.value).length > 0)
    .map((tag) => {
      const raw = tag as EditorTagOption & {
        category_name?: string | null;
        category?: { name: string } | null;
      };
      return {
        name: tag.name,
        categoryName: raw.category_name ?? raw.category?.name ?? null,
      };
    });
});

/** 未选分类时不能新建标签（#80）：新建入口禁用并提示。 */
const canCreateTag = computed(
  () => !props.disabled && !!props.form.category_id
);

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
  if (!canCreateTag.value) return;
  const name = newTagInput.value.trim();
  if (!name) return;
  if (!props.form.tags.includes(name)) emit("add-tag", name);
  newTagInput.value = "";
}

function generateSlugFromTitle(): void {
  const next = reduceSlugLock(
    { slug: props.form.slug, locked: slugLocked.value },
    { type: "generate", title: props.form.title }
  );
  slugLocked.value = next.locked;
  patch({ slug: next.slug });
}

function toggleSlugLock(): void {
  const next = reduceSlugLock(
    { slug: props.form.slug, locked: slugLocked.value },
    { type: slugLocked.value ? "unlock" : "lock" }
  );
  slugLocked.value = next.locked;
}

/** 锁定态即使被绕过 DOM disabled 也不会写入（纯函数兜底）。 */
function onSlugInput(value: string): void {
  const next = reduceSlugLock(
    { slug: props.form.slug, locked: slugLocked.value },
    { type: "edit", value }
  );
  patch({ slug: next.slug });
}
</script>

<template>
  <div class="editor-meta-fields">
    <div class="form-group">
      <label for="meta-title">{{ t("admin.title") }}</label>
      <input
        id="meta-title"
        :value="props.form.title"
        :maxlength="TITLE_MAX_LENGTH"
        aria-required="true"
        :disabled="props.disabled"
        :aria-describedby="'meta-title-count'"
        @input="patch({ title: ($event.target as HTMLInputElement).value })"
      />
      <p id="meta-title-count" class="meta-hint">
        {{ t("admin.meta_title_count", { count: titleCount }) }}
      </p>
    </div>

    <div class="form-group">
      <label for="meta-slug">{{ t("admin.slug") }}</label>
      <div class="meta-inline-row">
        <input
          id="meta-slug"
          :value="props.form.slug"
          :disabled="props.disabled || slugLocked"
          :aria-describedby="'meta-slug-hint'"
          @input="onSlugInput(($event.target as HTMLInputElement).value)"
        />
        <button
          type="button"
          class="btn-secondary meta-action-btn meta-slug-generate"
          :disabled="props.disabled"
          @click="generateSlugFromTitle"
        >
          {{ t("admin.meta_slug_generate") }}
        </button>
        <button
          type="button"
          class="btn-secondary meta-action-btn meta-lock-btn"
          :aria-pressed="slugLocked"
          :aria-label="
            slugLocked ? t('admin.meta_slug_unlock') : t('admin.meta_slug_lock')
          "
          :disabled="props.disabled"
          @click="toggleSlugLock"
        >
          {{
            slugLocked ? t("admin.meta_slug_unlock") : t("admin.meta_slug_lock")
          }}
        </button>
      </div>
      <p id="meta-slug-hint" class="meta-hint">
        {{
          slugLocked ? t("admin.meta_slug_locked") : t("admin.meta_slug_hint")
        }}
      </p>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label for="meta-category">{{ t("admin.category") }}</label>
        <select
          id="meta-category"
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
        <label for="meta-status">{{ t("admin.status") }}</label>
        <select
          id="meta-status"
          :value="props.form.status"
          :disabled="props.disabled"
          :aria-describedby="'meta-status-hint'"
          @change="
            patch({ status: ($event.target as HTMLSelectElement).value })
          "
        >
          <option value="draft">{{ t("article.draft") }}</option>
          <option value="published">{{ t("article.published") }}</option>
        </select>
      </div>
    </div>
    <p id="meta-status-hint" class="meta-hint">
      {{ t("admin.meta_status_hint") }}
    </p>

    <div class="form-group">
      <label for="meta-tag-filter">{{ t("admin.tags_label") }}</label>
      <div class="tag-selector">
        <div class="tag-chips">
          <button
            v-for="name in visibleTagNames"
            :key="name"
            type="button"
            :class="['tag-chip', { active: props.form.tags.includes(name) }]"
            :aria-pressed="props.form.tags.includes(name)"
            :disabled="props.disabled"
            @click="toggleTag(name)"
          >
            {{ name }}
          </button>
          <button
            v-for="cross in crossCategoryTags"
            :key="`cross-${cross.name}`"
            type="button"
            class="tag-chip tag-chip-cross active"
            :aria-pressed="true"
            :title="
              t('admin.cross_category_hint', {
                category: cross.categoryName ?? t('admin.uncategorized'),
              })
            "
            :disabled="props.disabled"
            @click="toggleTag(cross.name)"
          >
            {{ cross.name }}
          </button>
          <span
            v-if="
              visibleTagNames.length === 0 && crossCategoryTags.length === 0
            "
            class="meta-hint"
          >
            {{ t("admin.meta_tag_empty") }}
          </span>
        </div>
        <p v-if="!props.form.category_id" class="meta-hint">
          {{ t("admin.new_tag_needs_category") }}
        </p>
        <div class="tag-input-row">
          <input
            id="meta-tag-filter"
            v-model="tagQuery"
            type="search"
            :disabled="props.disabled"
            :placeholder="t('admin.meta_tag_filter')"
          />
          <input
            v-model="newTagInput"
            class="meta-new-tag-input"
            :disabled="!canCreateTag"
            :aria-label="t('admin.add_tag_placeholder')"
            :placeholder="t('admin.add_tag_placeholder')"
            @keydown.enter.prevent="addNewTag"
          />
          <button
            type="button"
            class="btn-secondary meta-action-btn"
            :disabled="!canCreateTag"
            @click="addNewTag"
          >
            {{ t("admin.meta_tag_add") }}
          </button>
        </div>
      </div>
    </div>

    <div class="form-group">
      <label for="meta-summary">{{ t("admin.summary") }}</label>
      <textarea
        id="meta-summary"
        :value="props.form.summary"
        rows="2"
        :disabled="props.disabled"
        :aria-describedby="'meta-summary-count'"
        @input="
          patch({ summary: ($event.target as HTMLTextAreaElement).value })
        "
      ></textarea>
      <p id="meta-summary-count" class="meta-hint">
        {{ t("admin.meta_summary_count", { count: summaryCount }) }}
      </p>
    </div>

    <div class="form-group">
      <label for="meta-cover">{{ t("admin.cover") }}</label>
      <input
        id="meta-cover"
        :value="props.form.cover_image"
        :placeholder="t('admin.cover_placeholder')"
        :disabled="props.disabled"
        :aria-describedby="'meta-cover-state'"
        @input="
          patch({ cover_image: ($event.target as HTMLInputElement).value })
        "
      />
      <div class="meta-cover-preview">
        <img
          v-if="coverState === 'ok'"
          :src="coverUrl!"
          :alt="t('admin.meta_cover_preview_alt')"
          loading="lazy"
          @error="coverFailed = true"
        />
        <span
          v-else-if="coverState === 'invalid'"
          class="meta-cover-placeholder"
        >
          {{ t("admin.meta_cover_invalid") }}
        </span>
        <span
          v-else-if="coverState === 'failed'"
          class="meta-cover-placeholder"
        >
          {{ t("admin.meta_cover_failed") }}
        </span>
        <span v-else class="meta-cover-placeholder">
          {{ t("admin.cover_placeholder") }}
        </span>
      </div>
      <p id="meta-cover-state" class="meta-live-region" aria-live="polite">
        {{ coverState }}
      </p>
    </div>

    <p class="meta-stats">
      {{
        t("admin.meta_stats", {
          words: stats.words,
          minutes: stats.minutes,
        })
      }}
    </p>

    <p
      v-if="props.publishError || !publishCheck.ok"
      class="meta-publish-error"
      role="status"
    >
      {{ props.publishError || t("admin.meta_status_hint") }}
    </p>
  </div>
</template>
