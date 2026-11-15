import {
  useArticleEditor,
  type ArticleEditorCore,
} from "../editor/useArticleEditor.ts";
import { roundTripMarkdown } from "../editor/milkdown/milkdownService";
import { createEditLock } from "../editor/useEditLock.ts";
import {
  isEditorOpen,
  type EditorFormSnapshot,
} from "../../utils/editor/editorState";
import { t } from "../../utils/i18n.ts";
import { renderMarkdown } from "../../utils/markdown";
import type { AdminApi } from "./useAdminApi";
import type { AdminSession } from "./useSession";
import type { AdminFeedback } from "./useFeedback";
import type { AdminCatalog } from "./useAdminCatalog";

/** 抓取面板把预览转成新建文章时传入的预填表单。 */
export type ScrapePrefill = EditorFormSnapshot;

export interface AdminEditorDeps {
  api: AdminApi;
  session: AdminSession;
  feedback: AdminFeedback;
  catalog: AdminCatalog;
}

/**
 * 编辑器编排桥接。
 *
 * 拆分前 `App.vue` 里 `useArticleEditor` 的装配、21 个 overlay 事件回调、
 * 文章删除、抓取草稿转文章、编辑器内新建标签都在这里；抓取面板与本壳层
 * 共同消费，因此抽成 composable 而不是留在任一面板内。
 */
export function createAdminEditor(deps: AdminEditorDeps) {
  const { api, session, feedback, catalog } = deps;

  const editorLock = createEditLock({
    apiBase: import.meta.env.PUBLIC_API_BASE || "/api/v1",
    getToken: () => session.token.value,
  });

  const editorView = useArticleEditor({
    // 函数形式：首屏可能还没有 token / userId，登录后再打开编辑器必须取到真实 id。
    userId: () => session.userId.value,
    api: { request: (method, path, body) => api(method, path, body) },
    lock: editorLock,
    storage: window.localStorage,
    guard: { roundTrip: roundTripMarkdown, render: renderMarkdown },
    messages: () => ({
      loadFailed: t("admin.editor_load_failed"),
      saveFailed: t("admin.save_failed"),
      lockFailed: t("admin.lock_failed"),
      lockLost: t("admin.lock_lost_message"),
      guardLossy: t("admin.editor_guard_lossy"),
      guardBlocked: t("admin.editor_guard_blocked"),
      draftOversize: t("admin.draft_oversize"),
      draftStorageError: t("admin.draft_storage_error"),
    }),
    onSaved: () => {
      void catalog.loadArticles();
    },
    onSessionExpired: () => {
      session.isLoggedIn.value = false;
    },
    onError: (message: string) => {
      feedback.alert(message);
    },
  });

  const core: ArticleEditorCore = editorView.core;
  const state = editorView.state;
  const conflict = editorView.conflict;
  const guard = editorView.guard;
  const draft = editorView.draft;
  const isOpen = () => isEditorOpen(state.value);

  function getToken(): string {
    return session.token.value;
  }

  function openNewArticle(): void {
    void core.open(null);
  }

  function editArticle(a: { id: number }): void {
    void core.open({ id: a.id });
  }

  function openFromScrape(prefill: ScrapePrefill): void {
    void core.open(null, prefill);
  }

  function setAuthorFilter(value: string): void {
    catalog.authorFilter.value = value;
  }

  function onEditorForm(form: EditorFormSnapshot): void {
    core.updateForm(form);
  }
  function onEditorSave(): void {
    void core.save();
  }
  function onEditorClose(): void {
    core.close();
  }
  function onEditorRetry(): void {
    void core.retryLoad();
  }
  function onEditorTakeover(): void {
    void core.takeover();
  }
  function onEditorDiscard(): void {
    core.discard();
  }
  function onEditorContinue(): void {
    core.continueEditing();
  }
  function onEditorOpenLink(): void {
    core.openDialog("link");
  }
  function onEditorOpenPreview(): void {
    core.openDialog("preview");
  }
  function onEditorCloseDialog(): void {
    core.closeDialog();
  }
  function onEditorChangeMode(mode: "wysiwyg" | "source"): void {
    void core.setEditorMode(mode);
  }
  function onEditorOverrideGuard(): void {
    void core.overrideGuard();
  }
  function onEditorUploadError(message: string): void {
    feedback.alert(message || t("admin.upload_failed"));
  }
  function onEditorKeepDraft(): void {
    core.keepDraftAndClose();
  }
  function onEditorRestoreDraft(): void {
    void core.restoreDraft();
  }
  function onEditorDiscardDraft(): void {
    core.discardDraft();
  }

  /** 新建标签沿用原有 POST /tags → loadTags → 加进表单的路径，行为等价。 */
  async function addEditorTag(name: string): Promise<void> {
    const current = core.getState();
    if (!current || current.form.tags.includes(name)) return;
    let slug = name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\-]/g, "");
    if (!slug) slug = "tag-" + Date.now().toString(36);
    try {
      const res = await api("POST", "/tags", { name, slug });
      if (res.code === 0 || res.code === 10006) {
        await catalog.loadTags();
        const latest = core.getState();
        if (latest && !latest.form.tags.includes(name)) {
          core.updateForm({
            ...latest.form,
            tags: [...latest.form.tags, name],
          });
        }
      } else {
        feedback.alert(res.message || t("admin.save_failed"));
      }
    } catch {
      feedback.alert(t("admin.save_failed"));
    }
  }

  async function deleteArticle(id: number): Promise<void> {
    if (!feedback.confirm(t("admin.delete_confirm"))) return;
    const data = await api("DELETE", `/articles/${id}`);
    if (data.code === 0) await catalog.loadArticles();
    else feedback.alert(data.message || t("admin.delete_failed"));
  }

  function dispose(): void {
    core.dispose();
  }

  function sessionExpired(): Promise<void> {
    return core.sessionExpired();
  }

  return {
    state,
    conflict,
    guard,
    draft,
    isOpen,
    getToken,
    openNewArticle,
    editArticle,
    openFromScrape,
    setAuthorFilter,
    onEditorForm,
    onEditorSave,
    onEditorClose,
    onEditorRetry,
    onEditorTakeover,
    onEditorDiscard,
    onEditorContinue,
    onEditorOpenLink,
    onEditorOpenPreview,
    onEditorCloseDialog,
    onEditorChangeMode,
    onEditorOverrideGuard,
    onEditorUploadError,
    onEditorKeepDraft,
    onEditorRestoreDraft,
    onEditorDiscardDraft,
    addEditorTag,
    deleteArticle,
    dispose,
    sessionExpired,
  };
}

export type AdminEditor = ReturnType<typeof createAdminEditor>;
