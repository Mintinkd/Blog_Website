<script setup lang="ts">
/**
 * 文章编辑器全屏壳层（T3 #64；T6 #67 补元信息抽屉、响应式与可访问性）。
 *
 * 状态全部来自 useArticleEditor 的 EditorState，本组件只抛事件，不做状态转移：
 * - 加载正文失败 → load-error 态（重试 / 关闭），不渲染可编辑表单；
 * - 锁冲突 → lock-conflict 态（取消 / admin 强制接管，接管后由宿主重新走详情加载）；
 * - 保存失败 → 保持编辑器打开、保持锁、保留当前内容（state.error 显示原因）；
 * - 锁丢失 → 禁止保存，给出「复制正文 / 保留草稿 / 关闭」三个可操作出口。
 *
 * T6 #67 新增契约：
 * - 所有保存入口（底部按钮 / 工作区快捷键 / 未保存弹窗）统一走 requestSave()，
 *   发布前检查标题与正文 trim 后非空；失败只在本组件内提示，不发 save 事件、
 *   不改编排器 phase、不释放锁。
 * - 元信息面板在窄屏折叠为抽屉（CSS 控制显隐，无 matchMedia 分支状态），
 *   宽屏常显；抽屉是非模态 region，四个 .modal 弹窗才是 role=dialog 模态。
 * - 保存 / 上传 / 锁丢失状态用 aria-live="polite" 播报；模态弹窗统一接
 *   useFocusTrap，关闭后焦点归还触发按钮。
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
import { checkPublishReady } from "../../utils/editor/metaFields";
import type { LockConflict } from "../editor/useEditLock";
import type { EditorGuardState } from "../editor/useArticleEditor";
import type { DraftPrompt } from "../editor/useLocalDraft";
import { useFocusTrap } from "../editor/useFocusTrap";
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
const metaDrawerOpen = ref(false);
const publishError = ref("");
const conflictDialog = ref<HTMLElement | null>(null);
const conflictVisible = computed(() => props.state.phase === "lock-conflict");
useFocusTrap(conflictDialog, conflictVisible);

/** 守卫判定为 lossy 时把布局同步回源码，避免按钮高亮与实际编辑形态漂移。 */
watch(
  () => props.guard.mode,
  (next) => {
    if (next === "source" && mode.value === "wysiwyg") mode.value = "source";
  }
);

/** 切文章时清空本组件的 UI 状态，避免上一篇的抽屉 / 错误提示漂移过来。 */
watch(
  () => props.state.articleId,
  () => {
    metaDrawerOpen.value = false;
    publishError.value = "";
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
const saveStatusText = computed(() => {
  if (props.state.phase === "saving") return t("admin.meta_save_saving");
  if (props.state.phase === "saved") return t("admin.meta_save_saved");
  if (props.state.error) return t("admin.meta_save_failed");
  return "";
});

function onForm(form: EditorFormSnapshot): void {
  publishError.value = "";
  emit("update-form", form);
}

function onContent(content: string): void {
  publishError.value = "";
  emit("update-form", { ...props.state.form, content });
}

/** 发布前校验失败的文案，按缺失字段分别给出，草稿状态直接放行。 */
function publishBlockedMessage(): string {
  const check = checkPublishReady(props.state.form);
  if (check.ok) return "";
  if (check.missing.length === 2) return t("admin.meta_publish_need_both");
  return check.missing[0] === "title"
    ? t("admin.meta_publish_need_title")
    : t("admin.meta_publish_need_content");
}

/**
 * 唯一保存入口：底部按钮、MarkdownWorkspace 的 Ctrl+S、未保存弹窗的
 * 「保存并关闭」都汇到这里。校验失败时不发 save、不动 phase、不释放锁，
 * 窄屏顺带展开元信息抽屉，让作者看得见缺哪个字段。
 */
function requestSave(): void {
  const message = publishBlockedMessage();
  if (message) {
    publishError.value = message;
    metaDrawerOpen.value = true;
    return;
  }
  publishError.value = "";
  emit("save");
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
    <div
      class="article-editor-overlay"
      role="dialog"
      :aria-label="
        props.state.articleId === 'new'
          ? t('admin.new_article')
          : t('admin.edit') + t('admin.articles')
      "
    >
      <div class="article-editor">
        <div class="editor-header">
          <h3>
            {{
              props.state.articleId === "new"
                ? t("admin.new_article")
                : t("admin.edit") + t("admin.articles")
            }}
          </h3>
          <button
            class="close-btn"
            type="button"
            :aria-label="t('admin.cancel')"
            @click="emit('close')"
          >
            &times;
          </button>
        </div>

        <div class="editor-body">
          <div v-if="isBusy" class="loading" aria-live="polite">
            {{ t("common.loading") }}
          </div>

          <div
            v-else-if="props.state.phase === 'load-error'"
            class="editor-state-panel"
            role="status"
            aria-live="polite"
          >
            <h3>{{ t("admin.editor_load_failed") }}</h3>
            <p>{{ props.state.error }}</p>
            <div class="modal-actions">
              <button
                class="btn-secondary"
                type="button"
                @click="emit('close')"
              >
                {{ t("admin.cancel") }}
              </button>
              <button class="btn-primary" type="button" @click="emit('retry')">
                {{ t("admin.editor_retry") }}
              </button>
            </div>
          </div>

          <template v-else-if="showWorkspace">
            <div
              v-if="props.state.phase === 'lock-lost'"
              class="editor-lock-lost"
              role="status"
              aria-live="polite"
            >
              <p>{{ t("admin.lock_lost_message") }}</p>
              <div class="modal-actions">
                <button
                  class="btn-secondary"
                  type="button"
                  @click="copyContent"
                >
                  {{ t("admin.lock_lost_copy") }}
                </button>
                <button
                  class="btn-secondary"
                  type="button"
                  @click="emit('keep-draft')"
                >
                  {{ t("admin.lock_lost_keep_draft") }}
                </button>
                <button
                  class="btn-danger"
                  type="button"
                  @click="emit('discard')"
                >
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

            <!-- T6 #67：宽屏常显，窄屏折叠为抽屉（非模态 region）。 -->
            <div class="editor-meta-region">
              <button
                type="button"
                class="btn-secondary meta-drawer-toggle"
                :aria-expanded="metaDrawerOpen"
                aria-controls="editor-meta-panel"
                @click="metaDrawerOpen = !metaDrawerOpen"
              >
                {{
                  metaDrawerOpen
                    ? t("admin.meta_drawer_close")
                    : t("admin.meta_drawer_open")
                }}
              </button>
              <div
                id="editor-meta-panel"
                :class="['editor-meta-panel', { open: metaDrawerOpen }]"
                role="region"
                :aria-label="t('admin.meta_drawer_title')"
              >
                <div class="meta-drawer-header">
                  <h3>{{ t("admin.meta_drawer_title") }}</h3>
                  <button
                    class="close-btn"
                    type="button"
                    :aria-label="t('admin.meta_drawer_close')"
                    @click="metaDrawerOpen = false"
                  >
                    &times;
                  </button>
                </div>
                <EditorMetaFields
                  :form="props.state.form"
                  :categories="props.categories"
                  :tags="props.tags"
                  :article-id="props.state.articleId"
                  :publish-error="publishError || null"
                  :disabled="props.state.phase === 'saving'"
                  @update:form="onForm"
                  @add-tag="(name: string) => emit('add-tag', name)"
                />
              </div>
            </div>

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
              @save="requestSave"
              @upload-error="(message: string) => emit('upload-error', message)"
            />
          </template>
        </div>

        <div class="editor-footer">
          <p
            v-if="props.state.error"
            class="editor-error"
            role="status"
            aria-live="polite"
          >
            {{ props.state.error }}
          </p>
          <span class="meta-live-region" aria-live="polite">
            {{ saveStatusText }}
          </span>
          <button class="btn-secondary" type="button" @click="emit('close')">
            {{ t("admin.cancel") }}
          </button>
          <button
            class="btn-primary"
            type="button"
            :disabled="saveDisabled"
            @click="requestSave"
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
      <div
        ref="conflictDialog"
        class="modal"
        role="dialog"
        aria-modal="true"
        :aria-label="t('admin.edit_locked')"
        tabindex="-1"
      >
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
          <button class="btn-secondary" type="button" @click="emit('close')">
            {{ t("admin.cancel") }}
          </button>
          <button
            v-if="props.userRole === 'admin'"
            class="btn-danger"
            type="button"
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
      @save="requestSave"
      @discard="emit('discard')"
      @continue="emit('continue')"
    />
  </Teleport>
</template>
