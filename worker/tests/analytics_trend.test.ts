import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../src/router";
import { generateToken } from "../src/middleware/auth";
import type { Env } from "../src/index";

/**
 * issue #58：后台趋势图的按日 PV / UV / bot_filtered 数据源。
 *
 * 接缝：`GET /api/v1/admin/analytics/trend` 走 router() 全链路；
 * D1 按 SQL 语义在内存桩中聚合，期望值为手写字面量。
 */

const JWT_SECRET = "issue58-trend-test-secret";
const NOW = new Date("2026-11-09T04:00:00.000Z"); // 上海 2026-11-09 12:00

interface DailyRow {
  day: string;
  pv: number;
  uv: number;
  bot_filtered: number;
}

const ROWS: DailyRow[] = [
  { day: "2026-11-09", pv: 10, uv: 6, bot_filtered: 2 },
  { day: "2026-11-08", pv: 5, uv: 3, bot_filtered: 1 },
  // 只有被过滤请求的一天：PV/UV 为 0，仍应出现在悬停信息里
  { day: "2026-11-07", pv: 0, uv: 0, bot_filtered: 3 },
  // 范围外，不得计入
  { day: "2026-10-01", pv: 99, uv: 9, bot_filtered: 0 },
];

function makeEnv(role?: "admin" | "editor"): Env {
  const prepare = (sql: string) => {
    const statement = {
      sql,
      binds: [] as unknown[],
      bind(...binds: unknown[]) {
        statement.binds = binds;
        return statement;
      },
      first: (): Promise<unknown> => {
        if (sql.includes("key = 'jwt_secret'")) {
          return Promise.resolve({ value: JWT_SECRET });
        }
        if (sql.includes("FROM users")) {
          return Promise.resolve(
            role ? { role, must_change_password: 0 } : null
          );
        }
        return Promise.resolve(null);
      },
      all: (): Promise<{ results: unknown[] }> => {
        if (sql.includes("GROUP BY day")) {
          const [from, to] = statement.binds.map(String);
          const grouped = new Map<string, DailyRow>();
          for (const row of ROWS) {
            if (row.day < from || row.day > to) continue;
            const current = grouped.get(row.day) ?? {
              day: row.day,
              pv: 0,
              uv: 0,
              bot_filtered: 0,
            };
            current.pv += row.pv;
            current.uv += row.uv;
            current.bot_filtered += row.bot_filtered;
            grouped.set(row.day, current);
          }
          return Promise.resolve({ results: Array.from(grouped.values()) });
        }
        return Promise.resolve({ results: [] });
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

async function callTrend(
  query: string,
  role?: "admin" | "editor"
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (role) {
    headers.Authorization = `Bearer ${await generateToken(
      role === "admin" ? "adminuser" : "editoruser",
      JWT_SECRET
    )}`;
  }
  const request = new Request(
    `https://api.example.test/api/v1/admin/analytics/trend${query}`,
    { headers }
  );
  const context = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  const res = await router(request, makeEnv(role), context);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("issue #58：趋势接口鉴权与白名单", () => {
  it("未登录 401、editor 403、range 非法 400", async () => {
    expect((await callTrend("?range=7d")).status).toBe(401);
    expect((await callTrend("?range=7d", "editor")).status).toBe(403);
    expect((await callTrend("?range=abc", "admin")).status).toBe(400);
    expect((await callTrend("", "admin")).status).toBe(400);
  });

  it("四个 range 都放行", async () => {
    for (const range of ["today", "7d", "30d", "90d"]) {
      expect((await callTrend(`?range=${range}`, "admin")).status, range).toBe(
        200
      );
    }
  });
});

describe("issue #58：按日序列", () => {
  it("7d 补齐 7 个日界，无数据补 0，范围外不计入", async () => {
    const res = await callTrend("?range=7d", "admin");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      range: "7d",
      from: "2026-11-03",
      to: "2026-11-09",
      days: [
        { day: "2026-11-03", pv: 0, uv: 0, bot_filtered: 0 },
        { day: "2026-11-04", pv: 0, uv: 0, bot_filtered: 0 },
        { day: "2026-11-05", pv: 0, uv: 0, bot_filtered: 0 },
        { day: "2026-11-06", pv: 0, uv: 0, bot_filtered: 0 },
        { day: "2026-11-07", pv: 0, uv: 0, bot_filtered: 3 },
        { day: "2026-11-08", pv: 5, uv: 3, bot_filtered: 1 },
        { day: "2026-11-09", pv: 10, uv: 6, bot_filtered: 2 },
      ],
    });
  });

  it("today 只返回当日 1 个点", async () => {
    const res = await callTrend("?range=today", "admin");
    expect(res.body.data).toEqual({
      range: "today",
      from: "2026-11-09",
      to: "2026-11-09",
      days: [{ day: "2026-11-09", pv: 10, uv: 6, bot_filtered: 2 }],
    });
  });

  it("同日多行按 SUM 聚合", async () => {
    // ROWS 里 11-09 只有一行；用 30d 覆盖多行场景由桩保证 SUM 语义
    const res = await callTrend("?range=30d", "admin");
    const last = res.body.data.days.at(-1);
    expect(last).toEqual({
      day: "2026-11-09",
      pv: 10,
      uv: 6,
      bot_filtered: 2,
    });
  });
});
