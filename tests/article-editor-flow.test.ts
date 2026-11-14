// @vitest-environment node
/**
 * 文章编辑器显式状态机的 UI 编排行为锁（T3 #64）。
 *
 * 纯 reducer 的脏状态 / 关闭决策 / 保存失败 / 锁丢失已由 tests/editor-state.test.ts
 * 钉住；本文件只测「T1 reducer 不覆盖」的副作用编排：加载失败不可编辑、
 * 保存失败保持打开与锁、pagehide 释放、beforeunload 只提示、Esc 分层、
 * 保存前锁校验、强制接管重建基线、10003 落盘草稿、新建文章不抢锁。
 *
 * 按 docs/agents/testing.md：期望值全部手写字面量，服务端用可编程 stub，
 * 不挂载 Vue / DOM，也不访问真实 Worker。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createArticleEditor } from "../src/admin/editor/useArticleEditor";
import { createEditLock } from "../src/admin/editor/useEditLock";
import { emptyEditorForm } from "../src/utils/editor/editorState";
import type { DraftStorage } from "../src/utils/editor/draftStore";

const DETAIL = {
  title: "已发布文章",
  slug: "published-post",
  content: "# 正文",
  summary: "摘要",
  cover_image: "",
  category_id: 3,
  tags: [{ name: "标签A" }],
  status: "published",
};

interface FetchCall {
  url: string;
  init: RequestInit;
}

interface ApiCall {
  method: string;
  path: string;
  body?: unknown;
}

interface SetupOptions {
  detailFailFirst?: boolean;
  detailCode?: number;
  saveCode?: number;
  acquireConflictFirst?: boolean;
  verifyConflict?: boolean;
}

function jsonResponse(payload: unknown): Response {
  return { json: async () => payload } as unknown as Response;
}

function ok(): Response {
  return jsonResponse({ code: 0, message: "ok", data: null });
}

function conflict(): Response {
  return jsonResponse({
    code: 10006,
    message: "文章正在被小明编辑",
    data: null,
  });
}

// 心跳是真实 setInterval；用 fake timers 承接，避免测试进程被活跃定时器挂住。
afterEach(() => {
  vi.useRealTimers();
});

function setup(opts: SetupOptions = {}) {
  vi.useFakeTimers();
  const fetchCalls: FetchCall[] = [];
  const apiCalls: ApiCall[] = [];
  let lockPosts = 0;
  let detailGets = 0;
  const map = new Map<string, string>();
  const storage: DraftStorage & { map: Map<string, string> } = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    map,
  };

  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    fetchCalls.push({ url, init });
    if (init.method === "DELETE") return ok();
    if (url.endsWith("/edit-lock/force")) return ok();
    if (url.endsWith("/edit-lock")) {
      lockPosts += 1;
      if (opts.acquireConflictFirst && lockPosts === 1) return conflict();
      if (opts.verifyConflict && lockPosts >= 2) return conflict();
      return ok();
    }
    return ok();
  });

  const lock = createEditLock({
    fetchImpl: fetchImpl as unknown as typeof fetch,
    getToken: () => "regression-token",
  });

  const onSaved = vi.fn();
  const onClosed = vi.fn();
  const onSessionExpired = vi.fn();
  const onError = vi.fn();

  const core = createArticleEditor({
    userId: 7,
    lock,
    storage,
    now: () => 1700000000000,
    api: {
      request: async (method, path, body) => {
        apiCalls.push({ method, path, body });
        if (method === "GET" && path.endsWith("/edit")) {
          detailGets += 1;
          const failing =
            (opts.detailFailFirst && detailGets === 1) ||
            (opts.detailCode !== undefined && opts.detailCode !== 0);
          const code = failing ? (opts.detailCode ?? 10005) : 0;
          return {
            code,
            message: code === 0 ? "ok" : "load boom",
            data: code === 0 ? DETAIL : null,
          };
        }
        if (method === "PUT" || method === "POST") {
          const code = opts.saveCode ?? 0;
          return {
            code,
            message: code === 0 ? "ok" : "save boom",
            data: null,
          };
        }
        return { code: 0, message: "ok", data: null };
      },
    },
    messages: () => ({
      loadFailed: "load failed",
      saveFailed: "save failed",
      lockFailed: "lock failed",
      lockLost: "lock lost",
    }),
    onSaved,
    onClosed,
    onSessionExpired,
    onError,
  });

  return {
    core,
    lock,
    storage,
    fetchCalls,
    apiCalls,
    onSaved,
    onClosed,
    onSessionExpired,
    onError,
  };
}

function deleteCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.init.method === "DELETE");
}

describe("createArticleEditor 流程", () => {
  it("打开已发布文章走 T2 的 /articles/:id/edit；加载失败不得进入可编辑状态", async () => {
    const s = setup({ detailFailFirst: true });
    await s.core.open({ id: 42 });

    expect(s.core.getState().phase).toBe("load-error");
    expect(s.apiCalls).toEqual([
      { method: "GET", path: "/articles/42/edit", body: undefined },
    ]);
    s.core.updateForm({ ...emptyEditorForm(), title: "不该写入" });
    expect(s.core.getState().form.title).toBe("");
    expect(s.core.getState().baseline.title).toBe("");
  });

  it("重试加载成功后进入 ready 并同时建立 form / baseline", async () => {
    const s = setup({ detailFailFirst: true });
    await s.core.open({ id: 42 });
    await s.core.retryLoad();

    const state = s.core.getState();
    expect(state.phase).toBe("ready");
    expect(state.form.title).toBe("已发布文章");
    expect(state.form.content).toBe("# 正文");
    expect(state.form.category_id).toBe("3");
    expect(state.form.tags).toEqual(["标签A"]);
    expect(state.baseline).toEqual(state.form);
  });

  it("保存失败保持编辑器打开、保持锁、保留当前内容与草稿", async () => {
    const s = setup({ saveCode: 10008 });
    await s.core.open({ id: 42 });
    s.core.updateForm({ ...s.core.getState().form, title: "改过的标题" });
    await s.core.save();

    const state = s.core.getState();
    expect(state.phase).toBe("ready");
    expect(state.lockHeld).toBe(true);
    expect(state.form.title).toBe("改过的标题");
    expect(state.error).toBe("save boom");
    expect(deleteCalls(s.fetchCalls)).toHaveLength(0);
    expect(s.storage.map.size).toBe(1);
    expect(s.onSaved).not.toHaveBeenCalled();
  });

  it("pagehide 且 persisted===false 时尽力释放；persisted===true 不释放", async () => {
    const s = setup();
    await s.core.open({ id: 42 });

    s.core.handlePageHide({ persisted: true });
    expect(deleteCalls(s.fetchCalls)).toHaveLength(0);

    s.core.handlePageHide({ persisted: false });
    const deletes = deleteCalls(s.fetchCalls);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].init.keepalive).toBe(true);
    expect(deletes[0].url).toBe("/api/v1/articles/42/edit-lock");
  });

  it("beforeunload 只提示，不再无条件释放编辑锁", async () => {
    const s = setup();
    await s.core.open({ id: 42 });
    s.core.updateForm({ ...s.core.getState().form, title: "脏标题" });
    const event = {
      preventDefault: vi.fn(),
      returnValue: undefined as unknown,
    };

    s.core.handleBeforeUnload(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.returnValue).toBe("");
    expect(deleteCalls(s.fetchCalls)).toHaveLength(0);
  });

  it("Esc 分层：先关最上层弹窗；无弹窗且脏状态才触发未保存保护", async () => {
    const s = setup();
    await s.core.open({ id: 42 });
    s.core.openDialog("link");
    s.core.updateForm({ ...s.core.getState().form, title: "脏标题" });

    s.core.esc();
    expect(s.core.getState().dialog).toBe("none");
    expect(s.core.getState().phase).toBe("ready");

    s.core.esc();
    expect(s.core.getState().dialog).toBe("unsaved");
    expect(s.core.getState().phase).toBe("ready");

    s.core.continueEditing();
    expect(s.core.getState().dialog).toBe("none");
    expect(s.core.getState().form.title).toBe("脏标题");
  });

  it("干净状态 Esc 直接关闭并释放锁", async () => {
    const s = setup();
    await s.core.open({ id: 42 });
    s.core.esc();
    expect(s.core.getState().phase).toBe("closed");
    expect(deleteCalls(s.fetchCalls)).toHaveLength(1);
    expect(s.onClosed).toHaveBeenCalledTimes(1);
  });

  it("脏状态三出口：继续编辑 / 放弃修改（释放锁并清草稿）", async () => {
    const s = setup();
    await s.core.open({ id: 42 });
    s.core.updateForm({ ...s.core.getState().form, title: "脏标题" });
    s.core.close();
    expect(s.core.getState().dialog).toBe("unsaved");

    s.core.continueEditing();
    expect(s.core.getState().dialog).toBe("none");
    expect(s.core.getState().form.title).toBe("脏标题");

    s.core.close();
    s.core.discard();
    expect(s.core.getState().phase).toBe("closed");
    expect(deleteCalls(s.fetchCalls)).toHaveLength(1);
    expect(s.storage.map.size).toBe(0);
    expect(s.onClosed).toHaveBeenCalledTimes(1);
  });

  it("保存前锁校验冲突 → lock-lost，禁止保存且不发 PUT", async () => {
    const s = setup({ verifyConflict: true });
    await s.core.open({ id: 42 });
    s.core.updateForm({ ...s.core.getState().form, title: "脏标题" });
    await s.core.save();

    expect(s.core.getState().phase).toBe("lock-lost");
    expect(s.core.getState().lockHeld).toBe(false);
    expect(s.core.getState().form.title).toBe("脏标题");
    expect(s.apiCalls.some((call) => call.method === "PUT")).toBe(false);
    expect(s.core.getConflict()?.message).toBe("文章正在被小明编辑");
  });

  it("强制接管后重新走详情加载并重建基线", async () => {
    const s = setup({ acquireConflictFirst: true });
    await s.core.open({ id: 42 });

    expect(s.core.getState().phase).toBe("lock-conflict");
    expect(s.apiCalls.some((call) => call.path.endsWith("/edit"))).toBe(false);

    await s.core.takeover();
    const state = s.core.getState();
    expect(state.phase).toBe("ready");
    expect(state.form.title).toBe("已发布文章");
    expect(state.baseline.content).toBe("# 正文");
    expect(
      s.apiCalls.filter((call) => call.path === "/articles/42/edit")
    ).toHaveLength(1);
    expect(s.fetchCalls.some((call) => call.url.endsWith("/force"))).toBe(true);
  });

  it("10003 会话失效先同步落盘草稿再退出，不清该用户草稿", async () => {
    const s = setup({ saveCode: 10003 });
    await s.core.open({ id: 42 });
    s.core.updateForm({ ...s.core.getState().form, content: "未保存的正文" });
    await s.core.save();

    expect(s.core.getState().phase).toBe("closed");
    expect(s.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(s.storage.map.size).toBe(1);
    const stored = [...s.storage.map.values()][0];
    expect(stored).toContain("未保存的正文");
    expect(stored).toContain('"userId":7');
    expect(stored).not.toContain("regression-token");
  });

  it("新建文章不抢服务端锁，保存走 POST /articles", async () => {
    const s = setup();
    await s.core.open(null);

    expect(s.core.getState().phase).toBe("ready");
    expect(s.fetchCalls.some((call) => call.url.includes("edit-lock"))).toBe(
      false
    );
    expect(s.apiCalls.some((call) => call.path.endsWith("/edit"))).toBe(false);

    s.core.updateForm({ ...emptyEditorForm(), title: "新文章" });
    await s.core.save();
    expect(s.apiCalls).toContainEqual({
      method: "POST",
      path: "/articles",
      body: expect.objectContaining({ title: "新文章", category_id: null }),
    });
    expect(s.core.getState().phase).toBe("saved");
    expect(s.onSaved).toHaveBeenCalledTimes(1);
  });
});
