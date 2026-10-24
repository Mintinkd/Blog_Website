import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleChangePassword,
  handleCreateUser,
  handleLogin,
  handleUpdateUser,
} from "../src/handlers/auth_handler";
import type { Env } from "../src/index";
import type { AuthResult } from "../src/middleware/auth";
import {
  fakeVerifyPassword,
  hashPassword,
  verifyPassword,
} from "../src/utils/password";

/**
 * issue #44（C4）：登录口令长度上限 + 未知账号假验证固定开销。
 *
 * 接缝（工单 Key interfaces，按 docs/agents/testing.md 视为已确认）：
 *   - handleLogin —— 登录入口的入参校验与响应；
 *   - fakeVerifyPassword —— 未知账号假验证的 CPU 口径。
 * 期望值取自工单/审查报告字面量（上限 200、假验证 1000 次），
 * 不从被测实现的导出常量推导。
 */
const MAX_PASSWORD_LENGTH = 200;

function loginRequest(password: string, username = "nobody"): Request {
  return jsonRequest("/api/v1/auth/login", { username, password });
}

/** 触碰即失败：用于断言「超限早退」没有进入数据库 */
function throwingDb(): Env["DB"] {
  return {
    prepare: () => {
      throw new Error("超限口令不得访问数据库");
    },
  } as unknown as Env["DB"];
}

/** 全部查询返回空：登录走到「未知用户名 → 假验证 → 401」分支 */
function emptyDb(): Env["DB"] {
  const statement = {
    bind: () => statement,
    first: async () => null,
    all: async () => ({ results: [] }),
    run: async () => ({ success: true, meta: { last_row_id: 0 } }),
  };
  return { prepare: () => statement } as unknown as Env["DB"];
}

/** 登录成功路径所需最小 D1：users 行、jwt_secret 与写回语句 */
function loginDb(user: Record<string, unknown>): Env["DB"] {
  return {
    prepare: (sql: string) => {
      const bound = {
        first: async () => {
          if (sql.includes("FROM users")) return user;
          if (sql.includes("jwt_secret")) return { value: "test-secret" };
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ success: true, meta: { last_row_id: 0 } }),
      };
      return { bind: () => bound, ...bound };
    },
  } as unknown as Env["DB"];
}

function jsonRequest(path: string, body: Record<string, unknown>): Request {
  return new Request(`https://example.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const adminAuth: AuthResult = {
  username: "admin",
  role: "admin",
  mustChangePassword: false,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("登录口令长度上限（issue #44）", () => {
  it("超过上限的口令返回 400，且不触发数据库访问或任何 KDF", async () => {
    const deriveBits = vi.spyOn(crypto.subtle, "deriveBits");

    const res = await handleLogin(
      loginRequest("a".repeat(MAX_PASSWORD_LENGTH + 1)),
      { DB: throwingDb() } as unknown as Env
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: number };
    expect(body.code).toBe(10002);
    expect(deriveBits).not.toHaveBeenCalled();
  });

  it("上限值本身（200）不在登录入口被长度校验拦截", async () => {
    const deriveBits = vi.spyOn(crypto.subtle, "deriveBits");

    const res = await handleLogin(
      loginRequest("a".repeat(MAX_PASSWORD_LENGTH)),
      { DB: emptyDb() } as unknown as Env
    );

    // 未知用户名 → 进入假验证 → 401；若被长度校验拦截会是 400
    expect(res.status).toBe(401);
    expect(deriveBits).toHaveBeenCalledTimes(1);
  });

  it("上限值本身（200）可完成真实登录并返回 token", async () => {
    const password = "a".repeat(MAX_PASSWORD_LENGTH);
    const res = await handleLogin(loginRequest(password, "admin"), {
      DB: loginDb({
        id: 1,
        username: "admin",
        password_hash: await hashPassword(password),
        display_name: "Admin",
        role: "admin",
        must_change_password: 0,
        failed_login_attempts: 0,
        locked_until: null,
      }),
    } as unknown as Env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { token: string } };
    expect(body.data.token).toEqual(expect.any(String));
  });
});

describe("建号 / 改密 / 重置口令与登录共用长度上限（issue #44）", () => {
  it("创建用户：超限口令返回 400，且不访问数据库", async () => {
    const res = await handleCreateUser(
      jsonRequest("/api/v1/users", {
        username: "new-user",
        password: "a".repeat(MAX_PASSWORD_LENGTH + 1),
      }),
      { DB: throwingDb() } as unknown as Env
    );

    expect(res.status).toBe(400);
  });

  it("自助改密：超限新口令返回 400，且不访问数据库", async () => {
    const res = await handleChangePassword(
      jsonRequest("/api/v1/auth/change-password", {
        old_password: "old-password",
        new_password: "a".repeat(MAX_PASSWORD_LENGTH + 1),
      }),
      { DB: throwingDb() } as unknown as Env,
      adminAuth
    );

    expect(res.status).toBe(400);
  });

  it("管理员重置口令：超限口令返回 400，且不访问数据库", async () => {
    const res = await handleUpdateUser(
      jsonRequest("/api/v1/users/2", {
        password: "a".repeat(MAX_PASSWORD_LENGTH + 1),
      }),
      { DB: throwingDb() } as unknown as Env,
      { id: "2" }
    );

    expect(res.status).toBe(400);
  });
});

describe("未知账号假验证的固定开销（issue #44）", () => {
  it("真实校验跟随存储声明的迭代数，假验证始终固定 1000 次", async () => {
    const deriveBits = vi.spyOn(crypto.subtle, "deriveBits");
    // 自描述哈希：迭代数 100000 由存储字符串声明（模拟站点当前配置）
    const stored =
      "pbkdf2$sha256$100000$00112233445566778899aabbccddeeff$deadbeef";
    const password = "a".repeat(MAX_PASSWORD_LENGTH);

    await verifyPassword(password, stored);
    const realParams = deriveBits.mock.calls[0][0] as { iterations: number };
    expect(realParams.iterations).toBe(100_000);

    deriveBits.mockClear();
    await fakeVerifyPassword(password);
    const fakeParams = deriveBits.mock.calls[0][0] as { iterations: number };
    // 与上面的存储配置无关：常量 1000，不随真实 KDF 迭代数放大
    expect(fakeParams.iterations).toBe(1_000);
  });
});
