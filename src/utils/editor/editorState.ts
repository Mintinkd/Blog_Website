/**
 * useArticleEditor 的纯 reducer 与关闭决策（Vue 包装由 T3 的
 * src/admin/editor/useArticleEditor.ts 提供，本文件不 import Vue / DOM）。
 *
 * 状态机见 docs/ARTICLE_EDITOR_UPGRADE.md §7。脏状态是「当前表单 vs 加载基线」
 * 的派生值，不另存 dirty 字段，避免两份状态漂移（GLOSSARY：单一事实源）。
 * reducer 不执行副作用：释放锁、清理 / 保留草稿、写 beforeunload 提示都由 UI
 * 依据 closeDecision 与状态转移结果执行。
 */
import type { DraftArticleId, DraftForm } from "./draftStore";

/** 与 draftStore.DraftForm 共享同一表单形状，避免两处定义漂移。 */
export type EditorFormSnapshot = DraftForm;

export type EditorPhase =
  | "closed"
  | "acquiring-lock"
  | "lock-conflict"
  | "loading-content"
  | "load-error"
  | "ready"
  | "saving"
  | "saved"
  | "lock-lost";

export type EditorDialog = "none" | "link" | "preview" | "unsaved";

export interface EditorState {
  phase: EditorPhase;
  articleId: DraftArticleId | null;
  form: EditorFormSnapshot;
  baseline: EditorFormSnapshot;
  dialog: EditorDialog;
  lockHeld: boolean;
  error: string | null;
}

export type EditorEvent =
  | { type: "open"; articleId: DraftArticleId }
  | { type: "lock-acquired" }
  | { type: "lock-conflict" }
  | { type: "lock-retry" }
  | { type: "loaded"; form: EditorFormSnapshot }
  | { type: "load-failed"; message: string }
  | { type: "retry-load" }
  | { type: "edit"; form: EditorFormSnapshot }
  | { type: "save" }
  | { type: "save-ok" }
  | { type: "save-failed"; message: string }
  | { type: "lock-lost" }
  | { type: "open-dialog"; dialog: Exclude<EditorDialog, "none"> }
  | { type: "esc" }
  | { type: "close" }
  | { type: "discard" }
  | { type: "continue" }
  | { type: "session-expired" };

export interface CloseDecision {
  action: "close" | "confirm" | "ignore";
  /** 需要 UI 调用 DELETE /edit-lock。 */
  releaseLock: boolean;
  /** 需要 UI 清除该文章草稿。 */
  clearDraft: boolean;
  /** 需要 UI 保留 / 同步落盘草稿（脏状态、锁丢失、会话失效）。 */
  keepDraft: boolean;
}

export function emptyEditorForm(): EditorFormSnapshot {
  return {
    title: "",
    slug: "",
    summary: "",
    content: "",
    cover_image: "",
    category_id: "",
    status: "draft",
    tags: [],
  };
}

export function initialEditorState(): EditorState {
  return {
    phase: "closed",
    articleId: null,
    form: emptyEditorForm(),
    baseline: emptyEditorForm(),
    dialog: "none",
    lockHeld: false,
    error: null,
  };
}

function copyForm(form: EditorFormSnapshot): EditorFormSnapshot {
  return { ...form, tags: [...form.tags] };
}

const FORM_FIELDS: (keyof EditorFormSnapshot)[] = [
  "title",
  "slug",
  "summary",
  "content",
  "cover_image",
  "category_id",
  "status",
];

/** 脏状态 = 表单字段或正文与加载基线不同；tags 顺序敏感，不做静默归一化。 */
export function isEditorDirty(state: EditorState): boolean {
  if (FORM_FIELDS.some((key) => state.form[key] !== state.baseline[key])) {
    return true;
  }
  return (
    state.form.tags.length !== state.baseline.tags.length ||
    state.form.tags.some((tag, index) => tag !== state.baseline.tags[index])
  );
}

export function isEditorOpen(state: EditorState): boolean {
  return state.phase !== "closed" && state.phase !== "saved";
}

/**
 * 保存守卫：仅 ready、持锁时可保存；链接 / 线上预览弹窗遮挡时不可保存。
 * `unsaved` 弹窗例外 —— 它的「保存并关闭」本身就是合法保存入口。
 * 锁丢失 / 加载失败一律禁止保存。
 */
export function canSave(state: EditorState): boolean {
  return (
    state.phase === "ready" &&
    state.lockHeld &&
    (state.dialog === "none" || state.dialog === "unsaved")
  );
}

export function shouldBlockUnload(state: EditorState): boolean {
  return isEditorOpen(state) && isEditorDirty(state);
}

/**
 * 关闭 / 取消 / Esc 的统一决策：
 * - 脏状态 → 弹未保存确认，保留锁与草稿；
 * - 干净状态 → 直接关闭，释放锁并清草稿；
 * - 已关闭 / 已保存 → 忽略。
 */
export function closeDecision(state: EditorState): CloseDecision {
  if (!isEditorOpen(state)) {
    return {
      action: "ignore",
      releaseLock: false,
      clearDraft: false,
      keepDraft: false,
    };
  }
  if (isEditorDirty(state)) {
    return {
      action: "confirm",
      releaseLock: false,
      clearDraft: false,
      keepDraft: true,
    };
  }
  return {
    action: "close",
    releaseLock: state.lockHeld,
    clearDraft: true,
    keepDraft: false,
  };
}

export function reduceEditorState(
  state: EditorState,
  event: EditorEvent
): EditorState {
  switch (event.type) {
    case "open":
      return {
        ...initialEditorState(),
        phase: "acquiring-lock",
        articleId: event.articleId,
      };

    case "lock-acquired":
      if (state.phase !== "acquiring-lock") return state;
      return { ...state, phase: "loading-content", lockHeld: true };

    case "lock-conflict":
      if (state.phase !== "acquiring-lock") return state;
      return { ...state, phase: "lock-conflict", lockHeld: false };

    case "lock-retry":
      if (state.phase !== "lock-conflict") return state;
      return { ...state, phase: "acquiring-lock" };

    case "loaded":
      if (state.phase !== "loading-content") return state;
      return {
        ...state,
        phase: "ready",
        form: copyForm(event.form),
        baseline: copyForm(event.form),
        error: null,
      };

    case "load-failed":
      if (state.phase !== "loading-content") return state;
      return { ...state, phase: "load-error", error: event.message };

    case "retry-load":
      if (state.phase !== "load-error") return state;
      return { ...state, phase: "loading-content", error: null };

    case "edit":
      // 加载失败 / 未加载完成不得进入可编辑状态；锁丢失仍允许改字并复制正文。
      if (state.phase !== "ready" && state.phase !== "lock-lost") return state;
      return { ...state, form: copyForm(event.form) };

    case "save":
      if (!canSave(state)) return state;
      return { ...state, phase: "saving", dialog: "none", error: null };

    case "save-ok":
      if (state.phase !== "saving") return state;
      return {
        ...state,
        phase: "saved",
        lockHeld: false,
        dialog: "none",
        error: null,
      };

    case "save-failed":
      if (state.phase !== "saving") return state;
      // 保存失败不关闭编辑器、不释放锁、不丢内容；草稿由 UI 依据脏状态保留。
      return { ...state, phase: "ready", dialog: "none", error: event.message };

    case "lock-lost":
      if (!isEditorOpen(state) || state.phase === "lock-lost") return state;
      return { ...state, phase: "lock-lost", lockHeld: false };

    case "open-dialog":
      if (!isEditorOpen(state)) return state;
      return { ...state, dialog: event.dialog };

    case "esc": {
      // Esc 分层：先关最上层弹窗，没有弹窗才触发未保存保护。
      if (state.dialog !== "none") {
        return { ...state, dialog: "none" };
      }
      const decision = closeDecision(state);
      if (decision.action === "confirm") {
        return { ...state, dialog: "unsaved" };
      }
      if (decision.action === "ignore") return state;
      return { ...state, phase: "closed", lockHeld: false, dialog: "none" };
    }

    case "close": {
      if (state.dialog === "unsaved") return state;
      if (state.dialog !== "none") return { ...state, dialog: "none" };
      const decision = closeDecision(state);
      if (decision.action === "confirm") {
        return { ...state, dialog: "unsaved" };
      }
      if (decision.action === "ignore") return state;
      return { ...state, phase: "closed", lockHeld: false };
    }

    case "discard":
      return { ...state, phase: "closed", lockHeld: false, dialog: "none" };

    case "continue":
      return { ...state, dialog: "none" };

    case "session-expired":
      // 10003 不属于放弃修改：保留 form / baseline 供 UI 同步落盘草稿，
      // 不得在此清草稿，重新登录同一用户后可恢复。
      return { ...state, phase: "closed", lockHeld: false, dialog: "none" };

    default:
      return state;
  }
}
