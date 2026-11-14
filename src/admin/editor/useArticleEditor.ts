/**
 * 文章编辑器（GLOSSARY：文章编辑器）的显式状态机与副作用编排。
 *
 * 状态转移全部走 T1 的纯 reducer（`src/utils/editor/editorState.ts`），本文件只负责
 * 按 closeDecision 执行副作用（释放编辑锁、清 / 留本地草稿、通知宿主），因此
 * 「脏状态 / 关闭决策 / 保存失败 / 锁丢失」仍由 tests/editor-state.test.ts 单测钉住，
 * 而「加载失败不可编辑、保存失败保持打开、pagehide 释放、Esc 分层」由
 * tests/article-editor-flow.test.ts 在 node 环境全链路测（不挂载 Vue / DOM）。
 *
 * 状态机见 docs/ARTICLE_EDITOR_UPGRADE.md §7；契约见 §5.4 / §5.5 / §5.6。
 * `createArticleEditor` 不 import DOM 类型，fetch / storage / 事件目标均可注入；
 * `useArticleEditor` 是给 ArticleEditorOverlay 用的 Vue 薄包装。
 */
import { onBeforeUnmount, onMounted, shallowRef } from "vue";
import {
  canSave,
  closeDecision,
  emptyEditorForm,
  initialEditorState,
  isEditorDirty,
  isEditorOpen,
  reduceEditorState,
  shouldBlockUnload,
  type EditorDialog,
  type EditorEvent,
  type EditorFormSnapshot,
  type EditorState,
} from "../../utils/editor/editorState";
import {
  clearDraft,
  saveDraft,
  type DraftStorage,
} from "../../utils/editor/draftStore";
import {
  SESSION_EXPIRED_CODE,
  type EditLock,
  type LockConflict,
} from "./useEditLock";

/** 与 Worker 的 ArticleEditDetail 对齐的手写投影；不跨包 import Worker 类型。 */
export interface ArticleEditDetailLike {
  title?: string;
  slug?: string;
  content?: string;
  summary?: string;
  cover_image?: string;
  category_id?: number | null;
  tags?: { name?: string }[];
  status?: string;
}

export interface ApiEnvelope {
  code: number;
  message?: string;
  data?: ArticleEditDetailLike | null;
}

export interface EditorApi {
  request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown
  ): Promise<ApiEnvelope>;
}

export interface EditorMessages {
  loadFailed: string;
  saveFailed: string;
  lockFailed: string;
  lockLost: string;
}

const DEFAULT_MESSAGES: EditorMessages = {
  loadFailed: "加载失败",
  saveFailed: "保存失败",
  lockFailed: "获取编辑锁失败",
  lockLost: "编辑锁已被接管",
};

export interface ArticleEditorOptions {
  userId: number;
  api: EditorApi;
  lock: EditLock;
  storage?: DraftStorage | null;
  now?: () => number;
  messages?: () => EditorMessages;
  onSaved?: () => void;
  onClosed?: () => void;
  onSessionExpired?: () => void;
  onError?: (message: string) => void;
}

export interface KeyEventLike {
  key: string;
  preventDefault(): void;
}

export interface UnloadEventLike {
  preventDefault(): void;
  returnValue?: unknown;
}

export interface PageHideEventLike {
  persisted?: boolean;
}

export interface ArticleEditorCore {
  getState(): EditorState;
  getConflict(): LockConflict | null;
  subscribe(
    listener: (state: EditorState, conflict: LockConflict | null) => void
  ): () => void;
  open(
    article: { id: number } | null,
    prefill?: EditorFormSnapshot
  ): Promise<void>;
  retryLoad(): Promise<void>;
  takeover(): Promise<void>;
  updateForm(form: EditorFormSnapshot): void;
  save(): Promise<void>;
  close(): void;
  esc(): void;
  discard(): void;
  continueEditing(): void;
  openDialog(dialog: Exclude<EditorDialog, "none">): void;
  closeDialog(): void;
  keepDraftAndClose(): void;
  /** 供宿主 API 层在收到 10003 时先落盘草稿再退出登录。 */
  sessionExpired(): Promise<void>;
  handleBeforeUnload(event: UnloadEventLike): void;
  handlePageHide(event: PageHideEventLike): void;
  handleKeyDown(event: KeyEventLike): void;
  attach(): void;
  dispose(): void;
}

function mapDetailToForm(detail: ArticleEditDetailLike): EditorFormSnapshot {
  return {
    title: detail.title || "",
    slug: detail.slug || "",
    summary: detail.summary || "",
    content: detail.content || "",
    cover_image: detail.cover_image || "",
    category_id:
      detail.category_id === null || detail.category_id === undefined
        ? ""
        : String(detail.category_id),
    status: detail.status || "draft",
    tags: (detail.tags || []).map((tag) => tag.name || "").filter(Boolean),
  };
}

export function createArticleEditor(
  options: ArticleEditorOptions
): ArticleEditorCore {
  const messages = options.messages ?? (() => DEFAULT_MESSAGES);
  const now = options.now ?? (() => Date.now());
  let state = initialEditorState();
  let conflict: LockConflict | null = null;
  let currentArticle: { id: number } | null = null;
  const listeners = new Set<
    (next: EditorState, lockConflict: LockConflict | null) => void
  >();
  let attached = false;

  function notify(): void {
    listeners.forEach((listener) => listener(state, conflict));
  }

  function dispatch(event: EditorEvent): EditorState {
    const next = reduceEditorState(state, event);
    if (next !== state) {
      state = next;
      notify();
    }
    return state;
  }

  function draftScope() {
    return {
      userId: options.userId,
      articleId: state.articleId ?? "new",
    };
  }

  /** 同步落盘：会话失效 / pagehide / 锁丢失都必须在退出前写完，不能用防抖。 */
  function persistDraftSync(): void {
    if (!options.storage || !isEditorOpen(state)) return;
    saveDraft(options.storage, draftScope(), state.form, {
      savedAt: now(),
      baselineHash: `baseline:${state.baseline.content.length}`,
    });
  }

  function clearDraftSync(): void {
    if (!options.storage) return;
    clearDraft(options.storage, draftScope());
  }

  function onLockConflict(next: LockConflict): void {
    conflict = next;
    // 心跳 / 保存前校验失锁：禁止保存，仍允许改字并复制正文。
    dispatch({ type: "lock-lost" });
  }

  // 失锁 / 会话失效由 EditLock.setHandlers 在运行期转发到本编排器，
  // 避免「lock 先创建、core 后创建」的循环依赖（见文件末尾的绑定）。
  function applyCloseSideEffects(decision: {
    releaseLock: boolean;
    clearDraft: boolean;
    keepDraft: boolean;
  }): void {
    if (decision.keepDraft) persistDraftSync();
    if (decision.clearDraft) clearDraftSync();
    if (decision.releaseLock) {
      void options.lock.release();
      options.lock.stopHeartbeat();
    }
  }

  async function loadContent(prefill?: EditorFormSnapshot): Promise<void> {
    if (!currentArticle) {
      dispatch({
        type: "loaded",
        form: prefill
          ? { ...prefill, tags: [...prefill.tags] }
          : emptyEditorForm(),
      });
      return;
    }
    let res: ApiEnvelope;
    try {
      res = await options.api.request(
        "GET",
        `/articles/${currentArticle.id}/edit`
      );
    } catch {
      dispatch({
        type: "load-failed",
        message: messages().loadFailed,
      });
      return;
    }
    if (res.code === SESSION_EXPIRED_CODE) {
      await handleSessionExpired();
      return;
    }
    if (res.code !== 0 || !res.data) {
      dispatch({
        type: "load-failed",
        message: res.message || messages().loadFailed,
      });
      return;
    }
    // T2 的认证详情接口：不经公开 slug 接口、不触发阅读统计；
    // loaded 同时写入 form 与 baseline，强制接管后基线在此重建。
    dispatch({ type: "loaded", form: mapDetailToForm(res.data) });
  }

  async function open(
    article: { id: number } | null,
    prefill?: EditorFormSnapshot
  ): Promise<void> {
    await options.lock.release();
    options.lock.stopHeartbeat();
    conflict = null;
    currentArticle = article;
    dispatch({ type: "open", articleId: article ? article.id : "new" });
    if (article) {
      const outcome = await options.lock.acquire(article.id);
      if (outcome.kind === "conflict") {
        conflict = outcome.conflict;
        notify();
        dispatch({ type: "lock-conflict" });
        return;
      }
      if (outcome.kind === "session-expired") {
        await handleSessionExpired();
        return;
      }
      if (outcome.kind !== "ok") {
        dispatch({ type: "lock-acquired" });
        dispatch({
          type: "load-failed",
          message: outcome.message || messages().lockFailed,
        });
        return;
      }
    }
    // 新建文章没有服务端锁，lockHeld 在这里是「逻辑持锁」，让 canSave 放行。
    dispatch({ type: "lock-acquired" });
    if (article) options.lock.startHeartbeat();
    await loadContent(prefill);
  }

  async function retryLoad(): Promise<void> {
    if (state.phase !== "load-error") return;
    dispatch({ type: "retry-load" });
    await loadContent();
  }

  async function takeover(): Promise<void> {
    if (state.phase !== "lock-conflict" || !currentArticle) return;
    const outcome = await options.lock.forceTakeover(currentArticle.id);
    if (outcome.kind === "conflict") {
      conflict = outcome.conflict;
      notify();
      return;
    }
    if (outcome.kind === "session-expired") {
      await handleSessionExpired();
      return;
    }
    if (outcome.kind !== "ok") {
      options.onError?.(outcome.message || messages().lockFailed);
      return;
    }
    conflict = null;
    dispatch({ type: "lock-retry" });
    dispatch({ type: "lock-acquired" });
    options.lock.startHeartbeat();
    // 接管后重新走详情加载，loaded 会同时重建 form 与 baseline。
    await loadContent();
  }

  function updateForm(form: EditorFormSnapshot): void {
    dispatch({ type: "edit", form });
  }

  function toPayload(form: EditorFormSnapshot): Record<string, unknown> {
    return {
      ...form,
      tags: [...form.tags],
      category_id: form.category_id ? form.category_id : null,
    };
  }

  async function handleSessionExpired(): Promise<void> {
    if (state.phase === "closed" || state.phase === "saved") return;
    // 10003 不属于「放弃修改」：先同步落盘草稿 + 尽力释放锁，再退出到登录页；
    // 不得 clearUserDrafts，重新登录同一用户后可恢复。
    persistDraftSync();
    void options.lock.release();
    options.lock.stopHeartbeat();
    dispatch({ type: "session-expired" });
    options.onSessionExpired?.();
  }

  async function save(): Promise<void> {
    if (!canSave(state)) return;
    const verified = await options.lock.verify();
    if (verified.kind === "conflict") {
      onLockConflict(verified.conflict);
      return;
    }
    if (verified.kind === "session-expired") {
      await handleSessionExpired();
      return;
    }
    if (verified.kind !== "ok") {
      options.onError?.(verified.message || messages().lockLost);
      return;
    }
    dispatch({ type: "save" });
    const isNew = state.articleId === "new";
    let res: ApiEnvelope;
    try {
      res = await options.api.request(
        isNew ? "POST" : "PUT",
        isNew ? "/articles" : `/articles/${state.articleId}`,
        toPayload(state.form)
      );
    } catch {
      dispatch({
        type: "save-failed",
        message: messages().saveFailed,
      });
      persistDraftSync();
      return;
    }
    if (res.code === 0) {
      dispatch({ type: "save-ok" });
      clearDraftSync();
      void options.lock.release();
      options.lock.stopHeartbeat();
      options.onSaved?.();
      return;
    }
    if (res.code === SESSION_EXPIRED_CODE) {
      await handleSessionExpired();
      return;
    }
    // 保存失败：保持编辑器打开、保持锁、保留当前内容与草稿。
    dispatch({
      type: "save-failed",
      message: res.message || messages().saveFailed,
    });
    persistDraftSync();
  }

  function close(): void {
    if (state.dialog === "unsaved") return;
    if (state.dialog !== "none") {
      dispatch({ type: "close" });
      return;
    }
    const decision = closeDecision(state);
    if (decision.action === "confirm") {
      dispatch({ type: "close" });
      return;
    }
    if (decision.action === "ignore") return;
    applyCloseSideEffects(decision);
    const wasOpen = isEditorOpen(state);
    dispatch({ type: "close" });
    if (wasOpen && !isEditorOpen(state)) options.onClosed?.();
  }

  function esc(): void {
    // Esc 分层：先关最上层弹窗；没有弹窗时才触发未保存保护。
    if (state.dialog === "none") {
      const decision = closeDecision(state);
      if (decision.action === "close") applyCloseSideEffects(decision);
    }
    const wasOpen = isEditorOpen(state);
    dispatch({ type: "esc" });
    if (wasOpen && !isEditorOpen(state)) options.onClosed?.();
  }

  function discard(): void {
    applyCloseSideEffects({
      releaseLock: state.lockHeld,
      clearDraft: true,
      keepDraft: false,
    });
    dispatch({ type: "discard" });
    options.onClosed?.();
  }

  function continueEditing(): void {
    dispatch({ type: "continue" });
  }

  function openDialog(dialog: Exclude<EditorDialog, "none">): void {
    dispatch({ type: "open-dialog", dialog });
  }

  function closeDialog(): void {
    if (state.dialog !== "none") dispatch({ type: "close" });
  }

  /** 锁丢失出口：保留本地草稿后关闭（不静默丢正文）。 */
  function keepDraftAndClose(): void {
    persistDraftSync();
    void options.lock.release();
    options.lock.stopHeartbeat();
    dispatch({ type: "discard" });
    options.onClosed?.();
  }

  function handleBeforeUnload(event: UnloadEventLike): void {
    // 只提示，不再无条件释放编辑锁（释放交给 pagehide persisted===false）。
    if (!shouldBlockUnload(state)) return;
    event.preventDefault();
    event.returnValue = "";
  }

  function handlePageHide(event: PageHideEventLike): void {
    if (event.persisted === true) return;
    if (!isEditorOpen(state)) return;
    if (isEditorDirty(state)) persistDraftSync();
    void options.lock.release({ keepalive: true });
  }

  function handleKeyDown(event: KeyEventLike): void {
    if (event.key !== "Escape" || !isEditorOpen(state)) return;
    event.preventDefault();
    esc();
  }

  function attach(): void {
    if (attached || typeof window === "undefined") return;
    attached = true;
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("keydown", handleKeyDown);
  }

  function dispose(): void {
    if (attached && typeof window !== "undefined") {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("keydown", handleKeyDown);
      attached = false;
    }
    options.lock.stopHeartbeat();
    // 后台软导航卸载（非 pagehide）也要尽力释放，避免锁占满 30 分钟 TTL。
    void options.lock.release();
  }

  // 心跳 / 保存前校验发现锁被接管 → lock-lost（禁止保存，保留正文）；
  // 任一请求返回 10003 → 先落盘草稿再退出登录，不清该用户草稿。
  options.lock.setHandlers({
    onConflict: onLockConflict,
    onSessionExpired: () => {
      void handleSessionExpired();
    },
  });

  return {
    getState: () => state,
    getConflict: () => conflict,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open,
    retryLoad,
    takeover,
    updateForm,
    save,
    close,
    esc,
    discard,
    continueEditing,
    openDialog,
    closeDialog,
    keepDraftAndClose,
    sessionExpired: handleSessionExpired,
    handleBeforeUnload,
    handlePageHide,
    handleKeyDown,
    attach,
    dispose,
  };
}

/** Vue 包装：UI 只消费 state 与事件，不在组件里散落状态转移。 */
export function useArticleEditor(options: ArticleEditorOptions) {
  const core = createArticleEditor(options);
  const state = shallowRef(core.getState());
  const conflict = shallowRef(core.getConflict());
  core.subscribe((next, nextConflict) => {
    state.value = next;
    conflict.value = nextConflict;
  });
  onMounted(() => core.attach());
  onBeforeUnmount(() => core.dispose());
  return { state, conflict, core };
}
