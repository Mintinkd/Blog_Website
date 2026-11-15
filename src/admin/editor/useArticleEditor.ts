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
 * T4 #65 起，本编排器还持有回写守卫状态（加载判定 / 模式切换 / 保存前二次守卫），
 * 由 T4 的 markdownBridge 纯函数判定，WYSIWYG 有损保存在此被真正阻止，
 * 而不是只留一个孤立的守卫模块；guard 未注入时 T3 行为完全不变。
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
  normalizeArticleId,
  reduceEditorState,
  shouldBlockUnload,
  type EditorDialog,
  type EditorEvent,
  type EditorFormSnapshot,
  type EditorState,
} from "../../utils/editor/editorState";
import type { DraftStorage } from "../../utils/editor/draftStore";
import {
  createLocalDraftController,
  type DraftNoticeReason,
  type DraftPrompt,
} from "./useLocalDraft";
import {
  classifyRoundTrip,
  decideInitialMode,
  guardWysiwygSave,
  type EditorMode,
} from "../../utils/editor/markdownBridge";
import {
  SESSION_EXPIRED_CODE,
  type EditLock,
  type LockConflict,
} from "./useEditLock";

/** 与 Worker 的 ArticleEditDetail 对齐的手写投影；不跨包 import Worker 类型。 */
export interface ArticleEditDetailLike {
  id?: number;
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
  /** T4 #65：lossy 自动进源码模式的提示（i18n 由宿主注入）。 */
  guardLossy?: string;
  /** T4 #65：WYSIWYG 保存被守卫阻止时的提示。 */
  guardBlocked?: string;
  /** T5 #66：本地草稿超过 1MB 被跳过（同一草稿只提示一次）。 */
  draftOversize?: string;
  /** T5 #66：localStorage 拒绝写入（配额 / 隐私模式）。 */
  draftStorageError?: string;
}

const DEFAULT_MESSAGES: EditorMessages = {
  loadFailed: "加载失败",
  saveFailed: "保存失败",
  lockFailed: "获取编辑锁失败",
  lockLost: "编辑锁已被接管",
  guardLossy: "该文章包含所见即所得无法无损表示的语法，已在源码模式打开",
  guardBlocked: "保存前守卫仍判定有损，请在源码模式保存",
  draftOversize: "本地草稿超过 1MB，已跳过保存",
  draftStorageError: "浏览器拒绝写入本地草稿，请检查隐私模式或存储空间",
};

/**
 * 回写守卫与 WYSIWYG 内核之间的接缝：往返只做「解析 → 立即序列化」，
 * 不写回正文；render 是同一 `renderMarkdown` 管线。两者都可注入，
 * 因此 node 环境的编排测试不需要 DOM / Milkdown。
 */
export interface EditorGuardAdapter {
  roundTrip(markdown: string): Promise<string>;
  render(markdown: string): string;
}

export type EditorGuardStatus = "unchecked" | "safe" | "lossy";

/** UI 消费的守卫快照：模式、判定、是否显式覆盖、提示文案。 */
export interface EditorGuardState {
  mode: EditorMode;
  status: EditorGuardStatus;
  override: boolean;
  message: string;
}

export function initialGuardState(): EditorGuardState {
  return { mode: "wysiwyg", status: "unchecked", override: false, message: "" };
}

export interface ArticleEditorOptions {
  /** 数字用于固定会话；函数形式支持登录后 userId 才就绪（后台首屏无 token）。 */
  userId: number | (() => number);
  api: EditorApi;
  lock: EditLock;
  storage?: DraftStorage | null;
  now?: () => number;
  /** 不传则完全保持 T3 行为（无守卫、模式默认 WYSIWYG 由 UI 决定）。 */
  guard?: EditorGuardAdapter | null;
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
  getGuard(): EditorGuardState;
  getDraftPrompt(): DraftPrompt | null;
  subscribe(
    listener: (
      state: EditorState,
      conflict: LockConflict | null,
      guard: EditorGuardState,
      draft: DraftPrompt | null
    ) => void
  ): () => void;
  open(
    article: { id: number } | null,
    prefill?: EditorFormSnapshot
  ): Promise<void>;
  retryLoad(): Promise<void>;
  takeover(): Promise<void>;
  updateForm(form: EditorFormSnapshot): void;
  /** 模式切换守卫：切到 WYSIWYG 时重新判定，lossy 且未覆盖则保持源码模式。 */
  setEditorMode(mode: EditorMode, override?: boolean): Promise<void>;
  /** 作者显式覆盖 lossy 判定进 WYSIWYG；保存前守卫仍独立执行。 */
  overrideGuard(): Promise<void>;
  /** 正文被外部替换（草稿恢复 / 接管重建基线）后重新执行加载判定。 */
  reevaluateGuard(): Promise<void>;
  /** T5：把提示中的草稿写入表单（保留服务端基线），并重新执行回写守卫。 */
  restoreDraft(): Promise<void>;
  /** T5：丢弃提示中的草稿 / 关闭过期提示。 */
  discardDraft(): void;
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
  let guard = initialGuardState();
  let draftPrompt: DraftPrompt | null = null;
  let currentArticle: { id: number } | null = null;
  const listeners = new Set<
    (
      next: EditorState,
      lockConflict: LockConflict | null,
      nextGuard: EditorGuardState,
      nextDraft: DraftPrompt | null
    ) => void
  >();
  let attached = false;

  function resolveUserId(): number {
    return typeof options.userId === "function"
      ? options.userId()
      : options.userId;
  }

  function draftNoticeMessage(reason: DraftNoticeReason): string {
    return reason === "oversize"
      ? (messages().draftOversize ?? DEFAULT_MESSAGES.draftOversize ?? "")
      : (messages().draftStorageError ??
          DEFAULT_MESSAGES.draftStorageError ??
          "");
  }

  const drafts = createLocalDraftController({
    storage: options.storage ?? null,
    now,
    onNotice: (reason) => options.onError?.(draftNoticeMessage(reason)),
  });

  function notify(): void {
    listeners.forEach((listener) =>
      listener(state, conflict, guard, draftPrompt)
    );
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
      userId: resolveUserId(),
      articleId: state.articleId ?? "new",
    };
  }

  function setDraftPrompt(next: DraftPrompt | null): void {
    if (next === draftPrompt) return;
    draftPrompt = next;
    notify();
  }

  /** 同步落盘：会话失效 / pagehide / 锁丢失都必须在退出前写完，不能用防抖。 */
  function persistDraftSync(): void {
    if (!options.storage || !isEditorOpen(state)) return;
    drafts.flush(draftScope(), state.form, state.baseline);
  }

  function clearDraftSync(): void {
    if (!options.storage) return;
    drafts.clear(draftScope());
  }

  /** 只在打开且有未保存修改时安排 1.5s 防抖写入；改回基线则取消。 */
  function scheduleDraft(): void {
    if (!options.storage) return;
    if (!isEditorOpen(state) || !isEditorDirty(state)) {
      drafts.cancel();
      return;
    }
    drafts.schedule(draftScope(), state.form, state.baseline);
  }

  /** 打开 / 重试 / 接管加载完正文后读取草稿，只提示，不自动应用。 */
  function readDraftPrompt(): void {
    if (!options.storage || !isEditorOpen(state)) return;
    setDraftPrompt(drafts.read(draftScope()));
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

  /** 对「当前正文」做一次编辑器往返 + 语义比较，不写回任何状态。 */
  async function classifyCurrent() {
    const adapter = options.guard!;
    return classifyRoundTrip(
      state.form.content,
      adapter.roundTrip,
      adapter.render
    );
  }

  /**
   * 加载判定：lossy 默认进源码模式并提示；此处只改守卫快照，
   * `form.content` / `baseline` 保持原始字节（打开未编辑不改正文）。
   */
  async function runInitialGuard(): Promise<void> {
    if (!options.guard) return;
    const classification = await classifyCurrent();
    guard = {
      mode: decideInitialMode(classification),
      status: classification.kind,
      override: false,
      message:
        classification.kind === "lossy"
          ? (messages().guardLossy ?? DEFAULT_MESSAGES.guardLossy ?? "")
          : "",
    };
    notify();
  }

  /**
   * 模式切换守卫：切回 WYSIWYG 时重新判定；显式覆盖只放行「编辑」，
   * 保存前守卫仍会独立再判定一次，失败必须阻止保存。
   */
  async function setEditorMode(
    mode: EditorMode,
    override = false
  ): Promise<void> {
    if (mode === "source") {
      guard = { ...guard, mode: "source", override: false, message: "" };
      notify();
      return;
    }
    if (!options.guard) {
      guard = { ...guard, mode: "wysiwyg", message: "" };
      notify();
      return;
    }
    const classification = await classifyCurrent();
    const nextMode = decideInitialMode(classification, override);
    guard = {
      mode: nextMode,
      status: classification.kind,
      override: override && nextMode === "wysiwyg",
      message:
        classification.kind === "lossy"
          ? override
            ? (messages().guardBlocked ?? DEFAULT_MESSAGES.guardBlocked ?? "")
            : (messages().guardLossy ?? DEFAULT_MESSAGES.guardLossy ?? "")
          : "",
    };
    notify();
  }

  async function loadContent(prefill?: EditorFormSnapshot): Promise<void> {
    if (!currentArticle) {
      dispatch({
        type: "loaded",
        form: prefill
          ? { ...prefill, tags: [...prefill.tags] }
          : emptyEditorForm(),
      });
      await runInitialGuard();
      readDraftPrompt();
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
    // 打开 / 重试 / 强制接管都重新执行加载判定，草稿恢复由 reevaluateGuard 触发。
    await runInitialGuard();
    readDraftPrompt();
  }

  async function open(
    article: { id: number } | null,
    prefill?: EditorFormSnapshot
  ): Promise<void> {
    drafts.cancel();
    setDraftPrompt(null);
    await options.lock.release();
    options.lock.stopHeartbeat();
    conflict = null;
    guard = initialGuardState();
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
    scheduleDraft();
  }

  /**
   * T5 #66 草稿恢复：只替换表单，基线保持服务端加载值（因此立即变脏、关闭需保护）。
   * 恢复的正文来自旧版本，必须重新跑回写守卫；lossy 时由守卫切到源码模式。
   */
  async function restoreDraft(): Promise<void> {
    const prompt = draftPrompt;
    if (!prompt || prompt.status !== "found") return;
    if (state.phase !== "ready" && state.phase !== "lock-lost") return;
    // 先取消可能仍挂着旧表单的防抖任务，避免它晚到覆盖恢复后的正文。
    drafts.cancel();
    dispatch({
      type: "edit",
      form: { ...prompt.form, tags: [...prompt.form.tags] },
    });
    setDraftPrompt(null);
    await runInitialGuard();
    scheduleDraft();
  }

  /** T5 #66 丢弃草稿 / 关闭过期提示；不改动服务端加载出的表单。 */
  function discardDraft(): void {
    if (!draftPrompt) return;
    if (draftPrompt.status === "found") clearDraftSync();
    else drafts.cancel();
    setDraftPrompt(null);
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
    // T4 #65 保存前二次守卫：源码模式放行；WYSIWYG 用「当前正文」重新往返判定，
    // 不复用加载时的结论，显式覆盖过 lossy 也不会放行。阻止时保持编辑器打开、
    // 保持锁、不发 PUT / POST，也不改 phase（票面「不能静默改写」）。
    if (options.guard && guard.mode === "wysiwyg") {
      const classification = await classifyCurrent();
      const decision = guardWysiwygSave({
        mode: guard.mode,
        classification,
        override: guard.override,
      });
      guard = { ...guard, status: classification.kind };
      if (decision.blocked) {
        guard = {
          ...guard,
          message:
            messages().guardBlocked ??
            DEFAULT_MESSAGES.guardBlocked ??
            decision.reason,
        };
        notify();
        options.onError?.(guard.message);
        return;
      }
      guard = { ...guard, message: "" };
      notify();
    }
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
      // 新建文章成功后记录服务端 id；草稿键在 dispatch 前按旧 scope（new）清除，
      // 避免下次新建误恢复旧内容。迁移或清除都满足 §5.5，这里选择清除。
      const savedId = isNew ? normalizeArticleId(res.data?.id) : undefined;
      drafts.cancel();
      clearDraftSync();
      dispatch({ type: "save-ok", articleId: savedId });
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
    if (!isEditorOpen(state)) {
      drafts.cancel();
      return;
    }
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
    drafts.cancel();
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
    getGuard: () => guard,
    getDraftPrompt: () => draftPrompt,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open,
    retryLoad,
    takeover,
    updateForm,
    setEditorMode,
    overrideGuard: () => setEditorMode("wysiwyg", true),
    reevaluateGuard: runInitialGuard,
    restoreDraft,
    discardDraft,
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
  const guard = shallowRef(core.getGuard());
  const draft = shallowRef(core.getDraftPrompt());
  core.subscribe((next, nextConflict, nextGuard, nextDraft) => {
    state.value = next;
    conflict.value = nextConflict;
    guard.value = nextGuard;
    draft.value = nextDraft;
  });
  onMounted(() => core.attach());
  onBeforeUnmount(() => core.dispose());
  return { state, conflict, guard, draft, core };
}
