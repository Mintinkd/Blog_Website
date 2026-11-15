/**
 * 本地草稿（GLOSSARY：本地草稿）的编辑期编排（T5 #66）。
 *
 * `draftStore.ts` 只管序列化 / 键 / 过期 / 配额；本文件补上编辑期时序：
 * - 编辑后 1.5s 防抖写入，`pagehide` / 会话失效 / 保存失败由编排器要求同步落盘；
 * - 打开文章时读取「可恢复 / 已过期」，不自动应用草稿；
 * - 超过 1MB 或 storage 拒绝写入时只提示一次（按草稿键去重）；
 * - 纯逻辑：storage / now / onNotice 都可注入，不 import Vue / DOM。
 */
import {
  clearDraft,
  draftKey,
  hashDraftBaseline,
  loadDraftWithStatus,
  saveDraft,
  type DraftForm,
  type DraftScope,
  type DraftStorage,
} from "../../utils/editor/draftStore";

export const DRAFT_DEBOUNCE_MS = 1500;

export type DraftPrompt =
  { status: "found"; savedAt: number; form: DraftForm } | { status: "expired" };

export type DraftNoticeReason = "oversize" | "storage-error";

export interface LocalDraftController {
  read(scope: DraftScope): DraftPrompt | null;
  schedule(scope: DraftScope, form: DraftForm, baseline: DraftForm): void;
  flush(scope: DraftScope, form: DraftForm, baseline: DraftForm): void;
  clear(scope: DraftScope): void;
  cancel(): void;
}

interface PendingDraft {
  scope: DraftScope;
  form: DraftForm;
  baseline: DraftForm;
}

export interface LocalDraftOptions {
  storage: DraftStorage | null;
  now: () => number;
  delayMs?: number;
  /** 配额 / 隐私模式只提示一次；由宿主映射 i18n 文案。 */
  onNotice?: (reason: DraftNoticeReason) => void;
}

export function createLocalDraftController(
  options: LocalDraftOptions
): LocalDraftController {
  const delayMs = options.delayMs ?? DRAFT_DEBOUNCE_MS;
  const notified = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PendingDraft | null = null;

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  }

  function notifyOnce(scope: DraftScope, reason: DraftNoticeReason): void {
    const key = draftKey(scope);
    if (notified.has(key)) return;
    notified.add(key);
    options.onNotice?.(reason);
  }

  function persist(pendingDraft: PendingDraft): void {
    if (!options.storage) return;
    const result = saveDraft(
      options.storage,
      pendingDraft.scope,
      pendingDraft.form,
      {
        savedAt: options.now(),
        baselineHash: hashDraftBaseline(pendingDraft.baseline),
      }
    );
    if (
      !result.ok &&
      (result.reason === "oversize" || result.reason === "storage-error")
    ) {
      notifyOnce(pendingDraft.scope, result.reason);
    }
  }

  return {
    read(scope) {
      if (!options.storage) return null;
      const result = loadDraftWithStatus(options.storage, scope, {
        now: options.now(),
      });
      if (result.status === "found") {
        return {
          status: "found",
          savedAt: result.draft.savedAt,
          form: result.draft.form,
        };
      }
      if (result.status === "expired") return { status: "expired" };
      return null;
    },

    schedule(scope, form, baseline) {
      if (!options.storage) return;
      cancel();
      pending = {
        scope,
        form: { ...form, tags: [...form.tags] },
        baseline: { ...baseline, tags: [...baseline.tags] },
      };
      timer = setTimeout(() => {
        const next = pending;
        timer = null;
        pending = null;
        if (next) persist(next);
      }, delayMs);
    },

    flush(scope, form, baseline) {
      cancel();
      persist({ scope, form, baseline });
    },

    clear(scope) {
      cancel();
      if (!options.storage) return;
      clearDraft(options.storage, scope);
      notified.delete(draftKey(scope));
    },

    cancel,
  };
}
