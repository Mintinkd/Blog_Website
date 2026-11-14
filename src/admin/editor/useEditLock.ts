/**
 * 编辑锁（GLOSSARY：编辑锁）的获取 / 心跳 / 保存前校验 / 释放。
 *
 * 契约见 docs/ARTICLE_EDITOR_UPGRADE.md §5.4 与 docs/adr/0006：
 * - 打开编辑前 `POST /articles/:id/edit-lock`；冲突保留「被 X 编辑 / 管理员强制接管」流程；
 * - 打开后每 10 分钟用同一接口续期（同一用户重取即续期），页面隐藏不停止计时；
 * - 保存前再校验一次持有权，冲突则禁止保存；
 * - 显式关闭 / 取消 / 保存成功 / 放弃修改才释放；`beforeunload` 不释放（由 useArticleEditor 负责只提示）。
 *
 * `createEditLock` 不 import Vue / DOM：fetch 与定时器都可注入或被 fake timers 接管，
 * 因此心跳、释放、保存前校验能在 node vitest 里用 mock fetch 全链路测，而不只是测 reducer。
 * `useEditLock` 只是给组件用的 Vue 薄包装（卸载时停心跳，不擅自释放锁）。
 */
import { onBeforeUnmount } from "vue";

export const EDIT_LOCK_HEARTBEAT_MS = 10 * 60 * 1000;
export const LOCK_CONFLICT_CODE = 10006;
export const SESSION_EXPIRED_CODE = 10003;

export interface LockConflict {
  holder_name: string;
  expires_at: string;
  message: string;
}

export type LockOutcome =
  | { kind: "ok" }
  | { kind: "conflict"; conflict: LockConflict }
  | { kind: "session-expired" }
  | { kind: "error"; message: string };

export interface EditLockOptions {
  /** 默认 "/api/v1"；调用方按环境注入 `PUBLIC_API_BASE`。 */
  apiBase?: string;
  fetchImpl?: typeof fetch;
  getToken: () => string;
  /** 心跳或保存前校验发现锁已被接管时触发（禁止保存）。 */
  onConflict?: (conflict: LockConflict) => void;
  onSessionExpired?: () => void;
}

export interface EditLock {
  readonly held: boolean;
  readonly articleId: number | null;
  acquire(articleId: number): Promise<LockOutcome>;
  /** 保存前校验持有权：复用 POST 语义（同用户重取即续期）。 */
  verify(): Promise<LockOutcome>;
  /** admin 强制接管：先 force 释放，再重新获取（force 接口本身不授予锁）。 */
  forceTakeover(articleId: number): Promise<LockOutcome>;
  release(options?: { keepalive?: boolean }): Promise<void>;
  startHeartbeat(): void;
  stopHeartbeat(): void;
  /** 运行期绑定失锁 / 会话失效回调，供 useArticleEditor 在创建后接管。 */
  setHandlers(handlers: {
    onConflict?: (conflict: LockConflict) => void;
    onSessionExpired?: () => void;
  }): void;
}

interface Envelope {
  code?: number;
  message?: string;
  data?: {
    holder_name?: string;
    expires_at?: string;
  } | null;
}

function toConflict(payload: Envelope): LockConflict {
  return {
    holder_name: payload.data?.holder_name || "?",
    expires_at: payload.data?.expires_at || "",
    message: payload.message || "",
  };
}

export function createEditLock(options: EditLockOptions): EditLock {
  const apiBase = options.apiBase ?? "/api/v1";
  const fetchImpl: typeof fetch =
    options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  let articleId: number | null = null;
  let held = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let handlers: {
    onConflict?: (conflict: LockConflict) => void;
    onSessionExpired?: () => void;
  } = {
    onConflict: options.onConflict,
    onSessionExpired: options.onSessionExpired,
  };

  async function request(
    method: "POST" | "DELETE",
    path: string,
    keepalive = false
  ): Promise<LockOutcome> {
    try {
      const res = await fetchImpl(`${apiBase}${path}`, {
        method,
        headers: { Authorization: `Bearer ${options.getToken()}` },
        keepalive,
      });
      const payload = (await res.json()) as Envelope;
      if (payload.code === 0) return { kind: "ok" };
      if (payload.code === LOCK_CONFLICT_CODE) {
        return { kind: "conflict", conflict: toConflict(payload) };
      }
      if (payload.code === SESSION_EXPIRED_CODE) {
        handlers.onSessionExpired?.();
        return { kind: "session-expired" };
      }
      return { kind: "error", message: payload.message || "" };
    } catch {
      return { kind: "error", message: "" };
    }
  }

  function conflictFound(conflict: LockConflict): LockOutcome {
    held = false;
    stopHeartbeat();
    handlers.onConflict?.(conflict);
    return { kind: "conflict", conflict };
  }

  async function acquire(id: number): Promise<LockOutcome> {
    const outcome = await request("POST", `/articles/${id}/edit-lock`);
    if (outcome.kind === "ok") {
      articleId = id;
      held = true;
      return outcome;
    }
    if (outcome.kind === "conflict") {
      // 打开时的冲突由 useArticleEditor 转成 lock-conflict 态（接管 / 取消）；
      // onConflict 只通知「编辑过程中」的心跳 / 保存前校验失锁。
      held = false;
      return outcome;
    }
    return outcome;
  }

  async function verify(): Promise<LockOutcome> {
    // 新建文章没有服务端锁，保存前无需校验（reducer 里的 lockHeld 是逻辑持锁）。
    if (articleId === null) return { kind: "ok" };
    const outcome = await request("POST", `/articles/${articleId}/edit-lock`);
    if (outcome.kind === "conflict") return conflictFound(outcome.conflict);
    return outcome;
  }

  async function forceTakeover(id: number): Promise<LockOutcome> {
    try {
      const res = await fetchImpl(`${apiBase}/articles/${id}/edit-lock/force`, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.getToken()}` },
      });
      const payload = (await res.json()) as Envelope;
      if (payload.code !== 0) {
        return { kind: "error", message: payload.message || "" };
      }
    } catch {
      return { kind: "error", message: "" };
    }
    return acquire(id);
  }

  async function release(opts?: { keepalive?: boolean }): Promise<void> {
    if (!held || articleId === null) return;
    const id = articleId;
    // 先置位：并发的取消 / 保存成功 / pagehide 只会发一次 DELETE。
    held = false;
    articleId = null;
    stopHeartbeat();
    await request(
      "DELETE",
      `/articles/${id}/edit-lock`,
      opts?.keepalive === true
    );
  }

  function stopHeartbeat(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function startHeartbeat(): void {
    stopHeartbeat();
    timer = setInterval(() => {
      if (articleId === null || !held) return;
      void request("POST", `/articles/${articleId}/edit-lock`).then(
        (outcome) => {
          if (outcome.kind === "conflict") conflictFound(outcome.conflict);
          if (outcome.kind === "session-expired") stopHeartbeat();
        }
      );
    }, EDIT_LOCK_HEARTBEAT_MS);
  }

  return {
    get held() {
      return held;
    },
    get articleId() {
      return articleId;
    },
    acquire,
    verify,
    forceTakeover,
    release,
    startHeartbeat,
    stopHeartbeat,
    setHandlers(next) {
      handlers = { ...handlers, ...next };
    },
  };
}

/** 组件包装：卸载只停心跳，释放锁由 useArticleEditor 的关闭决策统一执行。 */
export function useEditLock(options: EditLockOptions): EditLock {
  const lock = createEditLock(options);
  onBeforeUnmount(() => lock.stopHeartbeat());
  return lock;
}
