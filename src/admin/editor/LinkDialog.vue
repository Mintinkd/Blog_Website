<script setup lang="ts">
/**
 * 插入链接弹窗（T3 #64）：普通 Markdown 链接 / 内嵌网页预览两种模式。
 *
 * 构造片段统一走 T1 的 editorCommands.ts：buildLinkSnippet 内部复用
 * src/utils/escape.ts 的 escapeAttr / escapeHtml（内嵌预览的 HTML 上下文）与
 * mdEscapeText / mdEscapeUrl（Markdown 语法上下文）。App.vue 里的四份重复
 * 转义函数因此被删除，不再有第二实现。
 *
 * `.link-mode-*` 结构与类名保持不变：scripts/verify-visual-friendliness.mjs
 * 的 13 条观感规则（CI 门禁）直接量这些元素。
 */
import { reactive, watch } from "vue";
import { t } from "../../utils/i18n.ts";
import {
  buildLinkSnippet,
  isAllowedLinkUrl,
  type LinkMode,
} from "../../utils/editor/editorCommands";

const props = defineProps<{
  visible: boolean;
  selected: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "insert", snippet: string): void;
}>();

const linkDialog = reactive({
  url: "",
  text: "",
  mode: "link" as LinkMode,
  error: "",
});

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return;
    // 选中文字直接带入链接文字；选中内容本身是 URL 则带入地址。
    const isUrl = isAllowedLinkUrl(props.selected);
    linkDialog.url = isUrl ? props.selected : "";
    linkDialog.text = isUrl ? "" : props.selected;
    linkDialog.mode = "link";
    linkDialog.error = "";
  },
  { immediate: true }
);

function confirmInsertLink(): void {
  const url = linkDialog.url.trim();
  if (!isAllowedLinkUrl(url)) {
    linkDialog.error = t("admin.link_invalid_url");
    return;
  }
  const label = linkDialog.text.trim() || url.replace(/^https?:\/\//i, "");
  emit("insert", buildLinkSnippet(url, label, linkDialog.mode));
  emit("close");
}
</script>

<template>
  <!-- z-index 高于文章编辑器全屏遮罩（300），否则弹窗被压在编辑器下面不可见。 -->
  <Teleport to="body">
    <div
      v-if="props.visible"
      class="modal-overlay link-dialog-overlay"
      @click.self="emit('close')"
    >
      <div class="modal link-dialog">
        <h3>{{ t("admin.insert_link") }}</h3>
        <div class="form-group">
          <label>{{ t("admin.link_url") }}</label>
          <input
            v-model="linkDialog.url"
            :placeholder="t('admin.link_url_placeholder')"
            @keydown.enter.prevent="confirmInsertLink"
          />
        </div>
        <div class="form-group">
          <label>{{ t("admin.link_text") }}</label>
          <input
            v-model="linkDialog.text"
            :placeholder="t('admin.link_text_placeholder')"
            @keydown.enter.prevent="confirmInsertLink"
          />
        </div>
        <div class="form-group">
          <label>{{ t("admin.link_mode") }}</label>
          <div
            class="link-mode-options"
            role="radiogroup"
            :aria-label="t('admin.link_mode')"
          >
            <label
              :class="[
                'link-mode-option',
                { active: linkDialog.mode === 'link' },
              ]"
            >
              <input
                class="link-mode-input"
                type="radio"
                name="link-preview-mode"
                value="link"
                v-model="linkDialog.mode"
              />
              <span class="link-mode-icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
                  />
                  <path
                    d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
                  />
                </svg>
              </span>
              <span class="link-mode-copy">
                <span class="link-mode-name">{{
                  t("admin.link_mode_plain")
                }}</span>
                <span class="link-mode-desc">{{
                  t("admin.link_mode_plain_desc")
                }}</span>
              </span>
              <span class="link-mode-indicator" aria-hidden="true"></span>
            </label>
            <label
              :class="[
                'link-mode-option',
                { active: linkDialog.mode === 'embed' },
              ]"
            >
              <input
                class="link-mode-input"
                type="radio"
                name="link-preview-mode"
                value="embed"
                v-model="linkDialog.mode"
              />
              <span class="link-mode-icon" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
                  <path d="M2.5 9h19" />
                  <rect x="6" y="12" width="12" height="5" rx="1" />
                </svg>
              </span>
              <span class="link-mode-copy">
                <span class="link-mode-name">{{
                  t("admin.link_mode_embed")
                }}</span>
                <span class="link-mode-desc">{{
                  t("admin.link_mode_embed_desc")
                }}</span>
              </span>
              <span class="link-mode-indicator" aria-hidden="true"></span>
            </label>
          </div>
        </div>
        <p v-if="linkDialog.error" class="link-dialog-error">
          {{ linkDialog.error }}
        </p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="emit('close')">
            {{ t("admin.cancel") }}
          </button>
          <button class="btn-primary" @click="confirmInsertLink">
            {{ t("admin.link_insert") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
