import { describe, expect, it, vi } from "vitest";
import { router } from "../src/router";
import type { Env } from "../src/index";

/**
 * issue #44 AC5（T2 登录限流子项）端到端验证：
 * T6（#48）落地后，登录接口已由 rateLimitMiddleware 按 method + 路由模板
 * （`POST:/auth/login`，120 次/分/IP）覆盖。本文件不重复测中间件本身
 * （见 rate_limit.test.ts），只验证「从 router 入口看，登录请求确实被限流」，
 * 即：超限请求在到达 handler 前就返回 429，且 handler 不得被调用。
 */

function makeEnv(userRow: Record<string, unknown> | null): Env {
  return {
    API_PREFIX: "/api/v1",
    RATE_LIMIT: {
      get: vi.fn(async () => "120"),
      put: vi.fn(async () => undefined),
    },
    DB: {
      prepare: (sql: string) => {
        const bound = {
          first: async () => {
            if (sql.includes("FROM users")) return userRow;
            if (sql.includes("jwt_secret")) return { value: "test-secret" };
            return null;
          },
          all: async () => ({ results: [] }),
          run: async () => ({ success: true, meta: { last_row_id: 0 } }),
        };
        return { bind: () => bound, ...bound };
      },
    },
  } as unknown as Env;
}

function loginRequest(): Request {
  return new Request("https://example.com/api/v1/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": "203.0.113.7",
    },
    body: JSON.stringify({ username: "admin", password: "wrong" }),
  });
}

describe("T2 登录限流子项（#44 AC5）端到端", () => {
  it("登录超限返回 429，且不进入 handler / 不查库", async () => {
    const dbFirst = vi.fn(async () => null);
    const env = {
      API_PREFIX: "/api/v1",
      RATE_LIMIT: {
        get: vi.fn(async () => "120"),
        put: vi.fn(async () => undefined),
      },
      DB: {
        prepare: () => ({
          first: dbFirst,
          all: async () => ({ results: [] }),
          run: async () => ({}),
        }),
      },
    } as unknown as Env;

    const res = await router(loginRequest(), env, {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext);

    expect(res.status).toBe(429);
    // 限流在鉴权与查库之前生效：DB 不得被碰
    expect(dbFirst).not.toHaveBeenCalled();
    const body = (await res.json()) as { code: number };
    expect(body.code).toBe(10007);
  });

  it("未超限时登录请求正常穿过限流进入 handler（返回 401 而非 429）", async () => {
    const env = makeEnv(null);
    // 阈值内：get 返回 0，请求穿过限流进入 handler
    (env.RATE_LIMIT.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce("0");
    const res = await router(loginRequest(), env, {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: number };
    expect(body.code).toBe(10003);
  });
});
