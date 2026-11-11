import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleGetArticle } from "../src/handlers/article";
import type { Env } from "../src/index";
import type { AuthResult } from "../src/middleware/auth";

/**
 * issue #55：`GET /articles/:slug` 的 Tier 0 计数契约（docs/READER_ANALYTICS.md §4）。
 *
 * 接缝（工单 Key interfaces 点名，见 docs/agents/testing.md:87）：
 *   - handleGetArticle → recordArticleView：过滤 / 去重 / 日聚合 / Cookie 全链路；
 *   - 概览接口的 router 级鉴权见 tests/analytics_overview.test.ts。
 *
 * D1 用按 SQL 语义执行的内存桩（沿用 analytics_cleanup.test.ts 的做法）；
 * 期望值均为手写字面量，不从被测实现反推。
 */

const ARTICLE_ID = 7;
const VIEW_COOKIE = "view_7=1; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly";
const HMAC_SECRET = "a".repeat(64);

/** 2026-11-04 12:00 Asia/Shanghai；跨日用 15:59Z / 16:01Z 切到次日 */
const NOW = new Date("2026-11-04T04:00:00.000Z");

const ADMIN: AuthResult = {
  username: "adminuser",
  role: "admin",
  mustChangePassword: false,
};

/** 通过 §4.1 七条规则、且带 SSR 转发的 X-Real-IP 的浏览器请求 */
const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
  accept: "text/html,application/xhtml+xml",
  "x-real-ip": "203.0.113.9",
  "sec-fetch-mode": "navigate",
};

interface DailyRow {
  article_id: number;
  day: string;
  pv: number;
  uv: number;
  requests: number;
  bot_filtered: number;
  engaged: number;
}

interface TokenRow {
  token: string;
  day: string;
  expires_at: string;
}

interface DimRow {
  day: string;
  dim: string;
  bucket: string;
  article_id: number;
  count: number;
}

interface State {
  status: "published" | "draft";
  viewCount: number;
  daily: DailyRow[];
  tokens: TokenRow[];
  dimRows: DimRow[];
  config: Map<string, string>;
  /** 非 batch 执行的写语句 */
  writes: string[];
  /** 每次 batch() 调用内的写语句，用于断言原子提交 */
  batches: string[][];
  /** 模拟生产缺表 / D1 故障：analytics 写入一律抛错（2026-11-11 故障回归） */
  failAnalyticsWrites?: boolean;
}

const COUNTERS = ["pv", "uv", "requests", "bot_filtered", "engaged"] as const;

function makeState(overrides: Partial<State> = {}): State {
  return {
    status: "published",
    viewCount: 1,
    daily: [],
    tokens: [],
    dimRows: [],
    config: new Map([["analytics_hmac_secret", HMAC_SECRET]]),
    writes: [],
    batches: [],
    ...overrides,
  };
}

interface FakeStatement {
  sql: string;
  binds: unknown[];
  bind(...args: unknown[]): FakeStatement;
  run(): Promise<{ success: boolean; meta: { changes: number } }>;
  first<T = unknown>(): Promise<T | null>;
  all(): Promise<{ results: unknown[] }>;
}

/** 按 SQL 语义落库；SQL 改了写法（如去掉 `x = x + 1`）测试必须跟着失败 */
function applyWrite(state: State, sql: string, binds: unknown[]): void {
  if (sql.includes("analytics_hmac_secret")) {
    if (!state.config.get("analytics_hmac_secret")) {
      state.config.set("analytics_hmac_secret", String(binds[0]));
    }
    return;
  }
  if (sql.startsWith("INSERT INTO analytics_view_token")) {
    state.tokens.push({
      token: String(binds[0]),
      day: String(binds[1]),
      expires_at: String(binds[2]),
    });
    return;
  }
  if (sql.startsWith("INSERT INTO analytics_article_daily")) {
    const articleId = Number(binds[0]);
    const day = String(binds[1]);
    let row = state.daily.find(
      (r) => r.article_id === articleId && r.day === day
    );
    if (!row) {
      row = {
        article_id: articleId,
        day,
        pv: 0,
        uv: 0,
        requests: 0,
        bot_filtered: 0,
        engaged: 0,
      };
      state.daily.push(row);
    }
    for (const counter of COUNTERS) {
      if (new RegExp(`\\b${counter} = ${counter} \\+ 1\\b`).test(sql)) {
        row[counter] += 1;
      }
    }
    return;
  }
  if (sql.startsWith("INSERT INTO analytics_dim_daily")) {
    if (!sql.includes("count = count + 1")) {
      throw new Error(`Unexpected dim SQL: ${sql}`);
    }
    const day = String(binds[0]);
    const dim = String(binds[1]);
    const bucket = String(binds[2]);
    const articleId = Number(binds[3]);
    let row = state.dimRows.find(
      (r) =>
        r.day === day &&
        r.dim === dim &&
        r.bucket === bucket &&
        r.article_id === articleId
    );
    if (!row) {
      row = { day, dim, bucket, article_id: articleId, count: 0 };
      state.dimRows.push(row);
    }
    row.count += 1;
    return;
  }
  if (sql.startsWith("UPDATE articles SET view_count")) {
    state.viewCount += 1;
    return;
  }
  throw new Error(`Unexpected write SQL: ${sql}`);
}

function makeEnv(state: State): Env {
  const prepare = (sql: string): FakeStatement => {
    const stmt: FakeStatement = {
      sql,
      binds: [],
      bind(...args: unknown[]) {
        stmt.binds = args;
        return stmt;
      },
      async run() {
        if (state.failAnalyticsWrites && sql.includes("analytics_")) {
          throw new Error("no such table: analytics_article_daily");
        }
        state.writes.push(sql);
        applyWrite(state, sql, stmt.binds);
        return { success: true, meta: { changes: 1 } };
      },
      async first<T = unknown>(): Promise<T | null> {
        if (sql.includes("FROM articles a")) {
          return {
            id: ARTICLE_ID,
            title: "服务端渲染",
            slug: "ssr",
            content: "正文",
            content_html: "",
            summary: "摘要",
            cover_image: "",
            category_id: null,
            category_name: null,
            category_slug: null,
            status: state.status,
            view_count: state.viewCount,
            like_count: 0,
            comment_count: 0,
            author_id: null,
            author_name: null,
            published_at: "2026-10-22T00:00:00.000Z",
            created_at: "2026-10-22T00:00:00.000Z",
          } as T;
        }
        if (sql.includes("key = 'analytics_hmac_secret'")) {
          const value = state.config.get("analytics_hmac_secret");
          return value ? ({ value } as T) : null;
        }
        if (sql.includes("FROM analytics_view_token")) {
          const found = state.tokens.find(
            (t) => t.token === String(stmt.binds[0])
          );
          return found ? ({ token: found.token } as T) : null;
        }
        return null;
      },
      async all() {
        return { results: [] };
      },
    };
    return stmt;
  };

  const db = {
    prepare,
    async batch(statements: FakeStatement[]) {
      if (state.failAnalyticsWrites) {
        throw new Error("no such table: analytics_article_daily");
      }
      const group: string[] = [];
      for (const statement of statements) {
        group.push(statement.sql);
        applyWrite(state, statement.sql, statement.binds);
      }
      state.batches.push(group);
      return [];
    },
  };
  return { DB: db } as unknown as Env;
}

function visit(
  env: Env,
  options: { headers?: Record<string, string>; auth?: AuthResult } = {}
): Promise<Response> {
  return handleGetArticle(
    new Request("https://api.example.test/api/v1/articles/ssr", {
      headers: options.headers ?? BROWSER_HEADERS,
    }),
    env,
    { slug: "ssr" },
    options.auth
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("issue #55：同 Cookie 与令牌去重", () => {
  it("同 Cookie 连续两次：view_count +1、pv +2、uv +1、requests +2", async () => {
    const state = makeState();
    const env = makeEnv(state);

    const first = await visit(env);
    const second = await visit(env, {
      headers: { ...BROWSER_HEADERS, cookie: "view_7=1" },
    });

    expect(first.status).toBe(200);
    expect(first.headers.get("set-cookie")).toBe(VIEW_COOKIE);
    expect(second.headers.get("set-cookie")).toBeNull();
    expect(state.viewCount).toBe(2);
    expect(state.daily).toEqual([
      {
        article_id: 7,
        day: "2026-11-04",
        pv: 2,
        uv: 1,
        requests: 2,
        bot_filtered: 0,
        engaged: 0,
      },
    ]);
  });

  it("无 Cookie 但同 IP+UA 同日：令牌兜底，UV 只 +1", async () => {
    const state = makeState();
    const env = makeEnv(state);

    await visit(env);
    await visit(env);

    expect(state.viewCount).toBe(2);
    expect(state.tokens).toHaveLength(1);
    expect(state.daily[0]).toMatchObject({ pv: 2, uv: 1, requests: 2 });
  });

  it("首次计数用一次 D1 batch 原子提交令牌 + 日聚合 + 阅读量 + 三个维度桶", async () => {
    const state = makeState();
    const env = makeEnv(state);

    await visit(env);

    expect(state.batches).toHaveLength(1);
    expect(state.batches[0]).toHaveLength(6);
    expect(
      state.batches[0].filter((sql) => sql.includes("analytics_dim_daily"))
    ).toHaveLength(3);
    expect(
      state.batches[0].some((sql) => sql.includes("analytics_view_token"))
    ).toBe(true);
    expect(
      state.batches[0].some((sql) => sql.includes("analytics_article_daily"))
    ).toBe(true);
    expect(
      state.batches[0].some((sql) =>
        sql.includes("UPDATE articles SET view_count")
      )
    ).toBe(true);
  });

  it("跨日（Asia/Shanghai）同一 IP+UA：各计一次 UV", async () => {
    const state = makeState();
    const env = makeEnv(state);

    vi.setSystemTime(new Date("2026-11-04T15:59:00.000Z")); // 上海 23:59
    await visit(env);
    vi.setSystemTime(new Date("2026-11-04T16:01:00.000Z")); // 上海次日 00:01
    await visit(env);

    expect(state.tokens).toHaveLength(2);
    expect(
      state.daily.map((row) => ({ day: row.day, uv: row.uv, pv: row.pv }))
    ).toEqual([
      { day: "2026-11-04", uv: 1, pv: 1 },
      { day: "2026-11-05", uv: 1, pv: 1 },
    ]);
    expect(state.viewCount).toBe(3);
  });
});

describe("issue #55：§4.1 过滤与直连口径", () => {
  it("爬虫 UA / Sec-Purpose: prefetch / Sec-Fetch-Mode: no-cors 只累加 bot_filtered", async () => {
    const state = makeState();
    const env = makeEnv(state);

    await visit(env, {
      headers: { ...BROWSER_HEADERS, "user-agent": "Googlebot/2.1" },
    });
    await visit(env, {
      headers: { ...BROWSER_HEADERS, "sec-purpose": "prefetch" },
    });
    await visit(env, {
      headers: { ...BROWSER_HEADERS, "sec-fetch-mode": "no-cors" },
    });

    expect(state.daily).toEqual([
      {
        article_id: 7,
        day: "2026-11-04",
        pv: 0,
        uv: 0,
        requests: 0,
        bot_filtered: 3,
        engaged: 0,
      },
    ]);
    expect(state.viewCount).toBe(1);
    expect(state.tokens).toHaveLength(0);
  });

  it("草稿预览不计数、不下发 Cookie", async () => {
    const state = makeState({ status: "draft" });
    const env = makeEnv(state);

    const res = await visit(env, { auth: ADMIN });

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(state.daily).toHaveLength(0);
    expect(state.writes).toHaveLength(0);
    expect(state.batches).toHaveLength(0);
    expect(state.viewCount).toBe(1);
  });

  it("直连 API（无 X-Real-IP）：requests +1，pv/uv 与阅读量不变", async () => {
    const state = makeState();
    const env = makeEnv(state);
    const { "x-real-ip": _ip, ...directHeaders } = BROWSER_HEADERS;

    const res = await visit(env, { headers: directHeaders });

    expect(res.status).toBe(200);
    expect(state.daily).toEqual([
      {
        article_id: 7,
        day: "2026-11-04",
        pv: 0,
        uv: 0,
        requests: 1,
        bot_filtered: 0,
        engaged: 0,
      },
    ]);
    expect(state.viewCount).toBe(1);
    expect(state.tokens).toHaveLength(0);
    expect(res.headers.get("set-cookie")).toBe(VIEW_COOKIE);
  });

  it("被过滤的直连请求既不计 requests 也不计 bot_filtered", async () => {
    const state = makeState();
    const env = makeEnv(state);
    const { "x-real-ip": _ip, ...directHeaders } = BROWSER_HEADERS;

    await visit(env, {
      headers: { ...directHeaders, "user-agent": "curl/8.0" },
    });

    expect(state.daily).toHaveLength(0);
    expect(state.writes).toHaveLength(0);
    expect(state.batches).toHaveLength(0);
  });
});

describe("issue #56：维度桶随去重访客计数写入", () => {
  const RICH_HEADERS = {
    ...BROWSER_HEADERS,
    "x-visitor-country": "CN",
    "sec-ch-ua-mobile": "?1",
    referer: "https://news.example.test/post?q=1",
  };

  it("新访客落 3 个单篇维度桶；同日不同访客累加，不产生全站行", async () => {
    const state = makeState();
    const env = makeEnv(state);

    await visit(env, {
      headers: { ...RICH_HEADERS, "x-real-ip": "203.0.113.9" },
    });
    await visit(env, {
      headers: { ...RICH_HEADERS, "x-real-ip": "203.0.113.10" },
    });

    expect(state.dimRows).toEqual([
      {
        day: "2026-11-04",
        dim: "device",
        bucket: "mobile",
        article_id: 7,
        count: 2,
      },
      {
        day: "2026-11-04",
        dim: "country",
        bucket: "CN",
        article_id: 7,
        count: 2,
      },
      {
        day: "2026-11-04",
        dim: "referrer",
        bucket: "news.example.test",
        article_id: 7,
        count: 2,
      },
    ]);
    expect(state.dimRows.every((row) => row.article_id === 7)).toBe(true);
  });

  it("Cookie 命中 / 令牌命中 / 直连 / 被过滤都不写维度桶", async () => {
    const state = makeState();
    const env = makeEnv(state);
    const { "x-real-ip": _ip, ...directHeaders } = BROWSER_HEADERS;

    await visit(env);
    expect(state.dimRows).toHaveLength(3);

    await visit(env, {
      headers: { ...BROWSER_HEADERS, cookie: "view_7=1" },
    });
    await visit(env); // 令牌命中
    await visit(env, { headers: directHeaders }); // 直连
    await visit(env, {
      headers: { ...BROWSER_HEADERS, "user-agent": "Googlebot/2.1" },
    });

    expect(state.dimRows).toHaveLength(3);
    expect(state.dimRows.every((row) => row.count === 1)).toBe(true);
  });
});

describe("2026-11-11 故障回归：计数失败不得拖挂文章详情响应", () => {
  it("D1 写入抛错时仍返回 200 与正文、不下发去重 Cookie，并记录错误日志", async () => {
    const state = makeState({ failAnalyticsWrites: true });
    const env = makeEnv(state);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await visit(env);
      const body = (await res.json()) as {
        code: number;
        data: { title: string };
      };

      expect(res.status).toBe(200);
      expect(body.code).toBe(0);
      expect(body.data.title).toBe("服务端渲染");
      expect(res.headers.get("Set-Cookie")).toBeNull();
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
});
