import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../src/router";
import { generateToken } from "../src/middleware/auth";
import type { Env } from "../src/index";

/**
 * issue #57：文章明细表与数据质量面板两个只读接口。
 *
 * 接缝（工单 Key interfaces 点名，见 docs/agents/testing.md:87）：
 *   - router() 全链路的 /admin/analytics/articles 与 /admin/analytics/quality；
 *   - D1 聚合查询按 SQL 语义在内存桩中执行，断言接口可观察结果。
 * 期望值均为手写字面量，不从被测实现反推。
 */

const JWT_SECRET = "issue57-reports-test-secret";
const NOW = new Date("2026-11-09T04:00:00.000Z"); // 上海 2026-11-09 12:00

interface DailyRow {
  article_id: number;
  day: string;
  pv: number;
  uv: number;
  requests: number;
  bot_filtered: number;
}

interface DimRow {
  day: string;
  dim: string;
  bucket: string;
  article_id: number;
  count: number;
}

interface ArticleRow {
  id: number;
  title: string;
  slug: string;
}

interface State {
  daily: DailyRow[];
  dim: DimRow[];
  articles: ArticleRow[];
  config: Map<string, string>;
  tokenRows: number;
}

function makeState(overrides: Partial<State> = {}): State {
  return {
    daily: [
      {
        article_id: 7,
        day: "2026-11-09",
        pv: 10,
        uv: 6,
        requests: 12,
        bot_filtered: 2,
      },
      {
        article_id: 7,
        day: "2026-11-08",
        pv: 5,
        uv: 3,
        requests: 6,
        bot_filtered: 1,
      },
      {
        article_id: 8,
        day: "2026-11-09",
        pv: 7,
        uv: 4,
        requests: 8,
        bot_filtered: 0,
      },
      // 范围外，仅供 MIN(day) 起点标注
      {
        article_id: 9,
        day: "2026-10-01",
        pv: 99,
        uv: 9,
        requests: 99,
        bot_filtered: 0,
      },
    ],
    dim: [
      {
        day: "2026-11-09",
        dim: "referrer",
        bucket: "news.example.test",
        article_id: 7,
        count: 9,
      },
      {
        day: "2026-11-09",
        dim: "referrer",
        bucket: "internal",
        article_id: 7,
        count: 3,
      },
      {
        day: "2026-11-08",
        dim: "referrer",
        bucket: "news.example.test",
        article_id: 7,
        count: 5,
      },
      {
        day: "2026-11-09",
        dim: "referrer",
        bucket: "social.example",
        article_id: 8,
        count: 6,
      },
    ],
    articles: [
      { id: 7, title: "服务端渲染", slug: "ssr" },
      { id: 8, title: "第二篇", slug: "second" },
      { id: 9, title: "第三篇", slug: "third" },
    ],
    config: new Map([["analytics_last_job_at", "2026-11-09 03:00:00"]]),
    tokenRows: 42,
    ...overrides,
  };
}

function inRange(row: { day: string }, from: string, to: string): boolean {
  return row.day >= from && row.day <= to;
}

function makeEnv(state: State, role?: "admin" | "editor"): Env {
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
        if (sql.includes("COUNT(DISTINCT article_id)")) {
          const [from, to] = statement.binds.map(String);
          return Promise.resolve({
            total: new Set(
              state.daily
                .filter((row) => inRange(row, from, to))
                .map((row) => row.article_id)
            ).size,
          });
        }
        if (sql.includes("MIN(day)")) {
          const days = state.daily.map((row) => row.day).sort();
          return Promise.resolve({ since: days[0] ?? null });
        }
        if (sql.includes("SUM(bot_filtered)")) {
          const [from, to] = statement.binds.map(String);
          const rows = state.daily.filter((row) => inRange(row, from, to));
          const sum = (pick: (row: DailyRow) => number) =>
            rows.reduce((total, row) => total + pick(row), 0);
          return Promise.resolve({
            pv: sum((row) => row.pv),
            uv: sum((row) => row.uv),
            requests: sum((row) => row.requests),
            bot_filtered: sum((row) => row.bot_filtered),
          });
        }
        if (sql.includes("key = 'analytics_last_job_at'")) {
          const value = state.config.get("analytics_last_job_at");
          return Promise.resolve(value ? { value } : null);
        }
        if (sql.includes("FROM analytics_view_token")) {
          return Promise.resolve({ count: state.tokenRows });
        }
        return Promise.resolve(null);
      },
      all: (): Promise<{ results: unknown[] }> => {
        if (sql.includes("JOIN articles a")) {
          // bind 顺序：[from, to, limit, offset]
          const raw = statement.binds;
          const rangeFrom = String(raw[0]);
          const rangeTo = String(raw[1]);
          const pageSize = Number(raw[2]);
          const skip = Number(raw[3]);
          const grouped = new Map<number, { pv: number; uv: number }>();
          for (const row of state.daily) {
            if (!inRange(row, rangeFrom, rangeTo)) continue;
            const current = grouped.get(row.article_id) ?? { pv: 0, uv: 0 };
            current.pv += row.pv;
            current.uv += row.uv;
            grouped.set(row.article_id, current);
          }
          const rows = Array.from(grouped, ([id, totals]) => {
            const article = state.articles.find((item) => item.id === id);
            return {
              id,
              title: article?.title ?? "",
              slug: article?.slug ?? "",
              pv: totals.pv,
              uv: totals.uv,
            };
          })
            .filter((row) => row.title !== "")
            .sort((a, b) => b.pv - a.pv || a.id - b.id)
            .slice(skip, skip + pageSize);
          return Promise.resolve({ results: rows });
        }
        if (sql.includes("dim = 'referrer'")) {
          const [from, to] = statement.binds.map(String);
          const grouped = new Map<
            string,
            { article_id: number; bucket: string; total: number }
          >();
          for (const row of state.dim) {
            if (row.dim !== "referrer" || !inRange(row, from, to)) continue;
            const key = `${row.article_id}\u0000${row.bucket}`;
            const current = grouped.get(key) ?? {
              article_id: row.article_id,
              bucket: row.bucket,
              total: 0,
            };
            current.total += row.count;
            grouped.set(key, current);
          }
          return Promise.resolve({ results: Array.from(grouped.values()) });
        }
        if (sql.includes("GROUP BY article_id, day")) {
          const [from, to] = statement.binds.map(String);
          const grouped = new Map<
            string,
            { article_id: number; day: string; pv: number }
          >();
          for (const row of state.daily) {
            if (!inRange(row, from, to)) continue;
            const key = `${row.article_id}\u0000${row.day}`;
            const current = grouped.get(key) ?? {
              article_id: row.article_id,
              day: row.day,
              pv: 0,
            };
            current.pv += row.pv;
            grouped.set(key, current);
          }
          return Promise.resolve({ results: Array.from(grouped.values()) });
        }
        if (sql.includes("GROUP BY day")) {
          const [from, to] = statement.binds.map(String);
          const grouped = new Map<string, number>();
          for (const row of state.daily) {
            if (!inRange(row, from, to)) continue;
            grouped.set(row.day, (grouped.get(row.day) ?? 0) + row.pv);
          }
          return Promise.resolve({
            results: Array.from(grouped, ([day, pv]) => ({ day, pv })),
          });
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

async function call(
  path: "articles" | "quality",
  query: string,
  state: State = makeState(),
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
    `https://api.example.test/api/v1/admin/analytics/${path}${query}`,
    { headers }
  );
  const context = {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
  const res = await router(request, makeEnv(state, role), context);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("issue #57：文章明细接口", () => {
  it("未登录 401、editor 403、range / page 非法值 400", async () => {
    expect((await call("articles", "?range=7d")).status).toBe(401);
    expect(
      (await call("articles", "?range=7d", makeState(), "editor")).status
    ).toBe(403);
    for (const query of [
      "?range=abc",
      "?range=7d&page=abc",
      "?range=7d&page=0",
      "?range=7d&page=-1",
    ]) {
      expect(
        (await call("articles", query, makeState(), "admin")).status,
        query
      ).toBe(400);
    }
  });

  it("按 PV 降序返回标题 / UV / 来源 Top1 / 7 日 sparkline，并给出 MIN(day) 起点", async () => {
    const res = await call("articles", "?range=7d", makeState(), "admin");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      range: "7d",
      page: 1,
      page_size: 20,
      total: 2,
      total_pages: 1,
      since: "2026-10-01",
      items: [
        {
          id: 7,
          title: "服务端渲染",
          slug: "ssr",
          pv: 15, // 10 + 5
          uv: 9, // 6 + 3
          top_referrer: "news.example.test",
          sparkline: [0, 0, 0, 0, 0, 5, 10], // 11-03 … 11-09
          engaged_rate: null,
          avg_dwell_bucket: null,
        },
        {
          id: 8,
          title: "第二篇",
          slug: "second",
          pv: 7,
          uv: 4,
          top_referrer: "social.example",
          sparkline: [0, 0, 0, 0, 0, 0, 7],
          engaged_rate: null,
          avg_dwell_bucket: null,
        },
      ],
    });
  });

  it("分页 20：25 篇时第一页 20 条、第二页 5 条，仍按 PV 降序", async () => {
    const state = makeState({
      articles: Array.from({ length: 25 }, (_, i) => ({
        id: i + 1,
        title: `文章${i + 1}`,
        slug: `a${i + 1}`,
      })),
      daily: Array.from({ length: 25 }, (_, i) => ({
        article_id: i + 1,
        day: "2026-11-09",
        pv: i + 1,
        uv: 1,
        requests: i + 1,
        bot_filtered: 0,
      })),
      dim: [],
    });

    const first = await call("articles", "?range=7d&page=1", state, "admin");
    expect(first.body.data.total).toBe(25);
    expect(first.body.data.total_pages).toBe(2);
    expect(first.body.data.items).toHaveLength(20);
    expect(first.body.data.items[0]).toMatchObject({ id: 25, pv: 25 });

    const second = await call("articles", "?range=7d&page=2", state, "admin");
    expect(second.body.data.items).toHaveLength(5);
    expect(second.body.data.items[0]).toMatchObject({ id: 5, pv: 5 });
  });

  it("空态：无数据返回空 items、total 0 且不返回起点", async () => {
    const empty = makeState({ daily: [], dim: [], tokenRows: 0 });
    const res = await call("articles", "?range=7d", empty, "admin");

    expect(res.body.data).toEqual({
      range: "7d",
      page: 1,
      page_size: 20,
      total: 0,
      total_pages: 0,
      since: null,
      items: [],
    });
  });
});

describe("issue #57：数据质量接口", () => {
  it("未登录 401、editor 403、range=abc 400", async () => {
    expect((await call("quality", "?range=7d")).status).toBe(401);
    expect(
      (await call("quality", "?range=7d", makeState(), "editor")).status
    ).toBe(403);
    expect(
      (await call("quality", "?range=abc", makeState(), "admin")).status
    ).toBe(400);
  });

  it("覆盖率 = pv/requests，bot 占比以原始请求为分母，令牌行数与告警标记", async () => {
    const res = await call("quality", "?range=7d", makeState(), "admin");

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      range: "7d",
      from: "2026-11-03",
      to: "2026-11-09",
      pv: 22,
      uv: 13,
      requests: 26,
      bot_filtered: 3,
      proxy_coverage_alert: true, // 22/26 < 0.9
      bot_ratio_alert: false,
      heartbeat_at: "2026-11-09 03:00:00",
      heartbeat_alert: false,
      token_rows: 42,
      token_rows_alert: false,
      anomaly: true,
      today_pv: 17,
      engaged_rate: null,
    });
    expect(res.body.data.proxy_coverage).toBeCloseTo(22 / 26, 6);
    expect(res.body.data.bot_ratio).toBeCloseTo(3 / 29, 6);
  });

  it("分母为 0 时覆盖率与 bot 占比为 null（前端显示 —）", async () => {
    const empty = makeState({ daily: [], dim: [], tokenRows: 0 });
    const res = await call("quality", "?range=7d", empty, "admin");

    expect(res.body.data.proxy_coverage).toBeNull();
    expect(res.body.data.bot_ratio).toBeNull();
    expect(res.body.data.proxy_coverage_alert).toBe(false);
    expect(res.body.data.bot_ratio_alert).toBe(false);
    expect(res.body.data.anomaly).toBe(false);
  });

  it("心跳缺失或 > 26h 告警；1 小时内不告警", async () => {
    const missing = makeState({ config: new Map() });
    expect(
      (await call("quality", "?range=7d", missing, "admin")).body.data
    ).toMatchObject({ heartbeat_at: null, heartbeat_alert: true });

    const stale = makeState({
      config: new Map([["analytics_last_job_at", "2026-11-08 00:00:00"]]),
    });
    expect(
      (await call("quality", "?range=7d", stale, "admin")).body.data
        .heartbeat_alert
    ).toBe(true);

    expect(
      (await call("quality", "?range=7d", makeState(), "admin")).body.data
        .heartbeat_alert
    ).toBe(false);
  });

  it("3σ：基线全 0 不误报；基线平坦非零且当日尖峰仍告警", async () => {
    const fresh = makeState({
      daily: [
        {
          article_id: 7,
          day: "2026-11-09",
          pv: 100,
          uv: 1,
          requests: 100,
          bot_filtered: 0,
        },
      ],
      dim: [],
    });
    expect(
      (await call("quality", "?range=7d", fresh, "admin")).body.data.anomaly
    ).toBe(false);

    const flat = makeState({
      daily: Array.from({ length: 7 }, (_, i) => ({
        article_id: 7,
        day: `2026-11-0${i + 2}`,
        pv: 10,
        uv: 1,
        requests: 10,
        bot_filtered: 0,
      })).concat([
        {
          article_id: 7,
          day: "2026-11-09",
          pv: 100,
          uv: 1,
          requests: 100,
          bot_filtered: 0,
        },
      ]),
      dim: [],
    });
    expect(
      (await call("quality", "?range=7d", flat, "admin")).body.data.anomaly
    ).toBe(true);
  });

  it("令牌行数 > 10 万给出告警标记", async () => {
    const heavy = makeState({ tokenRows: 100_001 });
    expect(
      (await call("quality", "?range=7d", heavy, "admin")).body.data
        .token_rows_alert
    ).toBe(true);
  });
});
