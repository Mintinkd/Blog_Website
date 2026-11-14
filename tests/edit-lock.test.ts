// @vitest-environment node
/**
 * 编辑锁（GLOSSARY：编辑锁）心跳 / 释放 / 保存前校验 / 强制接管 / 会话失效。
 *
 * 按 docs/agents/testing.md：不能只测 reducer —— fetch 用 mock、定时器用 fake timers，
 * 断言真实发出的 URL / method / keepalive 与回调。期望值全部手写字面量。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEditLock,
  EDIT_LOCK_HEARTBEAT_MS,
  type LockOutcome,
} from "../src/admin/editor/useEditLock";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface Call {
  url: string;
  init: RequestInit;
}

function jsonResponse(payload: unknown): Response {
  return { json: async () => payload } as unknown as Response;
}

function ok(): Response {
  return jsonResponse({ code: 0, message: "ok", data: null });
}

function setup(
  responder: (url: string, init: RequestInit, callIndex: number) => Response
) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const response = responder(url, init, calls.length);
    calls.push({ url, init });
    return response;
  });
  return {
    calls,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  };
}

const BEARER = { Authorization: "Bearer regression-token" };

describe("createEditLock", () => {
  it("10 分钟心跳用同一 POST 续期，停止后不再续期", async () => {
    vi.useFakeTimers();
    const { calls, fetchImpl } = setup(() => ok());
    const lock = createEditLock({
      fetchImpl,
      getToken: () => "regression-token",
    });
    const outcome: LockOutcome = await lock.acquire(42);

    expect(outcome).toEqual({ kind: "ok" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/v1/articles/42/edit-lock");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual(BEARER);

    lock.startHeartbeat();
    await vi.advanceTimersByTimeAsync(EDIT_LOCK_HEARTBEAT_MS - 1);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe("/api/v1/articles/42/edit-lock");
    expect(calls[1].init.method).toBe("POST");

    lock.stopHeartbeat();
    await vi.advanceTimersByTimeAsync(EDIT_LOCK_HEARTBEAT_MS * 2);
    expect(calls).toHaveLength(2);
  });

  it("释放只发一次 DELETE，keepalive 按调用方传入", async () => {
    const { calls, fetchImpl } = setup(() => ok());
    const lock = createEditLock({
      fetchImpl,
      getToken: () => "regression-token",
    });
    await lock.acquire(7);
    await lock.release({ keepalive: true });

    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe("/api/v1/articles/7/edit-lock");
    expect(calls[1].init.method).toBe("DELETE");
    expect(calls[1].init.keepalive).toBe(true);
    expect(lock.held).toBe(false);

    await lock.release();
    expect(calls).toHaveLength(2);
  });

  it("保存前校验冲突：禁止保存、清除持有态并通知失锁", async () => {
    const conflictPayload = {
      code: 10006,
      message: "文章正在被小明编辑",
      data: null,
    };
    const { calls, fetchImpl } = setup((_url, _init, index) =>
      index === 0 ? ok() : jsonResponse(conflictPayload)
    );
    const onConflict = vi.fn();
    const lock = createEditLock({
      fetchImpl,
      getToken: () => "regression-token",
      onConflict,
    });
    await lock.acquire(42);
    const outcome = await lock.verify();

    expect(outcome.kind).toBe("conflict");
    expect(outcome).toEqual({
      kind: "conflict",
      conflict: {
        holder_name: "?",
        expires_at: "",
        message: "文章正在被小明编辑",
      },
    });
    expect(lock.held).toBe(false);
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(calls[1].url).toBe("/api/v1/articles/42/edit-lock");
    expect(calls[1].init.method).toBe("POST");
  });

  it("心跳冲突立即停表并通知失锁，不再续期", async () => {
    vi.useFakeTimers();
    const conflictPayload = { code: 10006, message: "被接管", data: null };
    const { calls, fetchImpl } = setup((_url, _init, index) =>
      index < 2 ? ok() : jsonResponse(conflictPayload)
    );
    const onConflict = vi.fn();
    const lock = createEditLock({
      fetchImpl,
      getToken: () => "regression-token",
      onConflict,
    });
    await lock.acquire(9);
    lock.startHeartbeat();
    // 第一次心跳成功，第二次冲突。
    await vi.advanceTimersByTimeAsync(EDIT_LOCK_HEARTBEAT_MS);
    expect(onConflict).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(EDIT_LOCK_HEARTBEAT_MS);
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(lock.held).toBe(false);
    await vi.advanceTimersByTimeAsync(EDIT_LOCK_HEARTBEAT_MS * 2);
    expect(calls).toHaveLength(3);
  });

  it("强制接管先 force 再重新获取锁", async () => {
    const { calls, fetchImpl } = setup(() => ok());
    const lock = createEditLock({
      fetchImpl,
      getToken: () => "regression-token",
    });
    const outcome = await lock.forceTakeover(42);

    expect(outcome).toEqual({ kind: "ok" });
    expect(calls.map((call) => call.url)).toEqual([
      "/api/v1/articles/42/edit-lock/force",
      "/api/v1/articles/42/edit-lock",
    ]);
    expect(calls.map((call) => call.init.method)).toEqual(["POST", "POST"]);
    expect(lock.held).toBe(true);
  });

  it("10003 触发会话失效回调，不视为普通错误", async () => {
    const { fetchImpl } = setup(() =>
      jsonResponse({ code: 10003, message: "登录已失效", data: null })
    );
    const onSessionExpired = vi.fn();
    const lock = createEditLock({
      fetchImpl,
      getToken: () => "regression-token",
      onSessionExpired,
    });
    const outcome = await lock.acquire(42);

    expect(outcome).toEqual({ kind: "session-expired" });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    expect(lock.held).toBe(false);
  });

  it("打开时冲突不触发失锁回调，交给编排器转 lock-conflict 态", async () => {
    const { fetchImpl } = setup(() =>
      jsonResponse({ code: 10006, message: "被占用", data: null })
    );
    const onConflict = vi.fn();
    const lock = createEditLock({
      fetchImpl,
      getToken: () => "regression-token",
      onConflict,
    });
    const outcome = await lock.acquire(42);

    expect(outcome.kind).toBe("conflict");
    expect(onConflict).toHaveBeenCalledTimes(0);
    expect(lock.held).toBe(false);
  });
});
