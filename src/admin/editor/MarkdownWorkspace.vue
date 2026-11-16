<script setup lang="ts">
/**
 * Markdown 工作区（T4 #65）：所见即所得 / 源码 / 分屏 / 线上预览。
 *
 * 契约：
 * - WYSIWYG 由 defineAsyncComponent + import() 懒加载，只在首次打开时加载内核；
 * - 打开 WYSIWYG 不回写正文，只有实际编辑才 emit update:content；
 * - 回写守卫状态由 useArticleEditor 传入（GLOSSARY：回写守卫），lossy 默认
 *   源码模式并提示，作者可显式覆盖，保存前守卫仍由编排器独立执行；
 * - 预览（分屏右侧与弹窗）都走同一个 renderMarkdown，150ms 防抖、只在可见时
 *   渲染，enhanceMediaLinks 限定各自容器；
 * - 快捷键只在编辑器焦点内生效；Esc 在弹窗打开时由弹窗消费。
 *
 * `.editor-toolbar .toolbar-btn` 第一个按钮恒为「插入链接」：
 * scripts/verify-visual-friendliness.mjs（CI 门禁）用它打开链接弹窗量测观感。
 */
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
} from "vue";
import { getLocale, t } from "../../utils/i18n.ts";
import { renderMarkdown } from "../../utils/markdown";
import { enhanceMediaLinks } from "../../utils/mediaEmbed.ts";
import {
  buildImageSnippet,
  continueList,
  insertSnippet,
  isEmbedSnippet,
  toggleLinePrefix,
  wrapSelection,
  type CommandResult,
} from "../../utils/editor/editorCommands";
import {
  describeUploadError,
  uploadImageAtSelection,
  uploadImageFile,
} from "../../utils/editor/uploadImage";
import type { EditorGuardState } from "./useArticleEditor";

const MilkdownEditor = defineAsyncComponent(
  () => import("./milkdown/MilkdownEditor.vue")
);

export type WorkspaceMode = "wysiwyg" | "source" | "split";

const props = defineProps<{
  content: string;
  mode: WorkspaceMode;
  guard: EditorGuardState;
  disabled?: boolean;
  /** Bearer token 由宿主注入；所有上传入口共用，组件不自行读 localStorage。 */
  getToken: () => string;
}>();

const emit = defineEmits<{
  (e: "update:content", value: string): void;
  (e: "update:mode", mode: WorkspaceMode): void;
  (e: "change-mode", mode: "wysiwyg" | "source"): void;
  (e: "override-guard"): void;
  (e: "open-link", selected: string): void;
  (e: "open-preview"): void;
  (e: "save"): void;
  (e: "upload-error", message: string): void;
}>();

interface WysiwygHandle {
  getMarkdown(): string;
  insertMarkdown(snippet: string): void;
}

const textarea = ref<HTMLTextAreaElement | null>(null);
const previewPane = ref<HTMLElement | null>(null);
const wysiwyg = ref<WysiwygHandle | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
/** 上传中禁用重复提交；不锁正文，作者可以继续写。 */
const uploading = ref(false);
const uploadDisabled = computed(
  () => Boolean(props.disabled) || uploading.value
);

/** 守卫状态是编辑形态的唯一权威；lossy 未覆盖时一律渲染源码 textarea。 */
const editorMode = computed<"wysiwyg" | "source">(() => props.guard.mode);
const showSplitPreview = computed(() => props.mode === "split");
const isSource = computed(() => editorMode.value === "source");

const debouncedContent = ref(props.content);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => props.content,
  (next) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debouncedContent.value = next;
    }, 150);
  }
);

/** 只在分屏预览可见时执行渲染；线上预览弹窗有自己的一份防抖渲染。 */
const previewHtml = computed(() => {
  if (!showSplitPreview.value || !debouncedContent.value) return "";
  try {
    return renderMarkdown(debouncedContent.value);
  } catch {
    return "";
  }
});

watch(previewHtml, () => {
  if (!showSplitPreview.value || !previewHtml.value) return;
  void nextTick(() => {
    if (previewPane.value) {
      enhanceMediaLinks(previewPane.value, "a[href]", getLocale());
    }
  });
});

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
});

function selectedText(): string {
  if (textarea.value) {
    const ta = textarea.value;
    return ta.value.slice(ta.selectionStart ?? 0, ta.selectionEnd ?? 0).trim();
  }
  return window.getSelection()?.toString().trim() ?? "";
}

function openLinkDialog(): void {
  emit("open-link", selectedText());
}

function applyResult(result: CommandResult): void {
  emit("update:content", result.text);
  void nextTick(() => {
    const ta = textarea.value;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(result.selection.start, result.selection.end);
  });
}

function selection(): { start: number; end: number } {
  const ta = textarea.value;
  return {
    start: ta?.selectionStart ?? props.content.length,
    end: ta?.selectionEnd ?? ta?.selectionStart ?? props.content.length,
  };
}

type SourceCommand = "bold" | "italic" | "heading" | "quote" | "list" | "code";

const sourceCommands: { id: SourceCommand; label: string }[] = [
  { id: "bold", label: "editor.toolbar_bold" },
  { id: "italic", label: "editor.toolbar_italic" },
  { id: "heading", label: "editor.toolbar_heading" },
  { id: "quote", label: "editor.toolbar_quote" },
  { id: "list", label: "editor.toolbar_list" },
  { id: "code", label: "editor.toolbar_code" },
];

/** 源码模式轻量工具栏：全部复用 T1 的纯命令，不在组件里第二实现。 */
function runSourceCommand(command: SourceCommand): void {
  const sel = selection();
  switch (command) {
    case "bold":
      applyResult(wrapSelection(props.content, sel, "**", "**", "粗体"));
      break;
    case "italic":
      applyResult(wrapSelection(props.content, sel, "*", "*", "斜体"));
      break;
    case "heading":
      applyResult(toggleLinePrefix(props.content, sel, "## "));
      break;
    case "quote":
      applyResult(toggleLinePrefix(props.content, sel, "> "));
      break;
    case "list":
      applyResult(toggleLinePrefix(props.content, sel, "- "));
      break;
    case "code":
      applyResult(wrapSelection(props.content, sel, "`", "`", "代码"));
      break;
  }
}

/** 源码模式列表续行（Enter），非列表行不拦截浏览器默认换行。 */
function onSourceEnter(event: KeyboardEvent): void {
  if (!isSource.value || !textarea.value) return;
  const ta = textarea.value;
  const sel = selection();
  const lineStart = props.content.slice(0, sel.start).lastIndexOf("\n") + 1;
  const line = props.content.slice(lineStart, sel.end);
  if (!/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) return;
  event.preventDefault();
  applyResult(continueList(props.content, sel));
}

/** 快捷键只在编辑器根节点内（焦点在编辑器里）生效。 */
function onKeydown(event: KeyboardEvent): void {
  const mod = event.ctrlKey || event.metaKey;
  if (!mod) return;
  const key = event.key.toLowerCase();
  if (key === "s") {
    event.preventDefault();
    emit("save");
    return;
  }
  if (key === "k") {
    event.preventDefault();
    openLinkDialog();
    return;
  }
  if (event.shiftKey && key === "p") {
    event.preventDefault();
    emit("open-preview");
    return;
  }
  if (event.shiftKey && key === "e") {
    event.preventDefault();
    switchMode(editorMode.value === "wysiwyg" ? "source" : "wysiwyg");
    return;
  }
  // WYSIWYG 的粗体 / 斜体由 Crepe 自带 keymap 处理，源码模式才接管。
  if (!event.shiftKey && (key === "b" || key === "i") && isSource.value) {
    event.preventDefault();
    runSourceCommand(key === "b" ? "bold" : "italic");
  }
}

function switchMode(mode: "wysiwyg" | "source"): void {
  emit("change-mode", mode);
  emit("update:mode", mode);
}

function chooseMode(mode: WorkspaceMode): void {
  if (mode === "split") {
    emit("update:mode", "split");
    return;
  }
  switchMode(mode);
}

/** 供壳层在 LinkDialog 确认后调用；WYSIWYG 与源码写同一种 Markdown。 */
function insertAtCursor(snippet: string): void {
  if (isSource.value) {
    const result = insertSnippet(props.content, selection(), snippet);
    applyResult(result);
    return;
  }
  // #74：embed 锚点走「更新 form.content → setMarkdown」整篇重解析路径。
  // inline insert(snippet, true) 会序列化再反序列化，丢掉 data-embed；而
  // MilkdownEditor 的 watch(props.content) 用 replaceAll 整篇加载时，
  // embedLinkRemark 能把三元组合并为专用 embed_link 节点（源码模式所见即所得）。
  // emit 后 props.content 变化自然触发该 watch，无需新增 handle 方法。
  if (isEmbedSnippet(snippet)) {
    const result = insertSnippet(props.content, selection(), snippet);
    emit("update:content", result.text);
    return;
  }
  // 异步组件尚未挂载时退化为追加，绝不静默丢弃作者的插入操作。
  if (wysiwyg.value) wysiwyg.value.insertMarkdown(snippet);
  else emit("update:content", props.content + snippet);
}

function openImagePicker(): void {
  if (uploadDisabled.value) return;
  fileInput.value?.click();
}

/**
 * 工具栏上传（T5 #66）：源码模式走可单测的一站式插入，失败原样保留正文；
 * WYSIWYG 只把返回的 URL 变成普通图片节点，粘贴 / 拖拽由 Crepe uploader 复用同一适配器。
 */
async function onImagePicked(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // 立即清空，允许再次选择同一个文件；上传失败也不留下旧选择。
  input.value = "";
  if (!file || uploadDisabled.value) return;

  uploading.value = true;
  try {
    if (isSource.value) {
      const snapshot = selection();
      const result = await uploadImageAtSelection(
        props.content,
        snapshot,
        file,
        props.getToken
      );
      if (!result.ok) {
        emit("upload-error", describeUploadError(result.error, t));
        return;
      }
      emit("update:content", result.content);
      await nextTick();
      const ta = textarea.value;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(result.selection.start, result.selection.end);
      }
      return;
    }
    const image = await uploadImageFile(file, props.getToken);
    insertAtCursor(buildImageSnippet(image.url, image.alt));
  } catch (error) {
    emit("upload-error", describeUploadError(error, t));
  } finally {
    uploading.value = false;
  }
}

defineExpose({ insertAtCursor });
</script>

<template>
  <div class="form-group editor-workspace" @keydown="onKeydown">
    <div class="content-label-row">
      <label>{{ t("admin.content") }} (Markdown)</label>
      <div class="preview-toggle">
        <button
          type="button"
          :class="[
            'toggle-btn',
            { active: props.mode === 'wysiwyg' && !isSource },
          ]"
          @click="chooseMode('wysiwyg')"
        >
          {{ t("editor.mode_wysiwyg") }}
        </button>
        <button
          type="button"
          :class="[
            'toggle-btn',
            {
              active:
                props.mode === 'source' || (isSource && props.mode !== 'split'),
            },
          ]"
          @click="chooseMode('source')"
        >
          {{ t("editor.mode_source") }}
        </button>
        <button
          type="button"
          :class="[
            'toggle-btn',
            'split-toggle',
            { active: props.mode === 'split' },
          ]"
          @click="chooseMode('split')"
        >
          {{ t("editor.mode_split") }}
        </button>
        <button type="button" class="toggle-btn" @click="emit('open-preview')">
          {{ t("editor.online_preview") }}
        </button>
      </div>
    </div>

    <div
      v-if="props.guard.message"
      class="editor-guard-bar"
      role="status"
      aria-live="polite"
    >
      <span class="editor-guard-message">{{ props.guard.message }}</span>
      <button
        v-if="
          isSource && props.guard.status === 'lossy' && !props.guard.override
        "
        type="button"
        class="toolbar-btn"
        @click="emit('override-guard')"
      >
        {{ t("editor.guard_override") }}
      </button>
    </div>

    <!-- 第一个按钮恒为插入链接：CI 观感门禁从这里打开 LinkDialog。 -->
    <div class="editor-toolbar">
      <button
        type="button"
        class="toolbar-btn"
        :disabled="props.disabled"
        @click="openLinkDialog"
      >
        {{ t("admin.insert_link") }}
      </button>
      <button
        type="button"
        class="toolbar-btn editor-upload-btn"
        :disabled="uploadDisabled"
        @click="openImagePicker"
      >
        {{ uploading ? t("editor.uploading") : t("editor.upload_image") }}
      </button>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        class="editor-image-input"
        :disabled="uploadDisabled"
        @change="onImagePicked"
      />
      <template v-if="isSource">
        <button
          v-for="command in sourceCommands"
          :key="command.id"
          type="button"
          class="toolbar-btn source-command"
          :disabled="props.disabled"
          @click="runSourceCommand(command.id)"
        >
          {{ t(command.label) }}
        </button>
      </template>
      <span class="toolbar-hint">{{ t("admin.link_hint") }}</span>
    </div>

    <!-- T6 #67：上传状态用 polite live region 播报，按钮文案本身也同步变化。 -->
    <span class="meta-live-region" aria-live="polite">
      {{ uploading ? t("admin.meta_upload_status") : "" }}
    </span>

    <div
      :class="[
        'editor-content-area',
        showSplitPreview ? 'split' : 'single',
        isSource ? 'source' : 'wysiwyg',
      ]"
    >
      <textarea
        v-if="isSource"
        ref="textarea"
        :value="props.content"
        rows="20"
        class="editor-textarea"
        :disabled="props.disabled"
        @input="
          emit('update:content', ($event.target as HTMLTextAreaElement).value)
        "
        @keydown.enter="onSourceEnter"
      ></textarea>
      <MilkdownEditor
        v-else
        ref="wysiwyg"
        :content="props.content"
        :disabled="props.disabled"
        :get-token="props.getToken"
        @change="(value: string) => emit('update:content', value)"
        @upload-error="(message: string) => emit('upload-error', message)"
      />
      <div
        v-if="showSplitPreview"
        ref="previewPane"
        class="editor-preview prose"
        v-html="previewHtml"
      ></div>
    </div>
  </div>
</template>
