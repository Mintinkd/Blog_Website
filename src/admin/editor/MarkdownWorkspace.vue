<script setup lang="ts">
/**
 * Markdown 工作区（T3 #64）：编辑 / 分屏 / 预览三档 + textarea + 插入链接工具条。
 *
 * 本票仍用 textarea + 预览，不提前引入 WYSIWYG / 线上预览弹窗（T4 #65）。
 * 预览继续复用全站 renderMarkdown（marked + DOMPurify + 共享正文白名单），
 * 与前台同一消毒口径；增强挂载点改为组件内 ref，不再全局 querySelector。
 * 插入链接的构造与转义统一走 T1 的 editorCommands.ts（含 escape.ts 复用）。
 */
import { computed, nextTick, ref, watch } from "vue";
import { t, getLocale } from "../../utils/i18n.ts";
import { renderMarkdown } from "../../utils/markdown";
import { enhanceMediaLinks } from "../../utils/mediaEmbed.ts";

export type WorkspaceMode = "edit" | "split" | "preview";

const props = defineProps<{
  content: string;
  mode: WorkspaceMode;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:content", value: string): void;
  (e: "update:mode", mode: WorkspaceMode): void;
  (e: "open-link", selected: string): void;
}>();

const textarea = ref<HTMLTextAreaElement | null>(null);
const previewPane = ref<HTMLElement | null>(null);

const previewHtml = computed(() => {
  if (!props.content) return "";
  try {
    return renderMarkdown(props.content);
  } catch {
    return "";
  }
});

watch([previewHtml, () => props.mode], () => {
  if (props.mode === "edit" || !previewHtml.value) return;
  void nextTick(() => {
    if (previewPane.value) {
      enhanceMediaLinks(previewPane.value, "a[href]", getLocale());
    }
  });
});

function openLinkDialog(): void {
  const ta = textarea.value;
  const selected = (ta?.value || "")
    .slice(ta?.selectionStart ?? 0, ta?.selectionEnd ?? 0)
    .trim();
  emit("open-link", selected);
}

/** 供壳层在链接弹窗确认后调用：按当前选区插入片段并把光标落到片段末尾。 */
function insertAtCursor(snippet: string): void {
  const content = props.content || "";
  const ta = textarea.value;
  if (!ta) {
    emit("update:content", content + snippet);
    return;
  }
  const start = ta.selectionStart ?? content.length;
  const end = ta.selectionEnd ?? start;
  emit(
    "update:content",
    content.slice(0, start) + snippet + content.slice(end)
  );
  const caret = start + snippet.length;
  void nextTick(() => {
    ta.focus();
    ta.setSelectionRange(caret, caret);
  });
}

defineExpose({ insertAtCursor });
</script>

<template>
  <div class="form-group">
    <div class="content-label-row">
      <label>{{ t("admin.content") }} (Markdown)</label>
      <div class="preview-toggle">
        <button
          :class="['toggle-btn', { active: props.mode === 'edit' }]"
          @click="emit('update:mode', 'edit')"
        >
          {{ t("admin.edit_mode") }}
        </button>
        <button
          :class="['toggle-btn', { active: props.mode === 'split' }]"
          @click="emit('update:mode', 'split')"
        >
          {{ t("admin.split_mode") }}
        </button>
        <button
          :class="['toggle-btn', { active: props.mode === 'preview' }]"
          @click="emit('update:mode', 'preview')"
        >
          {{ t("admin.preview_mode") }}
        </button>
      </div>
    </div>
    <div v-if="props.mode !== 'preview'" class="editor-toolbar">
      <button
        type="button"
        class="toolbar-btn"
        :disabled="props.disabled"
        @click="openLinkDialog"
      >
        {{ t("admin.insert_link") }}
      </button>
      <span class="toolbar-hint">{{ t("admin.link_hint") }}</span>
    </div>
    <div :class="['editor-content-area', props.mode]">
      <textarea
        v-if="props.mode !== 'preview'"
        ref="textarea"
        :value="props.content"
        rows="20"
        class="editor-textarea"
        :disabled="props.disabled"
        @input="
          emit('update:content', ($event.target as HTMLTextAreaElement).value)
        "
      ></textarea>
      <div
        v-if="props.mode !== 'edit'"
        ref="previewPane"
        class="editor-preview prose"
        v-html="previewHtml"
      ></div>
    </div>
  </div>
</template>
