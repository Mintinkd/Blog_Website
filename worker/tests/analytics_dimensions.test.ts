import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../src/router";
import { generateToken } from "../src/middleware/auth";
import {
  dimensionBuckets,
  type AnalyticsDimension,
} from "../src/services/analytics_dimensions";
import type { VisitorContext } from "../src/utils/visitor_context";
import type { Env } from "../src/index";

/**
 * issue #56：Tier 0 维度桶映射、单篇写入与分布接口。
 *
 * 接缝（工单 Key interfaces 点名，见 docs/agents/testing.md:87）：
 *   - dimensionBuckets()：device / country / referrer 的表驱动边界值；
 *   - router() 全链路的 /admin/analytics/dimensions：鉴权、白名单、GROUP BY、小样本保护。
 * 期望值均为手写字面量，不从被测实现反推。
 */

const JWT_SECRET = "issue56-dimensions-test-secret";
const SITE_HOST = "api.example.test";
const NOW = new Date("2026-11-09T04:00:00.000Z"); // 上海 2026-11-09 12:00

function ctx(overrides: Partial<VisitorContext> = {}): VisitorContext {
  return {
    ip: "203.0.113.9",
    userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36",
    accept: "text/html",
    referer: null,
    acceptLanguage: null,
    secFetchMode: "navigate",
    secFetchDest: null,
    secPurpose: null,
    purpose: null,
    xPurpose: null,
    country: null,
    clientHints: {},
    ...overrides,
  };
}

const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36";

describe("issue #56：维度桶映射（表驱动）", () => {
  it("device：UA-CH 优先，回退 UA 解析覆盖平板 / 手机 / 桌面 / 未知", () => {
    const cases: Array<[string, Partial<VisitorContext>, string]> = [
      ["UA-CH ?1", { clientHints: { "sec-ch-ua-mobile": "?1" } }, "mobile"],
      [
        "UA-CH ?0 覆盖移动端 UA",
        {
          clientHints: { "sec-ch-ua-mobile": "?0" },
          userAgent: "Mozilla/5.0 (iPhone)",
        },
        "desktop",
      ],
      ["iPad", { userAgent: "Mozilla/5.0 (iPad)" }, "tablet"],
      [
        "Android 平板（无 Mobile）",
        { userAgent: "Mozilla/5.0 (Linux; Android 13; SM-X700)" },
        "tablet",
      ],
      ["iPhone", { userAgent: "Mozilla/5.0 (iPhone)" }, "mobile"],
      ["普通桌面 UA", { userAgent: DESKTOP_UA }, "desktop"],
      ["UA 缺失", { userAgent: null }, "unknown"],
    ];

    for (const [label, overrides, expected] of cases) {
      expect(dimensionBuckets(ctx(overrides), SITE_HOST).device, label).toBe(
        expected
      );
    }
  });

  it("country：两位码原样使用，缺失落 unknown", () => {
    expect(dimensionBuckets(ctx({ country: "CN" }), SITE_HOST).country).toBe(
      "CN"
    );
    expect(dimensionBuckets(ctx({ country: "T1" }), SITE_HOST).country).toBe(
      "T1"
    );
    expect(dimensionBuckets(ctx(), SITE_HOST).country).toBe("unknown");
  });

  it("referrer：只取域名、同站 internal、缺失/非法 direct", () => {
    const cases: Array<[string, string | null, string]> = [
      ["缺失", null, "direct"],
      ["非法 URL", "not a url", "direct"],
      ["非 http(s) 协议", "javascript:alert(1)", "direct"],
      [
        "同站带 path/query",
        "https://api.example.test/articles/ssr?q=1",
        "internal",
      ],
      [
        "外站剥 path/query/端口并小写",
        "https://NEWS.Example.test:8443/post?q=1#frag",
        "news.example.test",
      ],
      [
        "同站后缀欺骗不判 internal",
        "https://api.example.test.evil.com/",
        "api.example.test.evil.com",
      ],
    ];

    for (const [label, referer, expected] of cases) {
      expect(
        dimensionBuckets(ctx({ referer }), SITE_HOST).referrer,
        label
      ).toBe(expected);
    }
  });

  it("一次返回三个维度的桶键，且顺序稳定", () => {
    expect(Object.keys(dimensionBuckets(ctx(), SITE_HOST))).toEqual([
      "device",
      "country",
      "referrer",
    ]);
  });
});

interface DimRow {
  day: string;
  dim: string;
  bucket: string;
  article_id: number;
  count: number;
}

/** 全站与逐篇求和一致；另含小样本合并、数据不足、范围外三组数据 */
const DIM_ROWS: DimRow[] = [
  {
    day: "2026-11-09",
    dim: "device",
    bucket: "desktop",
    article_id: 7,
    count: 12,
  },
  {
    day: "2026-11-09",
    dim: "device",
    bucket: "mobile",
    article_id: 7,
    count: 9,
  },
  {
    day: "2026-11-09",
    dim: "device",
    bucket: "desktop",
    article_id: 8,
    count: 8,
  },
  {
    day: "2026-11-09",
    dim: "device",
    bucket: "tablet",
    article_id: 8,
    count: 13,
  },
  {
    day: "2026-11-09",
    dim: "referrer",
    bucket: "news.example.test",
    article_id: 7,
    count: 18,
  },
  {
    day: "2026-11-09",
    dim: "referrer",
    bucket: "tiny.example.test",
    article_id: 7,
    count: 3,
  },
  {
    day: "2026-11-09",
    dim: "referrer",
    bucket: "tiny2.example.test",
    article_id: 7,
    count: 2,
  },
  { day: "2026-11-09", dim: "country", bucket: "CN", article_id: 7, count: 7 },
  { day: "2026-11-09", dim: "country", bucket: "US", article_id: 7, count: 4 },
  {
    day: "2026-10-01",
    dim: "device",
    bucket: "desktop",
    article_id: 7,
    count: 99,
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
        return Promise.resolve(null);
      },
      all: () => {
        if (
          sql.includes("FROM analytics_dim_daily") &&
          sql.includes("GROUP BY bucket")
        ) {
          const [from, to, dim, articleId] = statement.binds;
          const grouped = new Map<string, number>();
          for (const row of DIM_ROWS) {
            if (row.day < String(from) || row.day > String(to)) continue;
            if (row.dim !== String(dim)) continue;
            if (articleId !== undefined && row.article_id !== Number(articleId))
              continue;
            grouped.set(row.bucket, (grouped.get(row.bucket) ?? 0) + row.count);
          }
          return Promise.resolve({
            results: Array.from(grouped, ([bucket, count]) => ({
              bucket,
              count,
            })),
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

async function callDimensions(
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
    `https://api.example.test/api/v1/admin/analytics/dimensions${query}`,
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

describe("issue #56：分布接口鉴权与白名单", () => {
  it("未登录 401、editor 403", async () => {
    expect((await callDimensions("?dim=device&range=7d")).status).toBe(401);
    expect(
      (await callDimensions("?dim=device&range=7d", "editor")).status
    ).toBe(403);
  });

  it("dim / range / article_id 非法值一律 400", async () => {
    for (const query of [
      "?dim=abc&range=7d",
      "?dim=device&range=abc",
      "?dim=device&range=7d&article_id=abc",
      "?dim=device&range=7d&article_id=0",
      "?dim=device&range=7d&article_id=-1",
    ]) {
      expect((await callDimensions(query, "admin")).status, query).toBe(400);
    }
  });

  it("三个 Tier 0 维度与四个 range 都放行", async () => {
    for (const dim of [
      "device",
      "country",
      "referrer",
    ] as AnalyticsDimension[]) {
      for (const range of ["today", "7d", "30d", "90d"]) {
        expect(
          (await callDimensions(`?dim=${dim}&range=${range}`, "admin")).status,
          `${dim}/${range}`
        ).toBe(200);
      }
    }
  });
});

describe("issue #56：全站聚合与小样本保护", () => {
  it("全站按 GROUP BY 聚合，结果等于逐篇求和；范围外数据不计入", async () => {
    const all = await callDimensions("?dim=device&range=7d", "admin");
    expect(all.body.data).toEqual({
      dim: "device",
      range: "7d",
      article_id: null,
      total: 42,
      insufficient: false,
      buckets: [
        { bucket: "desktop", count: 20 }, // 12 + 8
        { bucket: "tablet", count: 13 },
        { bucket: "mobile", count: 9 },
      ],
    });

    const seventh = await callDimensions(
      "?dim=device&range=7d&article_id=7",
      "admin"
    );
    const eighth = await callDimensions(
      "?dim=device&range=7d&article_id=8",
      "admin"
    );
    const perArticle = new Map<string, number>();
    for (const row of [
      ...seventh.body.data.buckets,
      ...eighth.body.data.buckets,
    ]) {
      perArticle.set(row.bucket, (perArticle.get(row.bucket) ?? 0) + row.count);
    }
    expect(Object.fromEntries(perArticle)).toEqual({
      desktop: 20,
      mobile: 9,
      tablet: 13,
    });
  });

  it("桶计数 < 5 合并进 other，other 恒排最后", async () => {
    const res = await callDimensions("?dim=referrer&range=7d", "admin");
    expect(res.body.data).toEqual({
      dim: "referrer",
      range: "7d",
      article_id: null,
      total: 23,
      insufficient: false,
      buckets: [
        { bucket: "news.example.test", count: 18 },
        { bucket: "other", count: 5 }, // 3 + 2
      ],
    });
  });

  it("维度总样本 < 20 返回 insufficient 且不返回桶", async () => {
    const res = await callDimensions("?dim=country&range=7d", "admin");
    expect(res.body.data).toEqual({
      dim: "country",
      range: "7d",
      article_id: null,
      total: 11,
      insufficient: true,
      buckets: [],
    });
  });

  it("指定 article_id 只统计该篇，回显该 id", async () => {
    const res = await callDimensions(
      "?dim=device&range=7d&article_id=7",
      "admin"
    );
    expect(res.body.data).toMatchObject({
      article_id: 7,
      total: 21,
      insufficient: false,
      buckets: [
        { bucket: "desktop", count: 12 },
        { bucket: "mobile", count: 9 },
      ],
    });
  });
});
