<script setup lang="ts">
/**
 * 文章编辑器全屏壳层（T3 #64）：头部 / 状态区 / 元信息 / Markdown 工作区 / 底部操作。
 *
 * 状态全部来自 useArticleEditor 的 EditorState，本组件只抛事件，不做状态转移：
 * - 加载正文失败 → load-error 态（重试 / 关闭），不渲染可编辑表单；
 * - 锁冲突 → lock-conflict 态（取消 / admin 强制接管，接管后由宿主重新走详情加载）；
 * - 保存失败 → 保持编辑器打开、保持锁、保留当前内容（state.error 显示原因）；
 * - 锁丢失 → 禁止保存，给出「复制正文 / 保留草稿 / 关闭」三个可操作出口。
 *
 * T4 #65：工作区改为 WYSIWYG / 源码 / 分屏 / 线上预览，守卫快照由
 * useArticleEditor 传入；线上预览弹窗复用同一个 renderMarkdown。
 *
 * `.article-editor-overlay` / `.editor-toolbar` / `.toolbar-btn` 等类名保持不变，
 * 供 scripts/verify-visual-friendliness.mjs（CI 门禁）定位与量测。
 */
import { computed, ref, watch } from "vue";
import { t } from "../../utils/i18n.ts";
import {
  canSave,
  type EditorFormSnapshot,
  type EditorState,
} from "../../utils/editor/editorState";
import type { LockConflict } from "../editor/useEditLock";
import type { EditorGuardState } from "../editor/useArticleEditor";
import type { DraftPrompt } from "../editor/useLocalDraft";
import EditorMetaFields from "../editor/EditorMetaFields.vue";
import DraftRecoveryBar from "../editor/DraftRecoveryBar.vue";
import MarkdownWorkspace, {
  type WorkspaceMode,
} from "../editor/MarkdownWorkspace.vue";
import EditorPreviewDialog from "../editor/EditorPreviewDialog.vue";
import LinkDialog from "../editor/LinkDialog.vue";
import UnsavedChangesDialog from "../editor/UnsavedChangesDialog.vue";

const props = defineProps<{
  state: EditorState;
  conflict: LockConflict | null;
  guard: EditorGuardState;
  draft: DraftPrompt | null;
  categories: { id: number; name: string }[];
  tags: { id: number; name: string }[];
  userRole: string;
  /** Bearer token 由宿主注入；MarkdownWorkspace 的所有上传入口都只调用它。 */
  getToken: () => string;
}>();

const emit = defineEmits<{
  (e: "update-form", form: EditorFormSnapshot): void;
  (e: "save"): void;
  (e: "close"): void;
  (e: "retry"): void;
  (e: "takeover"): void;
  (e: "discard"): void;
  (e: "continue"): void;
  (e: "open-link"): void;
  (e: "open-preview"): void;
  (e: "close-dialog"): void;
  (e: "change-mode", mode: "wysiwyg" | "source"): void;
  (e: "override-guard"): void;
  (e: "upload-error", message: string): void;
  (e: "restore-draft"): void;
  (e: "discard-draft"): void;
  (e: "add-tag", name: string): void;
  (e: "keep-draft"): void;
}>();

const mode = ref<WorkspaceMode>("wysiwyg");

/** 守卫判定为 lossy 时把布局同步回源码，避免按钮高亮与实际编辑形态漂移。 */
watch(
  () => props.guard.mode,
  (next) => {
    if (next === "source" && mode.value === "wysiwyg") mode.value = "source";
  }
);
const linkSelected = ref("");
const workspace = ref<InstanceType<typeof MarkdownWorkspace> | null>(null);

const showWorkspace = computed(
  () =>
    props.state.phase === "ready" ||
    props.state.phase === "saving" ||
    props.state.phase === "lock-lost"
);
const isBusy = computed(
  () =>
    props.state.phase === "acquiring-lock" ||
    props.state.phase === "loading-content"
);
const saveDisabled = computed(
  () => !canSave(props.state) || props.state.phase === "saving"
);

function onForm(form: EditorFormSnapshot): void {
  emit("update-form", form);
}

function onContent(content: string): void {
  emit("update-form", { ...props.state.form, content });
}

function onOpenLink(selected: string): void {
  linkSelected.value = selected;
  emit("open-link");
}

function onInsertSnippet(snippet: string): void {
  workspace.value?.insertAtCursor(snippet);
}

async function copyContent(): Promise<void> {
  try {
    await navigator.clipboard?.writeText(props.state.form.content);
  } catch {
    // 剪贴板不可用时保留正文在编辑器里，不静默清空。
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="article-editor-overlay">
      <div class="article-editor">
        <div class="editor-header">
          <h3>
            {{
              props.state.articleId === "new"
                ? t("admin.new_article")
                : t("admin.edit") + t("admin.articles")
            }}
          </h3>
          <button class="close-btn" @click="emit('close')">&times;</button>
        </div>

        <div class="editor-body">
          <div v-if="isBusy" class="loading" aria-live="polite">
            {{ t("common.loading") }}
          </div>

          <div
            v-else-if="props.state.phase === 'load-error'"
            class="editor-state-panel"
            role="alert"
          >
            <h3>{{ t("admin.editor_load_failed") }}</h3>
            <p>{{ props.state.error }}</p>
            <div class="modal-actions">
              <button class="btn-secondary" @click="emit('close')">
                {{ t("admin.cancel") }}
              </button>
              <button class="btn-primary" @click="emit('retry')">
                {{ t("admin.editor_retry") }}
              </button>
            </div>
          </div>

          <template v-else-if="showWorkspace">
            <div
              v-if="props.state.phase === 'lock-lost'"
              class="editor-lock-lost"
              role="alert"
            >
              <p>{{ t("admin.lock_lost_message") }}</p>
              <div class="modal-actions">
                <button class="btn-secondary" @click="copyContent">
                  {{ t("admin.lock_lost_copy") }}
                </button>
                <button class="btn-secondary" @click="emit('keep-draft')">
                  {{ t("admin.lock_lost_keep_draft") }}
                </button>
                <button class="btn-danger" @click="emit('discard')">
                  {{ t("admin.lock_lost_close") }}
                </button>
              </div>
            </div>
            <!-- T5 #66：只提示恢复 / 丢弃，绝不自动覆盖服务端加载出的正文。 -->
            <DraftRecoveryBar
              :prompt="props.draft"
              @restore="emit('restore-draft')"
              @discard="emit('discard-draft')"
            />
            <EditorMetaFields
              :form="props.state.form"
              :categories="props.categories"
              :tags="props.tags"
              :disabled="props.state.phase === 'saving'"
              @update:form="onForm"
              @add-tag="(name: string) => emit('add-tag', name)"
            />
            <MarkdownWorkspace
              ref="workspace"
              :content="props.state.form.content"
              :mode="mode"
              :guard="props.guard"
              :disabled="props.state.phase === 'saving'"
              :get-token="props.getToken"
              @update:content="onContent"
              @update:mode="(next: WorkspaceMode) => (mode = next)"
              @change-mode="
                (next: 'wysiwyg' | 'source') => emit('change-mode', next)
              "
              @override-guard="emit('override-guard')"
              @open-link="onOpenLink"
              @open-preview="emit('open-preview')"
              @save="emit('save')"
              @upload-error="(message: string) => emit('upload-error', message)"
            />
          </template>
        </div>

        <div class="editor-footer">
          <p v-if="props.state.error" class="editor-error" role="alert">
            {{ props.state.error }}
          </p>
          <button class="btn-secondary" @click="emit('close')">
            {{ t("admin.cancel") }}
          </button>
          <button
            class="btn-primary"
            :disabled="saveDisabled"
            @click="emit('save')"
          >
            {{
              props.state.phase === "saving"
                ? t("admin.save_loading")
                : t("admin.save")
            }}
          </button>
        </div>
      </div>
    </div>

    <!-- 锁冲突：打开阶段被他人持有，admin 可强制接管（接管后重建基线）。 -->
    <div
      v-if="props.state.phase === 'lock-conflict'"
      class="modal-overlay lock-conflict-overlay"
      @click.self="emit('close')"
    >
      <div class="modal">
        <h3>{{ t("admin.edit_locked") }}</h3>
        <p>
          {{
            t("admin.edit_locked_msg", {
              name: props.conflict?.holder_name || "?",
            })
          }}
        </p>
        <p v-if="props.conflict?.expires_at" class="lock-conflict-expires">
          {{ t("admin.lock_expires_at") }}:
          {{ new Date(props.conflict.expires_at).toLocaleString() }}
        </p>
        <div class="modal-actions">
          <button class="btn-secondary" @click="emit('close')">
            {{ t("admin.cancel") }}
          </button>
          <button
            v-if="props.userRole === 'admin'"
            class="btn-danger"
            @click="emit('takeover')"
          >
            {{ t("admin.force_takeover") }}
          </button>
        </div>
      </div>
    </div>

    <!-- 只读线上预览：与分屏右侧共用 renderMarkdown，Esc 由弹窗自己消费。 -->
    <EditorPreviewDialog
      :visible="props.state.dialog === 'preview'"
      :content="props.state.form.content"
      @close="emit('close-dialog')"
    />
    <LinkDialog
      :visible="props.state.dialog === 'link'"
      :selected="linkSelected"
      @close="emit('close-dialog')"
      @insert="onInsertSnippet"
    />
    <UnsavedChangesDialog
      :visible="props.state.dialog === 'unsaved'"
      :saving="props.state.phase === 'saving'"
      @save="emit('save')"
      @discard="emit('discard')"
      @continue="emit('continue')"
    />
  </Teleport>
</template>
