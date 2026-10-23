import { describe, expect, it } from "vitest";
import { isValidUrl } from "../src/utils/validator";
import {
  handleCreateFriendLink,
  handleUpdateFriendLink,
} from "../src/handlers/friend_link";
import { handleImport } from "../src/handlers/admin";
import { router } from "../src/router";
import { generateToken } from "../src/middleware/auth";
import type { Env } from "../src/index";

/**
 * issue #43（T1 / 审查报告 C1）：友链 URL scheme 白名单 + 写权限收敛 + 渲染兜底。
 * 三道防线各自独立成立，缺一不可：
 *   1) isValidUrl 仅放行 http/https（常规写入 + bulk import 同一校验器；
 *      存量脏数据里的 javascript:/data: 等一律拒绝）；
 *   2) 友链创建/更新/删除接口收归 admin（editor 403，且不产生任何写 SQL）；
 *   3) 前端渲染兜底由 tests/friend-link-url.test.ts 覆盖（根包 vitest）。
 *
 * 接缝（工单 Key interfaces 点名，视为已确认）：
 *   - 共享 URL 校验函数 isValidUrl（validator 工具，多入口共用的校验流水线）；
 *   - router() 全链路（authMiddleware → requireAdmin 判定 → handler），D1/KV 以桩替代；
 *   - handleImport 的两阶段导入（阶段一全量校验零副作用）。
 * 期望值均为手写字面量，不从被测实现反推。
 */

const JWT_SECRET = "t1-friend-link-test-secret";

/**
 * 记录全部 prepare/bind 序列的假 D1（prepare 顺序即真实执行顺序）。
 * 传入 role 时应答鉴权查询（jwt_secret 配置行 + 用户角色行），供 router 级测试；
 * 不传时不应答（handler / import 级测试不触及鉴权）。
 */
function recordingDb(role?: "admin" | "editor"): {
  db: unknown;
  statements: Array<{ sql: string; binds: unknown[] }>;
} {
  const statements: Array<{ sql: string; binds: unknown[] }> = [];
  const prepare = (sql: string) => {
    const stmt = { sql, binds: [] as unknown[] };
    statements.push(stmt);
    const api = {
      bind: (...binds: unknown[]) => {
        stmt.binds = binds;
        return api;
      },
      first: () => {
        if (sql.includes("key = 'jwt_secret'"))
          return Promise.resolve({ value: JWT_SECRET });
        if (sql.includes("FROM users"))
          return Promise.resolve(
            role ? { role, must_change_password: 0 } : null
          );
        // 存量行查询返回一行，使 update 流程越过 notFound 进入 URL 校验
        if (sql.includes("FROM friend_links"))
          return Promise.resolve({
            id: 1,
            name: "老朋友",
            url: "https://old.example.com",
          });
        return Promise.resolve(null);
      },
      all: () => Promise.resolve({ results: [] }),
      run: () =>
        Promise.resolve({
          success: true,
          meta: { last_row_id: 1, changes: 1 },
        }),
    };
    return api;
  };
  return { db: { prepare }, statements };
}

function makeEnv(db: unknown): Env {
  return { DB: db } as unknown as Env;
}

function hasWrite(statements: Array<{ sql: string }>): boolean {
  return statements.some((s) => /\b(INSERT|UPDATE|DELETE)\b/i.test(s.sql));
}

describe("isValidUrl scheme 白名单（C1 防线一）", () => {
  it("放行 http/https 绝对 URL（含端口、路径、查询、片段、大写 scheme）", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
    expect(isValidUrl("http://example.com:8080/a/b?c=1#d")).toBe(true);
    expect(isValidUrl("HTTPS://EXAMPLE.COM/Path")).toBe(true);
  });

  it("拒绝 javascript:（含大小写混淆与制表符插入变体）", () => {
    expect(isValidUrl("javascript:alert(document.cookie)")).toBe(false);
    expect(isValidUrl("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isValidUrl("java\tscript:alert(1)")).toBe(false);
  });

  it("拒绝 data: / vbscript: / file: / ftp: 等其余 scheme", () => {
    expect(isValidUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isValidUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isValidUrl("file:///etc/passwd")).toBe(false);
    expect(isValidUrl("ftp://example.com/x")).toBe(false);
  });

  it("拒绝协议相对 URL、相对路径与无 scheme 主机名", () => {
    expect(isValidUrl("//evil.com")).toBe(false);
    expect(isValidUrl("/friend/page")).toBe(false);
    expect(isValidUrl("evil.com")).toBe(false);
    expect(isValidUrl("")).toBe(false);
  });
});

/** 以给定 body 发起创建/更新，返回响应与全部 SQL 语句（含绑定值） */
async function runHandler(
  kind: "create" | "update",
  body: Record<string, unknown>
): Promise<{
  res: Response;
  statements: Array<{ sql: string; binds: unknown[] }>;
}> {
  const { db, statements } = recordingDb();
  const request = new Request("https://example.com/api/v1/friend-links", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res =
    kind === "create"
      ? await handleCreateFriendLink(request, makeEnv(db))
      : await handleUpdateFriendLink(request, makeEnv(db), { id: "1" });
  return { res, statements };
}

describe("友链写接口 URL 校验（C1 防线一，handler 接缝）", () => {
  it("创建时 javascript: URL 返回 400 且不产生任何写 SQL", async () => {
    const { res, statements } = await runHandler("create", {
      name: " evil ",
      url: "javascript:alert(document.cookie)",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: number; message: string };
    expect(body.code).not.toBe(0);
    expect(hasWrite(statements)).toBe(false);
  });

  it("更新时 javascript: URL 返回 400 且不产生任何写 SQL", async () => {
    const { res, statements } = await runHandler("update", {
      url: "javascript:alert(document.cookie)",
    });

    expect(res.status).toBe(400);
    expect(hasWrite(statements)).toBe(false);
  });

  it("创建时合法 https URL 通过校验并继续写入（放行不被误伤）", async () => {
    const { res, statements } = await runHandler("create", {
      name: "好朋友",
      url: "https://friend.example.com/blog",
    });

    expect(res.status).toBe(200);
    expect(hasWrite(statements)).toBe(true);
  });
});

/** 以给定 export_data 发起 bulk import，返回响应与全部 SQL 语句 */
async function runImport(exportData: Record<string, unknown[]>): Promise<{
  res: Response;
  statements: Array<{ sql: string; binds: unknown[] }>;
}> {
  const { db, statements } = recordingDb();
  const request = new Request("https://example.com/api/v1/admin/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ export_data: exportData }),
  });
  const res = await handleImport(request, makeEnv(db));
  return { res, statements };
}

describe("bulk import 的友链 URL 校验（C1 防线一，import 接缝）", () => {
  it("friend_links 行含 javascript: URL：400 且不执行任何 SQL（阶段一零副作用）", async () => {
    const { res, statements } = await runImport({
      friend_links: [
        {
          id: 1,
          name: "坏人",
          url: "javascript:alert(document.cookie)",
          sort_order: 0,
          is_active: 1,
        },
      ],
    });

    expect(res.status).toBe(400);
    expect(statements.length).toBe(0);
  });

  it("friend_links 行含 data: URL 同样被拒", async () => {
    const { res } = await runImport({
      friend_links: [
        {
          id: 2,
          name: "坏人",
          url: "data:text/html,<script>alert(1)</script>",
        },
      ],
    });

    expect(res.status).toBe(400);
  });

  it("friend_links 行均为合法 https URL：导入放行并落库", async () => {
    const { res, statements } = await runImport({
      friend_links: [
        {
          id: 1,
          name: "好朋友",
          url: "https://friend.example.com/blog",
          sort_order: 0,
          is_active: 1,
        },
      ],
    });

    expect(res.status).toBe(200);
    expect(hasWrite(statements)).toBe(true);
  });
});

function makeRouterEnv(role: "admin" | "editor"): {
  env: Env;
  statements: Array<{ sql: string; binds: unknown[] }>;
} {
  const { db, statements } = recordingDb(role);
  const env = {
    DB: db,
    RATE_LIMIT: {
      get: () => Promise.resolve(null),
      put: () => Promise.resolve(),
    },
  } as unknown as Env;
  return { env, statements };
}

/** 以指定角色走 router() 全链路调用友链写接口 */
async function callWriteRoute(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  role: "admin" | "editor",
  body?: Record<string, unknown>
): Promise<{
  res: Response;
  statements: Array<{ sql: string; binds: unknown[] }>;
}> {
  const { env, statements } = makeRouterEnv(role);
  const token = await generateToken(
    role === "admin" ? "adminuser" : "editoruser",
    JWT_SECRET
  );
  const request = new Request(`https://example.com/api/v1${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  const res = await router(request, env, ctx);
  return { res, statements };
}

describe("友链写权限收敛（C1 防线二，router 接缝）", () => {
  it("editor 创建友链返回 403 且不产生任何写 SQL", async () => {
    const { res, statements } = await callWriteRoute(
      "POST",
      "/friend-links",
      "editor",
      {
        name: "坏人",
        url: "https://evil.example.com",
      }
    );

    expect(res.status).toBe(403);
    expect(hasWrite(statements)).toBe(false);
  });

  it("editor 更新友链返回 403 且不产生任何写 SQL", async () => {
    const { res, statements } = await callWriteRoute(
      "PUT",
      "/friend-links/1",
      "editor",
      {
        url: "https://evil.example.com",
      }
    );

    expect(res.status).toBe(403);
    expect(hasWrite(statements)).toBe(false);
  });

  it("editor 删除友链返回 403 且不产生任何写 SQL", async () => {
    const { res, statements } = await callWriteRoute(
      "DELETE",
      "/friend-links/1",
      "editor"
    );

    expect(res.status).toBe(403);
    expect(hasWrite(statements)).toBe(false);
  });

  it("admin 创建友链放行（200）", async () => {
    const { res } = await callWriteRoute("POST", "/friend-links", "admin", {
      name: "好朋友",
      url: "https://friend.example.com/blog",
    });

    expect(res.status).toBe(200);
  });

  it("admin 更新与删除友链同样放行（200）", async () => {
    const updated = await callWriteRoute("PUT", "/friend-links/1", "admin", {
      url: "https://friend.example.com/new",
    });
    expect(updated.res.status).toBe(200);

    const deleted = await callWriteRoute("DELETE", "/friend-links/1", "admin");
    expect(deleted.res.status).toBe(200);
  });
});
