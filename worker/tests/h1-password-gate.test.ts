import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../src/router";
import { generateToken } from "../src/middleware/auth";
import { hashPassword } from "../src/utils/password";
import type { Env } from "../src/index";

/**
 * issue #83（H1）AC2/AC3：
 *  - 列未迁移时 getUserAuth 不返回 false 放行（fail-closed）；
 *  - needsChange=true 的会话访问 GET 类管理接口返回 403，仅 refresh / change-password 可达。
 *  - 三条口令写入路径拒绝同一组弱口令样例见 auth_password_strength.test.ts。
 *
 * 接缝：router() 全链路（真实 JWT + authMiddleware → mustChange 闸门），D1/KV 以桩替代。
 */
const JWT_SECRET = "issue83-h1-gate-test-secret";

interface EnvOptions {
  /** users 行：null=用户不存在；否则含 role / must_change_password / password_hash */
  user?: {
    role: "admin" | "editor";
    mustChange?: number;
    passwordHash?: string;
  } | null;
  /** 模拟迁移前：SELECT ... must_change_password 抛「列不存在」 */
  missingMustChangeColumn?: boolean;
  siteTitle?: string;
}

function makeEnv(options: EnvOptions = {}): {
  env: Env;
  statements: string[];
} {
  const statements: string[] = [];
  const user =
    options.user === undefined
      ? { role: "admin" as const, mustChange: 0 }
      : options.user;

  const statement = (sql: string) => {
    statements.push(sql);
    const api = {
      sql,
      binds: [] as unknown[],
      bind(...binds: unknown[]) {
        api.binds = binds;
        return api;
      },
      first: async () => {
        if (sql.includes("key = 'jwt_secret'")) return { value: JWT_SECRET };
        if (sql.includes("site_title"))
          return { value: options.siteTitle ?? "My Blog" };
        if (/FROM users\b/i.test(sql)) {
          if (
            options.missingMustChangeColumn &&
            /must_change_password/i.test(sql)
          ) {
            throw new Error("no such column: must_change_password");
          }
          if (!user) return null;
          if (/SELECT role FROM users\b/i.test(sql)) return { role: user.role }; // 降级路径旧列
          return {
            role: user.role,
            must_change_password: user.mustChange ?? 0,
            password_hash: user.passwordHash ?? "",
            display_name: "Admin",
            id: 1,
            failed_login_attempts: 0,
            locked_until: null,
          };
        }
        return null;
      },
      all: async () => ({ results: [] as unknown[] }),
      run: async () => ({
        success: true,
        meta: { changes: 1, last_row_id: 1 },
      }),
    };
    return api;
  };

  const env = {
    DB: { prepare: statement },
    RATE_LIMIT: {
      get: () => Promise.resolve(null),
      put: () => Promise.resolve(),
    },
  } as unknown as Env;
  return { env, statements };
}

async function call(
  method: string,
  path: string,
  options: EnvOptions = {},
  body?: Record<string, unknown>,
  withToken = true
): Promise<{ res: Response; statements: string[] }> {
  const { env, statements } = makeEnv(options);
  const headers: Record<string, string> = {};
  if (withToken) {
    headers.Authorization = `Bearer ${await generateToken("admin", JWT_SECRET)}`;
  }
  const request = new Request(`https://api.example.test/api/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return { res: await router(request, env, ctx), statements };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("issue #83：会话级须改密闸门", () => {
  it("needsChange=true 会话访问 GET 类管理接口（/users）返回 403", async () => {
    const { res } = await call("GET", "/users", {
      user: { role: "admin", mustChange: 1 },
    });
    expect(res.status).toBe(403);
  });

  it("needsChange=true 会话访问 /settings（GET 管理接口）同样 403", async () => {
    const { res } = await call("GET", "/settings", {
      user: { role: "admin", mustChange: 1 },
    });
    expect(res.status).toBe(403);
  });

  it("needsChange=true 会话访问写接口仍 403（旧口径不回退）", async () => {
    const { res } = await call(
      "PUT",
      "/config",
      { user: { role: "admin", mustChange: 1 } },
      {}
    );
    expect(res.status).toBe(403);
  });

  it("无须改密会话访问 GET 管理接口正常放行", async () => {
    const { res } = await call("GET", "/users", {
      user: { role: "admin", mustChange: 0 },
    });
    expect(res.status).toBe(200);
  });

  it("豁免路径 /auth/refresh 可达（非 403）", async () => {
    const { res } = await call("POST", "/auth/refresh", {
      user: { role: "admin", mustChange: 1 },
    });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
  });

  it("豁免路径 /auth/change-password 可达（进入 handler 而非闸门 403）", async () => {
    const passwordHash = await hashPassword("old-password-123456");
    const { res } = await call(
      "POST",
      "/auth/change-password",
      { user: { role: "admin", mustChange: 1, passwordHash } },
      { old_password: "old-password-123456", new_password: "password1234" } // 弱口令 → handler 400，证明未被闸门拦
    );
    expect(res.status).toBe(400);
  });
});

describe("issue #83：列未迁移 fail-closed", () => {
  it("must_change_password 列缺失时 GET 管理接口返回 403（不放行）", async () => {
    const { res } = await call("GET", "/users", {
      user: { role: "admin" },
      missingMustChangeColumn: true,
    });
    expect(res.status).toBe(403);
  });

  it("列缺失时 /auth/refresh 仍可达（豁免路径不误伤）", async () => {
    const { res } = await call("POST", "/auth/refresh", {
      user: { role: "admin" },
      missingMustChangeColumn: true,
    });
    expect(res.status).toBe(200);
  });
});
