import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/index";
import { rateLimitMiddleware } from "../src/middleware/rate_limit";

/**
 * issue #48（T6 / H8）：限流分桶改用规范化路由模板。
 *
 * 接缝：rateLimitMiddleware —— 工单点名的「限流键构造函数 + 限流规则表」。
 * 断言直接落在 KV 键名与配额边界上：
 *   - 同一模板下不同资源 id 必须共享同一个计数桶；
 *   - 规则按 method + 模板精确匹配，不做子串猜测；
 *   - DELETE 等未单列方法落到明确配额，不静默借用 GET 配额；
 *   - 窗口与既有阈值（评论 3、点赞 10、上传 10、搜索 10、admin/auth 120）不变。
 */

const FIXED_NOW = new Date("2026-10-26T12:00:00.000Z");
const MINUTE = 60_000;
const WINDOW_START = Math.floor(FIXED_NOW.getTime() / MINUTE);

interface MockEnv {
  env: Env;
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

function makeEnv(): MockEnv {
  const get = vi.fn(async (_key: string): Promise<string | null> => null);
  const put = vi.fn(
    async (_key: string, _value: string, _options?: unknown) => undefined
  );
  const env = {
    API_PREFIX: "/api/v1",
    RATE_LIMIT: { get, put },
  } as unknown as Env;
  return { env, get, put };
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

function expectKey(
  mock: ReturnType<typeof vi.fn>,
  route: string,
  method: string
): void {
  expect(mock.mock.calls[0][0]).toBe(
    `rate_limit:unknown:${method}:${route}:${WINDOW_START}`
  );
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
    const { env, get } = makeEnv();
    const ctx = makeCtx();

    get.mockResolvedValueOnce("0").mockResolvedValueOnce("1");

    expect(
      await rateLimitMiddleware(
        request("POST", "/articles/1/comments"),
        env,
        ctx
      )
    ).toBeNull();
    expect(
      await rateLimitMiddleware(
        request("POST", "/articles/2/comments"),
        env,
        ctx
      )
    ).toBeNull();

    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][0]).toBe(get.mock.calls[1][0]);
    expect(get.mock.calls[0][0]).toBe(
      `rate_limit:unknown:POST:/articles/:id/comments:${WINDOW_START}`
    );
  });

  it("多数值段逐段归一：/articles/1/comments/2 → /articles/:id/comments/:id", async () => {
    const { env, get } = makeEnv();

    const result = await rateLimitMiddleware(
      request("DELETE", "/articles/1/comments/2"),
      env,
      makeCtx()
    );

    expect(result).toBeNull();
    expectKey(get, "/articles/:id/comments/:id", "DELETE");
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

    for (const testCase of cases) {
      const { env, get } = makeEnv();
      const result = await rateLimitMiddleware(
        request(testCase.method, testCase.path),
        env,
        makeCtx()
      );
      expect(result).toBeNull();
      expectKey(get, testCase.route, testCase.method);
    }
  });

  it("尾部斜杠不会制造额外分桶", async () => {
    const { env, get } = makeEnv();

    expect(
      await rateLimitMiddleware(
        request("DELETE", "/articles/7/"),
        env,
        makeCtx()
      )
    ).toBeNull();
    expectKey(get, "/articles/:id", "DELETE");
  });

  it("同一路径的不同 method 使用不同桶", async () => {
    const { env, get } = makeEnv();

    await rateLimitMiddleware(request("POST", "/articles/1"), env, makeCtx());
    await rateLimitMiddleware(request("DELETE", "/articles/1"), env, makeCtx());

    expect(get.mock.calls[0][0]).toBe(
      `rate_limit:unknown:POST:/articles/:id:${WINDOW_START}`
    );
    expect(get.mock.calls[1][0]).toBe(
      `rate_limit:unknown:DELETE:/articles/:id:${WINDOW_START}`
    );
    expect(get.mock.calls[0][0]).not.toBe(get.mock.calls[1][0]);
  });

  it("同一分钟外的请求进入下一个窗口", async () => {
    const { env, get } = makeEnv();

    await rateLimitMiddleware(
      request("POST", "/articles/1/comments"),
      env,
      makeCtx()
    );
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + MINUTE));
    await rateLimitMiddleware(
      request("POST", "/articles/1/comments"),
      env,
      makeCtx()
    );

    expect(get.mock.calls[1][0]).toBe(
      `rate_limit:unknown:POST:/articles/:id/comments:${WINDOW_START + 1}`
    );
  });
});

describe("同模板共享配额（issue #48 AC1/AC2）", () => {
  it("评论配额 3 次/分，遍历 article_id 不能放大", async () => {
    const { env, get, put } = makeEnv();
    const ctx = makeCtx();

    for (let i = 0; i < 3; i += 1) {
      get.mockResolvedValueOnce(String(i));
      const result = await rateLimitMiddleware(
        request("POST", `/articles/${i + 1}/comments`),
        env,
        ctx
      );
      expect(result).toBeNull();
    }

    get.mockResolvedValueOnce("3");
    const blocked = await rateLimitMiddleware(
      request("POST", "/articles/999/comments"),
      env,
      ctx
    );

    expect(blocked?.status).toBe(429);
    expect(put).toHaveBeenCalledTimes(3);
    // 四次请求全部落在同一个键（0/1/2 放行并自增，3 被拒）
    const keys = new Set(get.mock.calls.map(([key]) => key));
    expect(keys.size).toBe(1);
  });

  it("点赞配额 10 次/分，跨文章共享", async () => {
    const { env, get } = makeEnv();

    get.mockResolvedValueOnce("9");
    expect(
      await rateLimitMiddleware(
        request("POST", "/articles/1/like"),
        env,
        makeCtx()
      )
    ).toBeNull();

    get.mockResolvedValueOnce("10");
    const blocked = await rateLimitMiddleware(
      request("POST", "/articles/2/like"),
      env,
      makeCtx()
    );
    expect(blocked?.status).toBe(429);
    expect(get.mock.calls[0][0]).toBe(get.mock.calls[1][0]);
  });

  it("上传配额 10 次/分", async () => {
    const { env, get } = makeEnv();

    get.mockResolvedValueOnce("9");
    expect(
      await rateLimitMiddleware(
        request("POST", "/media/upload"),
        env,
        makeCtx()
      )
    ).toBeNull();

    get.mockResolvedValueOnce("10");
    const blocked = await rateLimitMiddleware(
      request("POST", "/media/upload"),
      env,
      makeCtx()
    );
    expect(blocked?.status).toBe(429);
  });

  it("GET /search 配额 10 次/分", async () => {
    const { env, get } = makeEnv();

    get.mockResolvedValueOnce("9");
    expect(
      await rateLimitMiddleware(
        request("GET", "/search?q=test"),
        env,
        makeCtx()
      )
    ).toBeNull();

    get.mockResolvedValueOnce("10");
    const blocked = await rateLimitMiddleware(
      request("GET", "/search?q=test"),
      env,
      makeCtx()
    );
    expect(blocked?.status).toBe(429);
  });
});

describe("未单列方法落到明确配额（issue #48 AC3）", () => {
  it("DELETE 默认 10 次/分，不借用 GET 的 60 次/分", async () => {
    const { env, get } = makeEnv();

    get.mockResolvedValueOnce("9");
    expect(
      await rateLimitMiddleware(
        request("DELETE", "/friend-links/1"),
        env,
        makeCtx()
      )
    ).toBeNull();

    get.mockResolvedValueOnce("10");
    const blocked = await rateLimitMiddleware(
      request("DELETE", "/friend-links/2"),
      env,
      makeCtx()
    );
    expect(blocked?.status).toBe(429);
  });

  it("POST 默认 60 次/分保持不变", async () => {
    const { env, get } = makeEnv();

    get.mockResolvedValueOnce("59");
    expect(
      await rateLimitMiddleware(
        request("POST", "/settings/import"),
        env,
        makeCtx()
      )
    ).toBeNull();

    get.mockResolvedValueOnce("60");
    const blocked = await rateLimitMiddleware(
      request("POST", "/settings/import"),
      env,
      makeCtx()
    );
    expect(blocked?.status).toBe(429);
  });

  it("PUT 默认 60 次/分保持不变", async () => {
    const { env, get } = makeEnv();

    get.mockResolvedValueOnce("59");
    expect(
      await rateLimitMiddleware(request("PUT", "/settings"), env, makeCtx())
    ).toBeNull();

    get.mockResolvedValueOnce("60");
    const blocked = await rateLimitMiddleware(
      request("PUT", "/settings"),
      env,
      makeCtx()
    );
    expect(blocked?.status).toBe(429);
  });

  it("auth/admin 写操作维持 120 次/分", async () => {
    const { env, get } = makeEnv();

    get.mockResolvedValueOnce("119");
    expect(
      await rateLimitMiddleware(request("POST", "/auth/login"), env, makeCtx())
    ).toBeNull();

    get.mockResolvedValueOnce("120");
    const blocked = await rateLimitMiddleware(
      request("POST", "/auth/login"),
      env,
      makeCtx()
    );
    expect(blocked?.status).toBe(429);
  });
});

describe("method + 模板精确匹配（issue #48）", () => {
  it("含 /comments 子串但不是评论模板的路径不套用 3 次/分", async () => {
    const { env, get } = makeEnv();

    // 旧实现 pathname.includes('/comments') 会在这里落到 3 次/分并误伤。
    get.mockResolvedValueOnce("3");
    const result = await rateLimitMiddleware(
      request("POST", "/articles/1/comments/2"),
      env,
      makeCtx()
    );

    expect(result).toBeNull();
    expectKey(get, "/articles/:id/comments/:id", "POST");
  });

  it("含 /like 子串但不是点赞模板的路径不套用 10 次/分", async () => {
    const { env, get } = makeEnv();

    get.mockResolvedValueOnce("10");
    const result = await rateLimitMiddleware(
      request("POST", "/articles/1/like-extra"),
      env,
      makeCtx()
    );

    expect(result).toBeNull();
    expectKey(get, "/articles/:id/like-extra", "POST");
  });

  it("含 /media 子串但不是上传模板的路径不套用 10 次/分", async () => {
    const { env, get } = makeEnv();

    get.mockResolvedValueOnce("10");
    const result = await rateLimitMiddleware(
      request("POST", "/media/upload/extra"),
      env,
      makeCtx()
    );

    expect(result).toBeNull();
    expectKey(get, "/media/upload/extra", "POST");
  });

  it("普通 GET 读接口完全跳过限流，不读写 KV", async () => {
    const { env, get, put } = makeEnv();
    const ctx = makeCtx();

    for (const path of [
      "/articles",
      "/articles/hello",
      "/config",
      "/media",
      "/settings/public",
    ]) {
      expect(
        await rateLimitMiddleware(request("GET", path), env, ctx)
      ).toBeNull();
    }

    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});

describe("客户端 IP 与响应", () => {
  it("优先使用 CF-Connecting-IP", async () => {
    const { env, get } = makeEnv();

    await rateLimitMiddleware(
      request("POST", "/articles/1/comments", {
        "CF-Connecting-IP": "203.0.113.7",
        "X-Forwarded-For": "198.51.100.9, 10.0.0.1",
      }),
      env,
      makeCtx()
    );

    expect(get.mock.calls[0][0]).toBe(
      `rate_limit:203.0.113.7:POST:/articles/:id/comments:${WINDOW_START}`
    );
  });

  it("无 CF 头时取 X-Forwarded-For 的第一跳并去空白", async () => {
    const { env, get } = makeEnv();

    await rateLimitMiddleware(
      request("POST", "/articles/1/comments", {
        "X-Forwarded-For": " 198.51.100.9 , 10.0.0.1",
      }),
      env,
      makeCtx()
    );

    expect(get.mock.calls[0][0]).toBe(
      `rate_limit:198.51.100.9:POST:/articles/:id/comments:${WINDOW_START}`
    );
  });

  it("超限返回 429 与 RATE_LIMITED 错误码", async () => {
    const { env, get, put } = makeEnv();

    get.mockResolvedValueOnce("3");
    const blocked = await rateLimitMiddleware(
      request("POST", "/articles/1/comments"),
      env,
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
    // 超限请求不再自增计数
    expect(put).not.toHaveBeenCalled();
  });
});
