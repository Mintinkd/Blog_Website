// @vitest-environment node
// issue #69 / T8 阶段4：UsersPanel / FriendLinksPanel 的纯逻辑接缝。
// 期望值均为手写字面量，不从被测函数反推；不依赖 DOM / Vue / fetch。
import { describe, it, expect } from "vitest";
import { buildUserRequest } from "../src/admin/panels/users.logic";
import {
  buildFriendLinkRequest,
  decorateFriendLinks,
} from "../src/admin/panels/friend-links.logic";

describe("UsersPanel — buildUserRequest（对应 saveUser 分支）", () => {
  const baseForm = {
    username: "bob",
    password: "",
    display_name: "Bob",
    role: "editor",
  };

  it("编辑且 role 未变且密码为空：只传 display_name", () => {
    expect(buildUserRequest(baseForm, 7, "editor")).toEqual({
      method: "PUT",
      path: "/users/7",
      body: { display_name: "Bob" },
    });
  });

  it("编辑且 role 变化：追加 role", () => {
    expect(
      buildUserRequest({ ...baseForm, role: "admin" }, 7, "editor")
    ).toEqual({
      method: "PUT",
      path: "/users/7",
      body: { display_name: "Bob", role: "admin" },
    });
  });

  it("编辑且密码非空：追加 password", () => {
    expect(
      buildUserRequest({ ...baseForm, password: "s3cret" }, 7, "editor")
    ).toEqual({
      method: "PUT",
      path: "/users/7",
      body: { display_name: "Bob", password: "s3cret" },
    });
  });

  it("新建缺 password：返回 username_password_required 错误", () => {
    expect(buildUserRequest(baseForm, null, "")).toEqual({
      error: "username_password_required",
    });
  });

  it("新建缺 username：返回 username_password_required 错误", () => {
    expect(
      buildUserRequest({ ...baseForm, username: "", password: "pw" }, null, "")
    ).toEqual({ error: "username_password_required" });
  });

  it("新建合法：POST /users，body 为整个表单", () => {
    expect(buildUserRequest({ ...baseForm, password: "pw" }, null, "")).toEqual(
      {
        method: "POST",
        path: "/users",
        body: {
          username: "bob",
          password: "pw",
          display_name: "Bob",
          role: "editor",
        },
      }
    );
  });
});

describe("FriendLinksPanel — buildFriendLinkRequest（对应 saveFriendLink 分支）", () => {
  const form = {
    name: "A",
    url: "https://a.com",
    description: "d",
    sort_order: 3,
    is_active: true,
  };

  it("新建：POST /friend-links，body 为整个表单", () => {
    expect(buildFriendLinkRequest(form, null)).toEqual({
      method: "POST",
      path: "/friend-links",
      body: {
        name: "A",
        url: "https://a.com",
        description: "d",
        sort_order: 3,
        is_active: true,
      },
    });
  });

  it("编辑：PUT /friend-links/:id，body 为整个表单", () => {
    expect(buildFriendLinkRequest(form, 12)).toEqual({
      method: "PUT",
      path: "/friend-links/12",
      body: {
        name: "A",
        url: "https://a.com",
        description: "d",
        sort_order: 3,
        is_active: true,
      },
    });
  });
});

describe("FriendLinksPanel — decorateFriendLinks（issue #43 XSS 兜底）", () => {
  /** 手写桩：仅放行 http/https 绝对 URL，模拟 safeFriendLinkUrl 的接受集合 */
  const safeUrl = (raw: unknown): string => {
    try {
      const s = String(raw ?? "");
      const protocol = new URL(s).protocol;
      return protocol === "http:" || protocol === "https:" ? s : "";
    } catch {
      return "";
    }
  };

  it("javascript: 降级为空 safe_url，合法 https 原样保留", () => {
    const list = [
      { id: 1, name: "ok", url: "https://example.com" },
      { id: 2, name: "bad", url: "javascript:alert(1)" },
    ];
    expect(decorateFriendLinks(list, safeUrl)).toEqual([
      {
        id: 1,
        name: "ok",
        url: "https://example.com",
        safe_url: "https://example.com",
      },
      {
        id: 2,
        name: "bad",
        url: "javascript:alert(1)",
        safe_url: "",
      },
    ]);
  });
});
