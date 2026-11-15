// @vitest-environment node
// issue #69 / T8：壳层 composable 的公开接缝。期望值均为手写字面量，不从实现反推。
import { describe, it, expect, vi } from "vitest";
import { createSession } from "../src/admin/composables/useSession";
import { createAdminApi } from "../src/admin/composables/useAdminApi";
import { createFeedback } from "../src/admin/composables/useFeedback";

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    snapshot: () => Object.fromEntries(map),
  };
}

function sessionHooks() {
  return {
    clearDrafts: vi.fn(),
    disposeEditor: vi.fn(),
    expireEditor: vi.fn(),
  };
}

describe("useSession — 会话公开接缝", () => {
  it("从注入的 storage 恢复 token / 角色 / 用户 id，空 token 时未登录", () => {
    const storage = memoryStorage({
      admin_token: "tok-abc",
      admin_role: "admin",
      admin_user_id: "42",
    });
    const session = createSession(storage, sessionHooks());
    expect(session.token.value).toBe("tok-abc");
    expect(session.role.value).toBe("admin");
    expect(session.userId.value).toBe(42);
    expect(session.isLoggedIn.value).toBe(true);
  });

  it("无 token 时即使残留角色也判定未登录，userId 非数字回退 0", () => {
    const storage = memoryStorage({
      admin_role: "admin",
      admin_user_id: "nope",
    });
    const session = createSession(storage, sessionHooks());
    expect(session.isLoggedIn.value).toBe(false);
    expect(session.role.value).toBe("admin");
    expect(session.userId.value).toBe(0);
  });

  it("applyLogin 写入三个 key，缺失字段回退 editor / 0", () => {
    const storage = memoryStorage();
    const session = createSession(storage, sessionHooks());
    const applied = session.applyLogin({
      token: "new-tok",
      user: { id: 7, role: "admin" },
    });
    expect(applied).toEqual({ role: "admin", userId: 7 });
    expect(storage.snapshot()).toEqual({
      admin_token: "new-tok",
      admin_role: "admin",
      admin_user_id: "7",
    });
    expect(session.isLoggedIn.value).toBe(true);

    const fallback = createSession(memoryStorage(), sessionHooks());
    expect(fallback.applyLogin({ token: "t2" })).toEqual({
      role: "editor",
      userId: 0,
    });
  });

  it("logout 释放编辑器 + 清该用户草稿 + 清三个 key + role 回退 editor", () => {
    const storage = memoryStorage({
      admin_token: "tok",
      admin_role: "admin",
      admin_user_id: "9",
    });
    const hooks = sessionHooks();
    const session = createSession(storage, hooks);
    session.logout();
    expect(hooks.disposeEditor).toHaveBeenCalledTimes(1);
    expect(hooks.clearDrafts).toHaveBeenCalledWith(9);
    expect(hooks.expireEditor).not.toHaveBeenCalled();
    expect(storage.snapshot()).toEqual({});
    expect(session.token.value).toBe("");
    expect(session.role.value).toBe("editor");
    expect(session.userId.value).toBe(0);
    expect(session.isLoggedIn.value).toBe(false);
  });

  it("expire（10003）只尽力落盘草稿，不清该用户草稿", () => {
    const storage = memoryStorage({
      admin_token: "tok",
      admin_role: "admin",
      admin_user_id: "9",
    });
    const hooks = sessionHooks();
    const session = createSession(storage, hooks);
    session.expire();
    expect(hooks.expireEditor).toHaveBeenCalledTimes(1);
    expect(hooks.disposeEditor).not.toHaveBeenCalled();
    expect(hooks.clearDrafts).not.toHaveBeenCalled();
    expect(storage.snapshot()).toEqual({});
    expect(session.isLoggedIn.value).toBe(false);
  });
});

describe("useAdminApi — 认证请求公开接缝", () => {
  function stubFetch(payload: unknown) {
    return vi.fn(async () => ({
      json: async () => payload,
    })) as unknown as typeof fetch;
  }

  it("GET 拼接 /api/v1 前缀，带 Bearer 与 Content-Type，无 body", async () => {
    const fetchImpl = stubFetch({ code: 0, data: { items: [] } });
    const onSessionExpired = vi.fn();
    const api = createAdminApi({
      fetchImpl,
      getToken: () => "tok-xyz",
      onSessionExpired,
    });
    const data = await api("GET", "/categories");
    expect(data).toEqual({ code: 0, data: { items: [] } });
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/categories", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer tok-xyz",
      },
    });
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it("POST 把 body 序列化成 JSON 字符串", async () => {
    const fetchImpl = stubFetch({ code: 0 });
    const api = createAdminApi({
      fetchImpl,
      getToken: () => "t",
      onSessionExpired: vi.fn(),
    });
    await api("POST", "/tags", { name: "猫", slug: "cat" });
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/tags", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer t",
      },
      body: JSON.stringify({ name: "猫", slug: "cat" }),
    });
  });

  it("code 10003 触发会话失效回调且原样返回响应体", async () => {
    const fetchImpl = stubFetch({ code: 10003, message: "expired" });
    const onSessionExpired = vi.fn();
    const api = createAdminApi({
      fetchImpl,
      getToken: () => "t",
      onSessionExpired,
    });
    expect(await api("GET", "/users")).toEqual({
      code: 10003,
      message: "expired",
    });
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it("code 10004 只告警，不触发会话失效", async () => {
    const fetchImpl = stubFetch({ code: 10004, message: "no permission" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onSessionExpired = vi.fn();
    const api = createAdminApi({
      fetchImpl,
      getToken: () => "t",
      onSessionExpired,
    });
    expect(await api("GET", "/users")).toEqual({
      code: 10004,
      message: "no permission",
    });
    expect(warn).toHaveBeenCalledWith("Permission denied:", "no permission");
    expect(onSessionExpired).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("apiBase 可覆盖，authHeaders 复用同一 token", async () => {
    const fetchImpl = stubFetch({ code: 0 });
    const api = createAdminApi({
      fetchImpl,
      getToken: () => "override",
      onSessionExpired: vi.fn(),
      apiBase: "/proxy/v1",
    });
    expect(api.authHeaders()).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer override",
    });
    await api("GET", "/settings");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/proxy/v1/settings",
      expect.objectContaining({ method: "GET" })
    );
  });
});

describe("useFeedback — alert / confirm 包装接缝", () => {
  it("透传文案与 confirm 的返回值，不改写消息", () => {
    const alertImpl = vi.fn();
    const confirmImpl = vi.fn(() => false);
    const feedback = createFeedback({ alertImpl, confirmImpl });
    feedback.alert("保存失败");
    expect(feedback.confirm("确定删除？")).toBe(false);
    expect(alertImpl).toHaveBeenCalledWith("保存失败");
    expect(confirmImpl).toHaveBeenCalledWith("确定删除？");
  });

  it("confirm 为 true 时原样返回 true", () => {
    const feedback = createFeedback({
      alertImpl: vi.fn(),
      confirmImpl: () => true,
    });
    expect(feedback.confirm("继续？")).toBe(true);
  });
});
