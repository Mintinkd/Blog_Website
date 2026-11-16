import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/index";
import { rateLimitMiddleware } from "../src/middleware/rate_limit";

/**
 * issue #48（H8）分桶口径 + issue #91（M3）统一限流算法。
 *
 * 接缝：rateLimitMiddleware —— 工单点名的「限流键构造 + 规则表 + 响应」。
 * 底层算法（滑动窗口计数）由 rate_limiter.test.ts 单独钉死，这里只断言策略层：
 *   - 同一模板下不同资源 id / 不同 slug 共享一个计数桶；
 *   - 规则按 method + 模板精确匹配；
 *   - 文章详情 /articles/:slug 跨 slug 共享宽松配额；
 *   - 配额边界、IP 解析、429 响应不变。
 *
 * 用有状态 KV 桩（按 key 存值）替代旧的顺序 mock——新算法每请求读当前/上一两个键。
 */

const FIXED_NOW = new Date("2026-10-26T12:00:00.000Z");
const MINUTE = 60_000;
const WINDOW_INDEX = Math.floor(FIXED_NOW.getTime() / MINUTE); // 0（12:00:00）

interface MockEnv {
  env: Env;
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  store: Map<string, string>;
}

/** 有状态 KV 桩：get 从 store 按 key 读，put 写回；spy 记录调用。 */
function makeEnv(): MockEnv {
  const store = new Map<string, string>();
  const get = vi.fn(async (key: string) => store.get(key) ?? null);
  const put = vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  });
  const env = {
    API_PREFIX: "/api/v1",
    RATE_LIMIT: { get, put },
  } as unknown as Env;
  return { env, get, put, store };
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function request(
  method: string,
  path: string,
  headers?: Record<string, string>
): Request {
  return new Request(`https://example.com/api/v1${path}`, { method, headers });
}

/** 当前窗口键（算法单测覆盖 prev 键，这里只需定位当前桶）。 */
function key(route: string, method: string, ip = "unknown"): string {
  return `ratelimit:global:${ip}:${method}:${route}:${WINDOW_INDEX}`;
}

/** 预置某桶已用配额（写当前窗口键）。 */
function seed(
  mock: MockEnv,
  route: string,
  method: string,
  count: number,
  ip = "unknown"
) {
  mock.store.set(key(route, method, ip), String(count));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("计数键归一化（issue #48）", () => {
  it("不同文章 id 的评论请求命中同一个计数键", async () => {
    const mock = makeEnv();
    const ctx = makeCtx();
    await rateLimitMiddleware(
      request("POST", "/articles/1/comments"),
      mock.env,
      ctx
    );
    await rateLimitMiddleware(
      request("POST", "/articles/2/comments"),
      mock.env,
      ctx
    );

    const currKeys = mock.put.mock.calls.map(([k]) => k);
    expect(currKeys[0]).toBe(key("/articles/:id/comments", "POST"));
    expect(currKeys[0]).toBe(currKeys[1]);
  });

  it("多数值段逐段归一：/articles/1/comments/2 → /articles/:id/comments/:id", async () => {
    const mock = makeEnv();
    expect(
      await rateLimitMiddleware(
        request("DELETE", "/articles/1/comments/2"),
        mock.env,
        makeCtx()
      )
    ).toBeNull();
    expect(mock.put.mock.calls[0][0]).toBe(
      key("/articles/:id/comments/:id", "DELETE")
    );
  });

  it("已命名的固定路径保持原样，数值资源段归一", async () => {
    const cases: Array<{ method: string; path: string; route: string }> = [
      {
        method: "POST",
        path: "/articles/123/like",
        route: "/articles/:id/like",
      },
      { method: "POST", path: "/media/upload", route: "/media/upload" },
      { method: "DELETE", path: "/media/9", route: "/media/:id" },
      { method: "PUT", path: "/articles/42", route: "/articles/:id" },
      { method: "DELETE", path: "/categories/7", route: "/categories/:id" },
      { method: "DELETE", path: "/tags/3", route: "/tags/:id" },
      { method: "DELETE", path: "/comments/11", route: "/comments/:id" },
    ];
    for (const c of cases) {
      const mock = makeEnv();
      expect(
        await rateLimitMiddleware(
          request(c.method, c.path),
          mock.env,
          makeCtx()
        )
      ).toBeNull();
      expect(mock.put.mock.calls[0][0]).toBe(key(c.route, c.method));
    }
  });

  it("尾部斜杠不会制造额外分桶", async () => {
    const mock = makeEnv();
    await rateLimitMiddleware(
      request("DELETE", "/articles/7/"),
      mock.env,
      makeCtx()
    );
    expect(mock.put.mock.calls[0][0]).toBe(key("/articles/:id", "DELETE"));
  });

  it("同一路径的不同 method 使用不同桶", async () => {
    const mock = makeEnv();
    await rateLimitMiddleware(
      request("POST", "/articles/1"),
      mock.env,
      makeCtx()
    );
    await rateLimitMiddleware(
      request("DELETE", "/articles/1"),
      mock.env,
      makeCtx()
    );
    const keys = mock.put.mock.calls.map(([k]) => k);
    expect(keys[0]).toBe(key("/articles/:id", "POST"));
    expect(keys[1]).toBe(key("/articles/:id", "DELETE"));
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe("同模板共享配额（issue #48 AC1/AC2）", () => {
  it("评论配额 3 次/分，遍历 article_id 不能放大", async () => {
    const mock = makeEnv();
    const ctx = makeCtx();
    for (let i = 0; i < 3; i += 1) {
      expect(
        await rateLimitMiddleware(
          request("POST", `/articles/${i + 1}/comments`),
          mock.env,
          ctx
        )
      ).toBeNull();
    }
    const blocked = await rateLimitMiddleware(
      request("POST", "/articles/999/comments"),
      mock.env,
      ctx
    );
    expect(blocked?.status).toBe(429);
    expect(mock.put).toHaveBeenCalledTimes(3);
    const keys = new Set(mock.put.mock.calls.map(([k]) => k));
    expect(keys.size).toBe(1);
  });

  it("点赞配额 10 次/分，跨文章共享", async () => {
    const mock = makeEnv();
    seed(mock, "/articles/:id/like", "POST", 9);
    expect(
      await rateLimitMiddleware(
        request("POST", "/articles/1/like"),
        mock.env,
        makeCtx()
      )
    ).toBeNull();
    const blocked = await rateLimitMiddleware(
      request("POST", "/articles/2/like"),
      mock.env,
      makeCtx()
    );
    expect(blocked?.status).toBe(429);
  });

  it("上传配额 10 次/分", async () => {
    const mock = makeEnv();
    seed(mock, "/media/upload", "POST", 9);
    expect(
      await rateLimitMiddleware(
        request("POST", "/media/upload"),
        mock.env,
        makeCtx()
      )
    ).toBeNull();
    expect(
      (
        await rateLimitMiddleware(
          request("POST", "/media/upload"),
          mock.env,
          makeCtx()
        )
      )?.status
    ).toBe(429);
  });

  it("GET /search 配额 10 次/分", async () => {
    const mock = makeEnv();
    seed(mock, "/search", "GET", 9);
    expect(
      await rateLimitMiddleware(
        request("GET", "/search?q=test"),
        mock.env,
        makeCtx()
      )
    ).toBeNull();
    expect(
      (
        await rateLimitMiddleware(
          request("GET", "/search?q=test"),
          mock.env,
          makeCtx()
        )
      )?.status
    ).toBe(429);
  });
});

describe("文章详情宽松限流（issue #91 / M3）", () => {
  it("不同 slug 共享同一宽松桶（跨 slug 不放大 D1 写）", async () => {
    const mock = makeEnv();
    await rateLimitMiddleware(
      request("GET", "/articles/hello-world"),
      mock.env,
      makeCtx()
    );
    await rateLimitMiddleware(
      request("GET", "/articles/another-post"),
      mock.env,
      makeCtx()
    );
    expect(mock.put).toHaveBeenCalledTimes(2);
    const keys = new Set(mock.put.mock.calls.map(([k]) => k));
    expect(keys.size).toBe(1);
    expect(mock.put.mock.calls[0][0]).toBe(key("/articles/:slug", "GET"));
  });

  it("文章详情配额 120 次/分，第 121 次被拒", async () => {
    const mock = makeEnv();
    seed(mock, "/articles/:slug", "GET", 119);
    expect(
      await rateLimitMiddleware(
        request("GET", "/articles/post-a"),
        mock.env,
        makeCtx()
      )
    ).toBeNull();
    const blocked = await rateLimitMiddleware(
      request("GET", "/articles/post-b"),
      mock.env,
      makeCtx()
    );
    expect(blocked?.status).toBe(429);
  });

  it("尾斜杠 /articles/hello/ 与 /articles/hello 命中同一详情桶（不可绕过）", async () => {
    const mock = makeEnv();
    await rateLimitMiddleware(
      request("GET", "/articles/hello"),
      mock.env,
      makeCtx()
    );
    await rateLimitMiddleware(
      request("GET", "/articles/hello/"),
      mock.env,
      makeCtx()
    );
    expect(mock.put).toHaveBeenCalledTimes(2);
    const keys = new Set(mock.put.mock.calls.map(([k]) => k));
    expect(keys.size).toBe(1);
    expect(mock.put.mock.calls[0][0]).toBe(key("/articles/:slug", "GET"));
  });

  it("列表 /articles 与编辑器 /articles/:id/edit 不套用详情限流", async () => {
    const mock = makeEnv();
    expect(
      await rateLimitMiddleware(
        request("GET", "/articles"),
        mock.env,
        makeCtx()
      )
    ).toBeNull();
    expect(
      await rateLimitMiddleware(
        request("GET", "/articles/7/edit"),
        mock.env,
        makeCtx()
      )
    ).toBeNull();
    expect(mock.put).not.toHaveBeenCalled();
  });
});

describe("未单列方法落到明确配额（issue #48 AC3）", () => {
  it("DELETE 默认 10 次/分，不借用 GET 的 60 次/分", async () => {
    const mock = makeEnv();
    seed(mock, "/friend-links/:id", "DELETE", 9);
    expect(
      await rateLimitMiddleware(
        request("DELETE", "/friend-links/1"),
        mock.env,
        makeCtx()
      )
    ).toBeNull();
    expect(
      (
        await rateLimitMiddleware(
          request("DELETE", "/friend-links/2"),
          mock.env,
          makeCtx()
        )
      )?.status
    ).toBe(429);
  });

  it("POST 默认 60 次/分", async () => {
    const mock = makeEnv();
    seed(mock, "/settings/import", "POST", 59);
    expect(
      await rateLimitMiddleware(
        request("POST", "/settings/import"),
        mock.env,
        makeCtx()
      )
    ).toBeNull();
    expect(
      (
        await rateLimitMiddleware(
          request("POST", "/settings/import"),
          mock.env,
          makeCtx()
        )
      )?.status
    ).toBe(429);
  });

  it("PUT 默认 60 次/分", async () => {
    const mock = makeEnv();
    seed(mock, "/settings", "PUT", 59);
    expect(
      await rateLimitMiddleware(
        request("PUT", "/settings"),
        mock.env,
        makeCtx()
      )
    ).toBeNull();
    expect(
      (
        await rateLimitMiddleware(
          request("PUT", "/settings"),
          mock.env,
          makeCtx()
        )
      )?.status
    ).toBe(429);
  });

  it("auth/admin 写操作维持 120 次/分", async () => {
    const mock = makeEnv();
    seed(mock, "/auth/login", "POST", 119);
    expect(
      await rateLimitMiddleware(
        request("POST", "/auth/login"),
        mock.env,
        makeCtx()
      )
    ).toBeNull();
    expect(
      (
        await rateLimitMiddleware(
          request("POST", "/auth/login"),
          mock.env,
          makeCtx()
        )
      )?.status
    ).toBe(429);
  });
});

describe("method + 模板精确匹配（issue #48）", () => {
  it("含 /comments 子串但不是评论模板的路径不套用 3 次/分", async () => {
    const mock = makeEnv();
    seed(mock, "/articles/:id/comments/:id", "POST", 3);
    expect(
      await rateLimitMiddleware(
        request("POST", "/articles/1/comments/2"),
        mock.env,
        makeCtx()
      )
    ).toBeNull();
    expect(mock.put.mock.calls[0][0]).toBe(
      key("/articles/:id/comments/:id", "POST")
    );
  });

  it("含 /like 子串但不是点赞模板的路径不套用 10 次/分", async () => {
    const mock = makeEnv();
    seed(mock, "/articles/:id/like-extra", "POST", 10);
    expect(
      await rateLimitMiddleware(
        request("POST", "/articles/1/like-extra"),
        mock.env,
        makeCtx()
      )
    ).toBeNull();
  });

  it("普通 GET 读接口完全跳过限流，不读写 KV", async () => {
    const mock = makeEnv();
    for (const path of [
      "/config",
      "/media",
      "/settings/public",
      "/categories",
      "/tags",
    ]) {
      expect(
        await rateLimitMiddleware(request("GET", path), mock.env, makeCtx())
      ).toBeNull();
    }
    expect(mock.get).not.toHaveBeenCalled();
    expect(mock.put).not.toHaveBeenCalled();
  });
});

describe("客户端 IP 与响应", () => {
  it("限流键包含解析出的客户端 IP", async () => {
    const mock = makeEnv();
    await rateLimitMiddleware(
      request("POST", "/articles/1/comments", {
        "CF-Connecting-IP": "203.0.113.7",
        "X-Forwarded-For": "198.51.100.9, 10.0.0.1",
      }),
      mock.env,
      makeCtx()
    );
    expect(mock.put.mock.calls[0][0]).toBe(
      key("/articles/:id/comments", "POST", "203.0.113.7")
    );
  });

  it("超限返回 429 与 RATE_LIMITED 错误码", async () => {
    const mock = makeEnv();
    seed(mock, "/articles/:id/comments", "POST", 3);
    const blocked = await rateLimitMiddleware(
      request("POST", "/articles/1/comments"),
      mock.env,
      makeCtx()
    );
    expect(blocked?.status).toBe(429);
    const body = (await blocked?.json()) as {
      code: number;
      message: string;
      data: null;
    };
    expect(body.code).toBe(10007);
    expect(body.message).toContain("Max 3 requests per minute");
    expect(body.data).toBeNull();
    expect(mock.put).not.toHaveBeenCalled();
  });
});
