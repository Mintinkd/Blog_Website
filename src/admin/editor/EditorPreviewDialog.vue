<script setup lang="ts">
/**
 * 只读线上预览弹窗（T4 #65）。
 *
 * 与分屏右侧预览共用同一 `renderMarkdown`（marked + DOMPurify + 正文白名单），
 * 150ms 防抖、只在可见时渲染；`enhanceMediaLinks` 只作用于本弹窗容器，
 * 不再全局 querySelector。Esc 由弹窗自己消费，不冒泡到 T3 的未保存保护。
 * T3 #64 的预览形态（分屏 / 预览布局）不由本票改变，本组件是新增的只读弹窗。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { getLocale, t } from "../../utils/i18n.ts";
import { renderMarkdown } from "../../utils/markdown";
import { enhanceMediaLinks } from "../../utils/mediaEmbed.ts";

const props = defineProps<{
  visible: boolean;
  content: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const body = ref<HTMLElement | null>(null);
const debounced = ref(props.content);
let timer: ReturnType<typeof setTimeout> | null = null;

const previewHtml = computed(() => {
  if (!props.visible || !debounced.value) return "";
  try {
    return renderMarkdown(debounced.value);
  } catch {
    return "";
  }
});

watch(
  () => props.content,
  (next) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      debounced.value = next;
    }, 150);
  },
  { immediate: true }
);

watch([previewHtml, () => props.visible], () => {
  if (!props.visible || !previewHtml.value) return;
  void nextTick(() => {
    if (body.value) enhanceMediaLinks(body.value, "a[href]", getLocale());
  });
});

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer);
});

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  // 弹窗消费 Esc：不触发 T3 的 window keydown（未保存保护）。
  event.preventDefault();
  event.stopPropagation();
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.visible"
      class="modal-overlay editor-preview-overlay"
      @click.self="emit('close')"
    >
      <div
        class="modal editor-preview-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('editor.online_preview')"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <div class="editor-preview-header">
          <h3>{{ t("editor.online_preview") }}</h3>
          <button class="close-btn" type="button" @click="emit('close')">
            &times;
          </button>
        </div>
        <div ref="body" class="editor-preview prose" v-html="previewHtml"></div>
      </div>
    </div>
  </Teleport>
</template>
