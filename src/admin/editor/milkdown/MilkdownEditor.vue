<script setup lang="ts">
/**
 * WYSIWYG 编辑器的 Vue 壳层（T4 #65）。
 *
 * 本组件由 MarkdownWorkspace 用 defineAsyncComponent + import() 懒加载，
 * 因此 Milkdown / Crepe / crepe-theme.css 全部落在「首次打开编辑器」的增量 chunk，
 * 不进入后台首屏（T4 实测 JS 增量约 182 KiB，#122 布局 CSS 再 +16 KiB，
 * 合计约 198 KiB，预算 350 KiB）。
 *
 * 契约：打开时不回写正文；只有用户在编辑器内实际改字才 emit change。
 * 外部 content 变化（源码模式切回、草稿恢复）走 setMarkdown，同样不 emit change。
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  createMilkdownEditor,
  type MilkdownEditorHandle,
} from "./createEditor";

const props = defineProps<{
  content: string;
  disabled?: boolean;
  getToken?: () => string;
}>();

const emit = defineEmits<{
  (e: "change", value: string): void;
  (e: "upload-error", message: string): void;
  (e: "ready"): void;
}>();

const host = ref<HTMLElement | null>(null);
let handle: MilkdownEditorHandle | null = null;
let lastContent = props.content;

onMounted(async () => {
  if (!host.value) return;
  handle = await createMilkdownEditor(host.value, {
    defaultValue: props.content,
    getToken: props.getToken,
    onChange: (markdown) => {
      lastContent = markdown;
      emit("change", markdown);
    },
    onUploadError: (message) => emit("upload-error", message),
  });
  handle.setReadonly(Boolean(props.disabled));
  emit("ready");
});

watch(
  () => props.content,
  (next) => {
    if (!handle || next === lastContent) return;
    lastContent = next;
    handle.setMarkdown(next);
  }
);

watch(
  () => props.disabled,
  (next) => handle?.setReadonly(Boolean(next))
);

onBeforeUnmount(() => {
  const current = handle;
  handle = null;
  void current?.destroy();
});

defineExpose({
  getMarkdown: () => handle?.getMarkdown() ?? props.content,
  insertMarkdown: (snippet: string) => handle?.insertMarkdown(snippet),
});
</script>

<template>
  <div ref="host" class="milkdown-host editor-wysiwyg"></div>
</template>
