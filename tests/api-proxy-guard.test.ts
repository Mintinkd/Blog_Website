// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProxyResponseHeaders } from "../src/utils/api-proxy";
import { ALL } from "../src/pages/api/v1/[...path]";

/**
 * issue #98 / M18：开放代理 /api/v1/[...path] 的安全守卫测试（纯补测票）。
 *
 * 接缝：buildProxyResponseHeaders（响应头构造，纯函数）+ ALL handler。
 * Out of scope：测试暴露的实现缺陷另票修——本票只补测、不改实现。
 * 已知缺陷用 `it.fails` 留痕：当前失败 = 整体通过；日后修复后测试会「意外通过」
 * 而变红，提示维护者移除 .fails 标记并关闭对应缺陷票。
 *
 * 缺陷票：D1（hop-by-hop）——已由 #110 修复，原 `it.fails` 留痕用例改回 `it`。
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("代理响应头（issue #98）", () => {
  it("CORS 头始终由白名单重建，不残留上游 *（新样本，不与 api-proxy-headers.test.ts 重复）", () => {
    const upstream = new Headers({
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "X-Evil",
      vary: "Origin",
    });
    const out = buildProxyResponseHeaders(
      upstream,
      false,
      "https://allowed.example.test"
    );
    expect(out.get("access-control-allow-origin")).not.toBe("*");
    expect(out.get("access-control-allow-headers")).not.toBe("X-Evil");
  });

  it("D1：上游 hop-by-hop 头应被剥离（RFC 7230 §6.1；已由 #110 修复）", () => {
    const upstream = new Headers({
      "content-type": "application/json",
      connection: "keep-alive, X-Internal-Token",
      "x-internal-token": "should-not-leak",
      "transfer-encoding": "chunked",
    });
    const out = buildProxyResponseHeaders(upstream, false, null);
    expect(out.get("connection")).toBeNull();
    expect(out.get("transfer-encoding")).toBeNull();
    expect(out.get("x-internal-token")).toBeNull();
  });
});

describe("代理路径与超时（issue #98）", () => {
  function call(pathname: string, search = "") {
    const fetchMock = vi.fn(
      async (_url?: string | URL | Request, _init?: RequestInit) =>
        new Response("ok", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request(`https://site.example${pathname}${search}`);
    const url = new URL(`https://site.example${pathname}${search}`);
    return { fetchMock, res: ALL({ request, url }) };
  }

  it("普通路径正常转发到 /api/v1 下", async () => {
    const { fetchMock, res } = call("/api/v1/articles");
    expect((await res).status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/articles");
  });

  it("路径逃逸：%2e%2e 经 URL 归一化后不命中 /api/v1 路由，handler 不转发逃逸路径（#111 item 4）", async () => {
    // #111 item 4：旧测试只断言 URL 归一化结果（源码文本级），
    // 不验证 handler 行为。改为用真实 request 打 handler，验证上游 fetch URL
    // 不含逃逸后的 /admin/import 直达路径。

    // ① WHATWG URL 在解析阶段折叠点段（平台层防线）
    const normalized = new URL(
      "https://site.example/api/v1/%2e%2e/admin/import"
    );
    expect(normalized.pathname).toBe("/api/admin/import");
    expect(normalized.pathname).not.toMatch(/^\/api\/v1\//);

    // ② 即便归一化后的 URL 被传给 handler（绕过平台路由），
    // handler 构造的上游 URL 也不会让逃逸路径直达 /admin/import——
    // 它只会被拼到 /api/v1/ 下，不会逃逸到 /api/v1 之外
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request(normalized.toString());
    await ALL({ request, url: normalized });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const upstreamUrl = String((fetchMock.mock.calls as unknown[][])[0][0]);
    // 上游 URL 必须以 /api/v1/ 开头（handler 始终在 /api/v1 下拼接）
    expect(upstreamUrl).toMatch(/\/api\/v1\//);
    // 逃逸后的 /admin/import 不得作为上游路径的直接段（不在 /api/v1 之外）
    expect(upstreamUrl).not.toMatch(/\.\./);
  });

  it("路径逃逸：../ 同样被 URL 归一化折叠，handler 不转发逃逸路径", async () => {
    const normalized = new URL(
      "https://site.example/api/v1/../../admin/import"
    );
    expect(normalized.pathname).toBe("/admin/import");
    expect(normalized.pathname).not.toMatch(/^\/api\/v1\//);

    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request(normalized.toString());
    await ALL({ request, url: normalized });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const upstreamUrl = String((fetchMock.mock.calls as unknown[][])[0][0]);
    expect(upstreamUrl).toMatch(/\/api\/v1\//);
    expect(upstreamUrl).not.toMatch(/\.\./);
  });

  it("上游 fetch 拒绝 → 502 JSON（真实行为，2026-11-17 审查替换源码文本断言）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    const request = new Request("https://site.example/api/v1/articles");
    const url = new URL("https://site.example/api/v1/articles");

    const res = await ALL({ request, url });

    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toBe(
      "application/json; charset=utf-8"
    );
    await expect(res.json()).resolves.toEqual({
      code: 502,
      message: "Worker unreachable",
    });
  });

  it("上游挂起 → 10s 预算到点 abort 并落 502", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url?: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = new Request("https://site.example/api/v1/articles");
    const url = new URL("https://site.example/api/v1/articles");

    const pending = ALL({ request, url });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);

    expect((await pending).status).toBe(502);
  });
});
