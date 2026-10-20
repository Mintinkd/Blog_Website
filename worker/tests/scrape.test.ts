import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleScrape,
  MAX_HTML_SIZE,
  SCRAPE_RATE_MAX,
  SCRAPE_TIMEOUT_MS,
  SCRAPER_TOKEN,
} from "../src/handlers/scrape";
import type { Env } from "../src/index";
import type { AuthResult } from "../src/middleware/auth";

/**
 * #33 / ADR 0003：admin-only HTML 抓取代理的 handler 接缝。
 *
 * fetch 以桩替换：robots.txt、目标页面、DoH 按 URL 分流并记录调用，
 * 用于断言「拒绝时不发起目标请求」。目标统一用公网 IP 字面量，
 * 避免解析后 IP 复核额外走 DoH（SSRF 地址矩阵已由 img_proxy.test.ts 覆盖）。
 */

const PUBLIC_TARGET = "https://93.184.216.34/article";
const HTML =
  "<!doctype html><html><head><title>Article</title></head><body><p>hello</p></body></html>";
const ADMIN: AuthResult = {
  username: "admin",
  role: "admin",
  mustChangePassword: false,
};

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;

interface NetworkStub {
  robotsCalls: string[];
  targetCalls: string[];
  dohCalls: string[];
}

function netAnswer(records: { type: "A" | "AAAA"; data: string }[]): Response {
  return new Response(
    JSON.stringify({
      Status: 0,
      Answer: records.map((r) => ({
        name: "target.example.org",
        type: r.type === "A" ? 1 : 28,
        data: r.data,
        TTL: 300,
      })),
    }),
    { status: 200, headers: { "Content-Type": "application/dns-json" } }
  );
}

function installNetworkStub(routes: {
  robots?: Route;
  target?: Route;
}): NetworkStub {
  const calls: NetworkStub = { robotsCalls: [], targetCalls: [], dohCalls: [] };
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (href.startsWith("https://cloudflare-dns.com/dns-query")) {
      calls.dohCalls.push(href);
      return Promise.resolve(netAnswer([{ type: "A", data: "93.184.216.34" }]));
    }

    const url = new URL(href);
    if (url.pathname === "/robots.txt") {
      calls.robotsCalls.push(href);
      return Promise.resolve(
        routes.robots
          ? routes.robots(url, init)
          : new Response("User-agent: *\nAllow: /\n", {
              status: 200,
              headers: { "Content-Type": "text/plain" },
            })
      );
    }

    calls.targetCalls.push(href);
    return Promise.resolve(
      routes.target
        ? routes.target(url, init)
        : new Response(HTML, {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          })
    );
  });
  return calls;
}

function makeEnv(rateCount?: { key: string; count: number }): {
  env: Env;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  if (rateCount) store.set(rateCount.key, String(rateCount.count));
  const kv = {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  };
  return { env: { RATE_LIMIT: kv } as unknown as Env, store };
}

function scrapeRequest(url = PUBLIC_TARGET, init?: RequestInit): Request {
  return new Request(
    `https://api.example.com/api/v1/admin/scrape?url=${encodeURIComponent(url)}`,
    init
  );
}

async function run(
  env: Env,
  url = PUBLIC_TARGET,
  auth: AuthResult = ADMIN
): Promise<Response> {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => pending.push(p),
  } as unknown as ExecutionContext;
  const res = await handleScrape(scrapeRequest(url), env, ctx, auth);
  await Promise.all(pending);
  return res;
}

async function bodyOf(
  res: Response
): Promise<{ code: number; message: string; data: null }> {
  return (await res.json()) as { code: number; message: string; data: null };
}

function rateKey(username = "admin", now = Date.now()): string {
  return `scrape:${username}:${Math.floor(now / 60_000)}`;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("GET /admin/scrape 安全抓取代理", () => {
  it("非 admin 直接调用 handler 返回 403，且不发起任何请求", async () => {
    const calls = installNetworkStub({});
    const { env } = makeEnv();

    const res = await run(env, PUBLIC_TARGET, {
      username: "editor",
      role: "editor",
      mustChangePassword: false,
    });

    expect(res.status).toBe(403);
    expect(calls.robotsCalls).toEqual([]);
    expect(calls.targetCalls).toEqual([]);
  });

  it("robots 允许时返回 HTML，只透传 Content-Type，并带 final URL / robots / no-store", async () => {
    const calls = installNetworkStub({
      target: () =>
        new Response(HTML, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Set-Cookie": "session=secret",
            "Content-Encoding": "gzip",
            "Content-Length": String(HTML.length),
            "X-Upstream-Secret": "leak",
          },
        }),
    });
    const { env } = makeEnv();

    const res = await run(env);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(HTML);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(decodeURIComponent(res.headers.get("x-final-url") || "")).toBe(
      PUBLIC_TARGET
    );
    expect(res.headers.get("x-robots-status")).toBe("allowed");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("x-upstream-secret")).toBeNull();
    expect(calls.targetCalls).toEqual([PUBLIC_TARGET]);
  });

  it("robots 拒绝时返回 403 并带匹配规则，且不抓取目标", async () => {
    const calls = installNetworkStub({
      robots: () =>
        new Response(
          [
            "User-agent: *",
            "Allow: /",
            "",
            `User-agent: ${SCRAPER_TOKEN}`,
            "Disallow: /private",
          ].join("\n"),
          { status: 200, headers: { "Content-Type": "text/plain" } }
        ),
    });
    const { env } = makeEnv();

    const res = await run(env, "https://93.184.216.34/private/post");

    expect(res.status).toBe(403);
    const body = await bodyOf(res);
    expect(body.message).toContain("Disallow: /private");
    expect(calls.robotsCalls).toEqual(["https://93.184.216.34/robots.txt"]);
    expect(calls.targetCalls).toEqual([]);
  });

  it("robots 特定 UA 组优先于 * 组（* 禁止但爬虫组允许）", async () => {
    const calls = installNetworkStub({
      robots: () =>
        new Response(
          [
            "User-agent: *",
            "Disallow: /",
            "",
            `User-agent: ${SCRAPER_TOKEN}`,
            "Allow: /articles/",
          ].join("\n"),
          { status: 200, headers: { "Content-Type": "text/plain" } }
        ),
    });
    const { env } = makeEnv();

    const res = await run(env, "https://93.184.216.34/articles/post");

    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-status")).toBe("allowed");
    expect(calls.targetCalls).toEqual(["https://93.184.216.34/articles/post"]);
  });

  it("robots 404 时放行并标记 unchecked", async () => {
    installNetworkStub({
      robots: () => new Response("not found", { status: 404 }),
    });
    const { env } = makeEnv();

    const res = await run(env);

    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-status")).toBe("unchecked");
  });

  it("robots 410 时放行并标记 unchecked", async () => {
    installNetworkStub({
      robots: () => new Response("gone", { status: 410 }),
    });
    const { env } = makeEnv();

    const res = await run(env);

    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-status")).toBe("unchecked");
  });

  it("robots 拉取失败（网络异常）时放行并标记 unchecked", async () => {
    installNetworkStub({
      robots: () => {
        throw new Error("network down");
      },
    });
    const { env } = makeEnv();

    const res = await run(env);

    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-status")).toBe("unchecked");
  });

  it("SSRF 拦截内网目标，且不发起任何目标或 robots 请求", async () => {
    const calls = installNetworkStub({});
    const { env } = makeEnv();

    const res = await run(env, "http://127.0.0.1/secret");

    expect(res.status).toBe(403);
    expect(calls.robotsCalls).toEqual([]);
    expect(calls.targetCalls).toEqual([]);
  });

  it("重定向到内网地址时拒绝，且不请求该跳", async () => {
    const calls = installNetworkStub({
      target: () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/secret" },
        }),
    });
    const { env } = makeEnv();

    const res = await run(env);

    expect(res.status).toBe(403);
    expect(calls.targetCalls).toEqual([PUBLIC_TARGET]);
  });

  it("非 HTML 上游返回 415", async () => {
    installNetworkStub({
      target: () =>
        new Response('{"ok":true}', {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    const { env } = makeEnv();

    const res = await run(env);

    expect(res.status).toBe(415);
    await expect(bodyOf(res)).resolves.toMatchObject({ code: 415 });
  });

  it("HTML 超过 2MB 时返回 413", async () => {
    const oversized = "a".repeat(MAX_HTML_SIZE + 1);
    installNetworkStub({
      target: () =>
        new Response(oversized, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    });
    const { env } = makeEnv();

    const res = await run(env);

    expect(res.status).toBe(413);
  });

  it("上游非 2xx 返回 502", async () => {
    installNetworkStub({
      target: () => new Response("boom", { status: 500 }),
    });
    const { env } = makeEnv();

    const res = await run(env);

    expect(res.status).toBe(502);
    await expect(bodyOf(res)).resolves.toMatchObject({ code: 502 });
  });

  it("10s 总超时返回 504", async () => {
    vi.useFakeTimers();
    installNetworkStub({
      robots: () => new Response("not found", { status: 404 }),
      target: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        }),
    });
    const { env } = makeEnv();

    const promise = run(env);
    await vi.advanceTimersByTimeAsync(SCRAPE_TIMEOUT_MS + 1);
    const res = await promise;

    expect(res.status).toBe(504);
    await expect(bodyOf(res)).resolves.toMatchObject({ code: 504 });
  });

  it("每管理员每分钟 10 次限流，超限返回 429 且不再抓取", async () => {
    const calls = installNetworkStub({});
    const { env } = makeEnv({
      key: rateKey(),
      count: SCRAPE_RATE_MAX,
    });

    const res = await run(env);

    expect(res.status).toBe(429);
    expect(calls.robotsCalls).toEqual([]);
    expect(calls.targetCalls).toEqual([]);
  });

  it("限流按管理员而非 IP 计数", async () => {
    const calls = installNetworkStub({});
    const { env, store } = makeEnv({
      key: rateKey("another-admin"),
      count: SCRAPE_RATE_MAX,
    });

    // 另一个管理员已用满额度，不影响 admin
    const first = await run(env, PUBLIC_TARGET);
    expect(first.status).toBe(200);
    expect(calls.targetCalls).toEqual([PUBLIC_TARGET]);

    // admin 的计数键被写入，且不含客户端 IP
    const adminKey = [...store.keys()].find((k) =>
      k.startsWith("scrape:admin:")
    );
    expect(adminKey).toBeDefined();
    expect(adminKey).not.toContain("203.0.113.9");
  });
});
