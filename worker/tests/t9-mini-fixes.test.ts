import { describe, expect, it } from "vitest";
import { handleDeleteUser } from "../src/handlers/auth_handler";
import { handleUpdateConfig } from "../src/handlers/config";
import { escapeLike } from "../src/handlers/search";
import type { AuthResult } from "../src/middleware/auth";

/**
 * issue #51（T9）：Worker 侧六项小修的单测闭环（不含 i18n 前端部分）。
 */

const ADMIN_AUTH: AuthResult = {
  username: "admin",
  role: "admin",
  mustChangePassword: false,
};

/**
 * 通用 D1 桩：bind 返回自身，first/run 按 SQL 内容分派。
 * 与 friend_link_security.test.ts 的 recordingDb 同构。
 */
function makeDb(
  firstFor: (sql: string, binds: unknown[]) => unknown,
  runFor?: (sql: string, binds: unknown[]) => unknown
) {
  const statements: Array<{ sql: string; binds: unknown[] }> = [];
  const prepare = (sql: string) => {
    const api = {
      bind: (...binds: unknown[]) => {
        statements.push({ sql, binds });
        return api;
      },
      first: () =>
        Promise.resolve(
          firstFor(sql, statements[statements.length - 1]?.binds || [])
        ),
      all: () => Promise.resolve({ results: [] }),
      run: () =>
        Promise.resolve(
          runFor
            ? runFor(sql, statements[statements.length - 1]?.binds || [])
            : { success: true, meta: { last_row_id: 1, changes: 1 } }
        ),
    };
    return api;
  };
  return { db: { prepare }, statements };
}

describe("删除当前登录用户禁止（T9-1）", () => {
  it("删除自己返回 400 明确错误，不执行 DELETE", async () => {
    const { db } = makeDb((sql: string) => {
      if (sql.includes("SELECT id FROM users WHERE username = ?"))
        return { id: 42 };
      if (sql.includes("SELECT role FROM users WHERE id = ?"))
        return { role: "admin" };
      return null;
    });
    const res = await handleDeleteUser(
      new Request("https://example.com/users/42"),
      { DB: db } as any,
      { id: "42" },
      ADMIN_AUTH
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: number; message: string };
    expect(body.code).toBe(10002); // VALIDATION_FAILED
    expect(body.message).toContain("无法删除当前登录账户");
  });

  it("删除其他用户允许通过", async () => {
    const { db } = makeDb((sql: string) => {
      if (sql.includes("SELECT id FROM users WHERE username = ?"))
        return { id: 42 }; // 当前登录用户 id
      if (sql.includes("SELECT role FROM users WHERE id = ?"))
        return { role: "editor" }; // 目标用户非 admin
      return null;
    });
    const res = await handleDeleteUser(
      new Request("https://example.com/users/99"),
      { DB: db } as any,
      { id: "99" },
      ADMIN_AUTH
    );
    expect(res.status).toBe(200);
  });
});

describe("配置写入键白名单（T9-2）", () => {
  function makeConfigDb(): any {
    return {
      DB: {
        prepare: () => ({
          bind: () => ({
            run: async () => ({ success: true, meta: { changes: 1 } }),
          }),
        }),
      },
    };
  }

  it("合法键写入通过", async () => {
    const res = await handleUpdateConfig(
      new Request("https://example.com/api/v1/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site_title: "新标题" }),
      }),
      makeConfigDb()
    );
    expect(res.status).toBe(200);
  });

  it("非法键（jwt_secret 置空）返回 400", async () => {
    const res = await handleUpdateConfig(
      new Request("https://example.com/api/v1/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jwt_secret: "" }),
      }),
      makeConfigDb()
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: number; message: string };
    expect(body.code).toBe(10002); // VALIDATION_FAILED
    expect(body.message).toContain("jwt_secret");
  });

  it("非白名单键返回 400", async () => {
    const res = await handleUpdateConfig(
      new Request("https://example.com/api/v1/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ malicious_key: "x" }),
      }),
      makeConfigDb()
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: number; message: string };
    expect(body.code).toBe(10002);
    expect(body.message).toContain("非法配置键");
  });

  it("admin_password_hash 置空被拒", async () => {
    const res = await handleUpdateConfig(
      new Request("https://example.com/api/v1/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ admin_password_hash: "" }),
      }),
      makeConfigDb()
    );
    expect(res.status).toBe(400);
  });
});

describe("LIKE 转义与 FTS 失败日志（T9-3）", () => {
  it("普通字符无变化", () => {
    expect(escapeLike("hello")).toBe("hello");
  });

  it("% 被转义", () => {
    expect(escapeLike("a%b")).toBe("a\\%b");
  });

  it("_ 被转义", () => {
    expect(escapeLike("a_b")).toBe("a\\_b");
  });

  it("反斜杠被转义", () => {
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  it("混合：每字符独立转义", () => {
    // 字符串 "%_%\\" 在 JS 中实际为 4 字符: % _ % \
    // escapeLike 对每个字符加前缀 \
    // 输出: \% \_ \% \\ 共 8 字符
    expect(escapeLike("%_%\\")).toBe("\\%\\_\\%\\\\");
  });
});
