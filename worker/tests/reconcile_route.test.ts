import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../src/router";
import { generateToken } from "../src/middleware/auth";
import type { Env } from "../src/index";

/**
 * issue #72 / M9：`POST /api/v1/admin/reconcile-counters` 的路由鉴权。
 * 接缝：router() 全链路（authMiddleware → requireAdmin → handler）。
 * 复用 analytics_overview.test.ts 的真实 JWT 模式，不 mock 鉴权中间件。
 */

const JWT_SECRET = "issue72-reconcile-test-secret";

function makeEnv(role?: "admin" | "editor"): Env {
  const prepare = (sql: string) => {
    const statement = {
      sql,
      binds: [] as unknown[],
      bind(...binds: unknown[]) {
        statement.binds = binds;
        return statement;
      },
      first: () => {
        if (sql.includes("key = 'jwt_secret'"))
          return Promise.resolve({ value: JWT_SECRET });
        if (sql.includes("FROM users")) {
          return Promise.resolve(
            role ? { role, must_change_password: 0 } : null
          );
        }
        return Promise.resolve(null);
      },
      all: () => {
        if (/FROM articles\b/i.test(sql))
          return Promise.resolve({ results: [] as unknown[] });
        return Promise.resolve({ results: [] as unknown[] });
      },
      run: () => Promise.resolve({ success: true, meta: { changes: 1 } }),
    };
    return statement;
  };
  return {
    DB: { prepare },
    RATE_LIMIT: {
      get: () => Promise.resolve(null),
      put: () => Promise.resolve(),
    },
  } as unknown as Env;
}

async function callReconcile(role?: "admin" | "editor"): Promise<Response> {
  const headers: Record<string, string> = {};
  if (role) {
    headers.Authorization = `Bearer ${await generateToken(
      role === "admin" ? "adminuser" : "editoruser",
      JWT_SECRET
    )}`;
  }
  const request = new Request(
    "https://api.example.test/api/v1/admin/reconcile-counters",
    { method: "POST", headers }
  );
  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return router(request, makeEnv(role), ctx);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("issue #72：对账入口鉴权", () => {
  it("未登录返回 401", async () => {
    const res = await callReconcile();
    expect(res.status).toBe(401);
  });

  it("editor 返回 403", async () => {
    const res = await callReconcile("editor");
    expect(res.status).toBe(403);
  });

  it("admin 返回 200", async () => {
    const res = await callReconcile("admin");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: number };
    expect(body.code).toBe(0);
  });
});
