<script setup lang="ts">
/**
 * 本地草稿恢复提示条（T5 #66 / docs/ARTICLE_EDITOR_UPGRADE.md §5.5）。
 *
 * 只做展示与两个动作：恢复 / 丢弃；不自动应用草稿、不改服务端内容。
 * 过期草稿已被 storage 层惰性清除，这里只提示并允许关闭。
 */
import { computed } from "vue";
import { getLocale, t } from "../../utils/i18n.ts";
import type { DraftPrompt } from "./useLocalDraft";

const props = defineProps<{
  prompt: DraftPrompt | null;
}>();

defineEmits<{
  (e: "restore"): void;
  (e: "discard"): void;
}>();

const found = computed(() => props.prompt?.status === "found");

const message = computed(() => {
  if (props.prompt?.status !== "found") return t("editor.draft_expired");
  const time = new Date(props.prompt.savedAt).toLocaleString(
    getLocale() === "zh" ? "zh-CN" : "en-US"
  );
  return t("editor.draft_found", { time });
});
</script>

<template>
  <div
    v-if="props.prompt"
    class="editor-draft-bar"
    role="status"
    aria-live="polite"
  >
    <span class="editor-draft-message">{{ message }}</span>
    <div class="editor-draft-actions">
      <button
        v-if="found"
        type="button"
        class="btn-primary"
        @click="$emit('restore')"
      >
        {{ t("editor.draft_restore") }}
      </button>
      <button type="button" class="btn-secondary" @click="$emit('discard')">
        {{ found ? t("editor.draft_discard") : t("editor.draft_dismiss") }}
      </button>
    </div>
  </div>
</template>
