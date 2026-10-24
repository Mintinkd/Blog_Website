import { describe, expect, it } from "vitest";
import {
  handleChangePassword,
  handleCreateUser,
  handleUpdateUser,
} from "../src/handlers/auth_handler";
import type { Env } from "../src/index";
import type { AuthResult } from "../src/middleware/auth";
import { assertPasswordStrength, hashPassword } from "../src/utils/password";

/**
 * issue #45（C2/H6/H7）：口令强度策略的共享断言。
 *
 * 接缝：工单 Key interfaces 点名的 `assertPasswordStrength(password, context)`，
 * 由「创建用户 / 管理员重置 / 自助改密」三条路径共用。
 * 期望值来自工单与审查报告字面量（长度 ≥ 12、弱口令名单、站点名/用户名变体），
 * 不从被测实现推导。
 */

const context = { username: "alice", siteTitle: "My Blog" };

describe("共享口令强度断言（issue #45）", () => {
  it("放行长度达标且不含身份信息的口令", () => {
    expect(
      assertPasswordStrength("correct-horse-battery-staple", context)
    ).toBe(true);
  });

  it("拒绝长度不足 12 位的口令", () => {
    expect(assertPasswordStrength("1", context)).toBe(false);
    expect(assertPasswordStrength("a".repeat(11), context)).toBe(false);
  });

  it("长度恰好 12 位时放行（边界）", () => {
    expect(assertPasswordStrength("correcthorse", context)).toBe(true);
  });

  it("拒绝弱口令名单，含大小写与 leet 变体", () => {
    expect(assertPasswordStrength("password1234", context)).toBe(false);
    expect(assertPasswordStrength("PASSWORD1234", context)).toBe(false);
    expect(assertPasswordStrength("P@ssw0rd1234", context)).toBe(false);
    expect(assertPasswordStrength("ChangeMe1234", context)).toBe(false);
  });

  it("拒绝站点名变体（含空格与大小写差异）", () => {
    expect(assertPasswordStrength("myblog-2026!", context)).toBe(false);
    expect(assertPasswordStrength("My Blog 2026!", context)).toBe(false);
    expect(assertPasswordStrength("my-bl0g-2026!", context)).toBe(false);
  });

  it("拒绝用户名变体（含反向拼写）", () => {
    expect(assertPasswordStrength("alice-2026!!", context)).toBe(false);
    expect(assertPasswordStrength("ALICE2026!!!", context)).toBe(false);
    expect(assertPasswordStrength("ecila-2026!!", context)).toBe(false);
  });

  it("缺少上下文字段时不误伤普通口令", () => {
    expect(assertPasswordStrength("correct-horse-battery-staple")).toBe(true);
    expect(assertPasswordStrength("correct-horse-battery-staple", {})).toBe(
      true
    );
  });
});

const STRONG_PASSWORD = "correct-horse-battery-staple";
const SITE_TITLE = "My Blog";

interface RecordedStatement {
  sql: string;
  binds: unknown[];
}

function jsonRequest(path: string, body: Record<string, unknown>): Request {
  return new Request(`https://example.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 三条口令写入路径共用：按 SQL 子串应答 site_config / users 查询，并记录写语句 */
function passwordPathDb(
  options: {
    siteTitle?: string;
    user?: Record<string, unknown> | null;
  } = {}
): { db: Env["DB"]; statements: RecordedStatement[] } {
  const statements: RecordedStatement[] = [];
  const db = {
    prepare: (sql: string) => {
      const statement = { sql, binds: [] as unknown[] };
      statements.push(statement);
      const api = {
        bind: (...binds: unknown[]) => {
          statement.binds = binds;
          return api;
        },
        first: async () => {
          if (sql.includes("site_title")) {
            return { value: options.siteTitle ?? SITE_TITLE };
          }
          if (sql.includes("FROM users")) return options.user ?? null;
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ success: true, meta: { last_row_id: 7 } }),
      };
      return api;
    },
  } as unknown as Env["DB"];
  return { db, statements };
}

function hasWrite(
  statements: RecordedStatement[],
  keyword: "INSERT" | "UPDATE"
): boolean {
  return statements.some((statement) =>
    new RegExp(`\\b${keyword}\\b`, "i").test(statement.sql)
  );
}

describe("创建用户的口令策略与强制改密（issue #45）", () => {
  it("弱口令与站点名/用户名变体返回 400，且不写库", async () => {
    for (const password of [
      "1",
      "password",
      "myblog-2026!",
      "alice-2026-strong!",
    ]) {
      const { db, statements } = passwordPathDb();
      const res = await handleCreateUser(
        jsonRequest("/api/v1/users", {
          username: "alice",
          password,
          display_name: "Alice",
        }),
        { DB: db } as unknown as Env
      );

      expect(res.status).toBe(400);
      expect(hasWrite(statements, "INSERT")).toBe(false);
    }
  });

  it("强度达标时建号，并在 INSERT 中置 must_change_password = 1", async () => {
    const { db, statements } = passwordPathDb();
    const res = await handleCreateUser(
      jsonRequest("/api/v1/users", {
        username: "alice",
        password: STRONG_PASSWORD,
        display_name: "Alice",
      }),
      { DB: db } as unknown as Env
    );

    expect(res.status).toBe(200);
    const insert = statements.find((statement) =>
      /INSERT INTO users/i.test(statement.sql)
    );
    expect(insert).toBeDefined();
    expect(insert?.sql).toContain("must_change_password");
    expect(insert?.binds).toEqual([
      "alice",
      expect.stringMatching(/^pbkdf2\$sha256\$/),
      "Alice",
      "admin",
      1,
    ]);
  });
});

describe("管理员重置口令的策略与强制改密（issue #45）", () => {
  const targetUser = { id: 2, username: "bob" };

  it("弱口令、站点名或目标用户名变体返回 400，且不写库", async () => {
    for (const password of ["password", "myblog-2026!", "bob-2026-strong!"]) {
      const { db, statements } = passwordPathDb({ user: targetUser });
      const res = await handleUpdateUser(
        jsonRequest("/api/v1/users/2", { password }),
        { DB: db } as unknown as Env,
        { id: "2" }
      );

      expect(res.status).toBe(400);
      expect(hasWrite(statements, "UPDATE")).toBe(false);
    }
  });

  it("重置口令时置 must_change_password = 1，并保留锁定清理", async () => {
    const { db, statements } = passwordPathDb({ user: targetUser });
    const res = await handleUpdateUser(
      jsonRequest("/api/v1/users/2", { password: STRONG_PASSWORD }),
      { DB: db } as unknown as Env,
      { id: "2" }
    );

    expect(res.status).toBe(200);
    const update = statements.find((statement) =>
      /UPDATE users/i.test(statement.sql)
    );
    expect(update).toBeDefined();
    expect(update?.sql).toMatch(/must_change_password\s*=\s*1/);
    expect(update?.sql).toMatch(/failed_login_attempts\s*=\s*0/);
    expect(update?.sql).toMatch(/locked_until\s*=\s*NULL/);
  });
});

describe("自助改密的口令策略（issue #45）", () => {
  const adminAuth: AuthResult = {
    username: "alice",
    role: "admin",
    mustChangePassword: true,
  };

  it("弱口令、站点名或用户名变体返回 400，且不写库", async () => {
    const oldPassword = "old-password-123456";
    const passwordHash = await hashPassword(oldPassword);

    for (const newPassword of [
      "password1234",
      "myblog-2026!",
      "alice-2026-strong!",
    ]) {
      const { db, statements } = passwordPathDb({
        user: { id: 1, password_hash: passwordHash },
      });
      const res = await handleChangePassword(
        jsonRequest("/api/v1/auth/change-password", {
          old_password: oldPassword,
          new_password: newPassword,
        }),
        { DB: db } as unknown as Env,
        adminAuth
      );

      expect(res.status).toBe(400);
      expect(hasWrite(statements, "UPDATE")).toBe(false);
    }
  });

  it("强度达标时更新口令并清除 must_change_password", async () => {
    const oldPassword = "old-password-123456";
    const { db, statements } = passwordPathDb({
      user: { id: 1, password_hash: await hashPassword(oldPassword) },
    });
    const res = await handleChangePassword(
      jsonRequest("/api/v1/auth/change-password", {
        old_password: oldPassword,
        new_password: STRONG_PASSWORD,
      }),
      { DB: db } as unknown as Env,
      adminAuth
    );

    expect(res.status).toBe(200);
    const update = statements.find((statement) =>
      /UPDATE users/i.test(statement.sql)
    );
    expect(update).toBeDefined();
    expect(update?.sql).toMatch(/must_change_password\s*=\s*0/);
    expect(update?.binds[0]).toMatch(/^pbkdf2\$sha256\$/);
  });
});
