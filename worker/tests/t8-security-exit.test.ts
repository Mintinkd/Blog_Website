import { afterEach, describe, expect, it, vi } from "vitest";
import { router } from "../src/router";
import { handleUpdateCategory } from "../src/handlers/category";
import type { AuthResult } from "../src/middleware/auth";

/**
 * issue #50（T8）：所有权判定 fail-closed + 错误出口不泄露内部细节。
 * 三个用例对应工单 Acceptance criteria 的三条单测要求。
 */

const EDITOR_AUTH: AuthResult = {
  username: "editor",
  role: "editor",
  mustChangePassword: false,
};

const CTX = {
  waitUntil() {},
  passThroughOnException() {},
} as unknown as ExecutionContext;

const SENSITIVE = "D1_ERROR: no such table: users: SQLITE_ERROR";

/** 通用 D1 桩：记录 SQL，first 按语句分派，run 记录写语句。 */
function makeDb(firstFor: (sql: string) => unknown) {
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      const api = {
        bind: () => api,
        first: async () => firstFor(sql),
        all: async () => ({ results: [] }),
        run: async () => ({
          success: true,
          meta: { last_row_id: 1, changes: 1 },
        }),
      };
      return api;
    },
  };
  return { db, statements };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function loggedText(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls
    .map((call) =>
      call
        .map((arg) => (arg instanceof Error ? arg.message : String(arg)))
        .join(" ")
    )
    .join(" ");
}

describe("分类编辑所有权 fail-closed（T8）", () => {
  it("用户行解析失败时返回 403，且不执行 UPDATE", async () => {
    const { db, statements } = makeDb((sql) =>
      sql.includes("SELECT * FROM categories")
        ? { id: 7, created_by: 42 }
        : null
    );

    const res = await handleUpdateCategory(
      new Request("https://example.com/api/v1/categories/7", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "新分类名" }),
      }),
      { DB: db } as never,
      { id: "7" },
      EDITOR_AUTH
    );

    expect(res.status).toBe(403);
    expect(statements.some((sql) => sql.includes("UPDATE categories"))).toBe(
      false
    );
  });
});

describe("错误出口不泄露内部细节（T8）", () => {
  it("顶层 catch 只回通用文案，异常原文只进 console.error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = {
      DB: {
        prepare() {
          throw new Error(SENSITIVE);
        },
      },
    } as never;

    const res = await router(
      new Request("https://example.com/api/v1/config"),
      env,
      CTX
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Internal server error");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("users");
    expect(serialized).not.toContain("SQLITE_ERROR");
    expect(loggedText(spy)).toContain("no such table: users");
  });

  it("/health 在依赖故障时响应体只有 status 字段", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = {
      DB: {
        prepare() {
          throw new Error(SENSITIVE);
        },
      },
    } as never;

    const res = await router(
      new Request("https://example.com/api/v1/health"),
      env,
      CTX
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "error" });
    expect(loggedText(spy)).toContain("no such table: users");
  });
});
