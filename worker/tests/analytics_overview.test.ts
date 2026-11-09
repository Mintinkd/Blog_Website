import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../src/router";
import { generateToken } from "../src/middleware/auth";
import type { Env } from "../src/index";

/**
 * issue #55：`GET /api/v1/admin/analytics/overview` 的鉴权与口径。
 *
 * 接缝（工单 Key interfaces 点名，见 docs/agents/testing.md:87）：
 *   - router() 全链路（authMiddleware → requireAdmin → handler），D1/KV 以桩替代；
 *   - 概览聚合查询按 day 范围求和，期望值为手写字面量。
 */

const JWT_SECRET = "issue55-overview-test-secret";
const NOW = new Date("2026-11-09T04:00:00.000Z"); // 上海 2026-11-09 12:00

interface DailyRow {
  article_id: number;
  day: string;
  pv: number;
  uv: number;
  requests: number;
  bot_filtered: number;
}

const SEEDED_DAILY: DailyRow[] = [
  {
    article_id: 7,
    day: "2026-11-09",
    pv: 3,
    uv: 2,
    requests: 4,
    bot_filtered: 1,
  },
  {
    article_id: 7,
    day: "2026-11-03",
    pv: 5,
    uv: 4,
    requests: 6,
    bot_filtered: 2,
  },
  {
    article_id: 8,
    day: "2026-10-01",
    pv: 99,
    uv: 99,
    requests: 99,
    bot_filtered: 99,
  },
  {
    article_id: 8,
    day: "2026-11-10",
    pv: 77,
    uv: 77,
    requests: 77,
    bot_filtered: 77,
  },
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
      first: () => {
        if (sql.includes("key = 'jwt_secret'")) {
          return Promise.resolve({ value: JWT_SECRET });
        }
        if (sql.includes("FROM users")) {
          return Promise.resolve(
            role ? { role, must_change_password: 0 } : null
          );
        }
        if (
          sql.includes("FROM analytics_article_daily") &&
          sql.includes("SUM(")
        ) {
          const [from, to] = statement.binds.map(String);
          const rows = SEEDED_DAILY.filter(
            (row) => row.day >= from && row.day <= to
          );
          const sum = (pick: (row: DailyRow) => number) =>
            rows.reduce((total, row) => total + pick(row), 0);
          return Promise.resolve({
            pv: sum((row) => row.pv),
            uv: sum((row) => row.uv),
            bot_filtered: sum((row) => row.bot_filtered),
          });
        }
        return Promise.resolve(null);
      },
      all: () => Promise.resolve({ results: [] }),
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

async function callOverview(
  query: string,
  role?: "admin" | "editor"
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (role) {
    headers.Authorization = `Bearer ${await generateToken(
      role === "admin" ? "adminuser" : "editoruser",
      JWT_SECRET
    )}`;
  }
  const request = new Request(
    `https://api.example.test/api/v1/admin/analytics/overview${query}`,
    { headers }
  );
  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  return router(request, makeEnv(role), ctx);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("issue #55：概览接口鉴权与 range 白名单", () => {
  it("未登录返回 401", async () => {
    const res = await callOverview("?range=7d");
    expect(res.status).toBe(401);
  });

  it("editor 返回 403", async () => {
    const res = await callOverview("?range=7d", "editor");
    expect(res.status).toBe(403);
  });

  it("range=abc 返回 400；四个合法值都放行", async () => {
    expect((await callOverview("?range=abc", "admin")).status).toBe(400);
    expect((await callOverview("?range=", "admin")).status).toBe(400);
    for (const range of ["today", "7d", "30d", "90d"]) {
      expect(
        (await callOverview(`?range=${range}`, "admin")).status,
        range
      ).toBe(200);
    }
  });

  it("7d 返回范围内 PV / UV / 过滤 bot 合计，有效阅读 Tier 0 为空", async () => {
    const res = await callOverview("?range=7d", "admin");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      code: 0,
      message: "ok",
      data: {
        range: "7d",
        pv: 8, // 2026-11-09 的 3 + 2026-11-03 的 5
        uv: 6, // 2 + 4
        bot_filtered: 3, // 1 + 2
        engaged: null, // Tier 1 未实施
      },
    });
  });

  it("today 只统计当日", async () => {
    const res = await callOverview("?range=today", "admin");

    const body = (await res.json()) as { data: unknown };
    expect(body.data).toEqual({
      range: "today",
      pv: 3,
      uv: 2,
      bot_filtered: 1,
      engaged: null,
    });
  });
});
