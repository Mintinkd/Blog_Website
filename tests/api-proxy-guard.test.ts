// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildProxyResponseHeaders } from "../src/utils/api-proxy";
import { ALL } from "../src/pages/api/v1/[...path]";

/**
 * issue #98 / M18：开放代理 /api/v1/[...path] 的安全守卫测试。
 *
 * 接缝：buildProxyResponseHeaders（响应头构造，纯函数）。请求路径逃逸、上游超时
 * 属于 ALL handler 的行为，其 URL 构造与超时映射在源码中逐字锁定（静态断言），
 * 因为 WORKER_ORIGIN 是常量、handler 依赖 Astro APIContext，直接单测需重型桩。
 * Out of scope：测试暴露的实现缺陷另票修（本票只补测，不改实现）。
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("代理响应头：hop-by-hop 头不泄漏（issue #98）", () => {
  const HOP_BY_HOP = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ];

  it("上游 hop-by-hop 头被剥离（RFC 7230：这些头逐跳有效，不得转发）", () => {
    const upstream = new Headers({ "content-type": "application/json" });
    for (const h of HOP_BY_HOP) upstream.set(h, "dangerous");
    const out = buildProxyResponseHeaders(upstream, false, null);
    for (const h of HOP_BY_HOP) {
      expect(out.get(h), `${h} 不应透传给浏览器`).toBeNull();
    }
    expect(out.get("content-type")).toBe("application/json");
  });

  it("Connection 头列举的自定义 hop-by-hop 头也一并剥离", () => {
    const upstream = new Headers({
      "content-type": "application/json",
      connection: "keep-alive, X-Internal-Token",
      "x-internal-token": "should-not-leak",
    });
    const out = buildProxyResponseHeaders(upstream, false, null);
    expect(out.get("x-internal-token")).toBeNull();
    expect(out.get("content-type")).toBe("application/json");
  });

  it("CORS 头始终由白名单重建，不残留上游 *（既有 #85 契约）", () => {
    const upstream = new Headers({
      "access-control-allow-origin": "*",
      vary: "Origin",
    });
    const out = buildProxyResponseHeaders(upstream, false, null);
    expect(out.get("access-control-allow-origin")).toBeNull();
  });
});

describe("代理请求路径拼接不逃逸 /api/v1 前缀（issue #98）", () => {
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

  it("URL/Request 入口即规范化点段（%2e%2e / ../ 不会以原样进入 handler）", () => {
    // WHATWG URL 在解析阶段就折叠点段：这是代理路径逃逸的第一道防线（平台层）。
    expect(
      new URL("https://site.example/api/v1/%2e%2e/admin/import").pathname
    ).toBe("/api/admin/import");
    expect(
      new URL("https://site.example/api/v1/../../admin/import").pathname
    ).toBe("/admin/import");
    // 规范化后两者都不再命中 /api/v1/[...path] 路由，故 handler 不会被越权调用。
  });

  it("handler 对异常 pathname 仍做前缀校验（纵深防御，返回 400 不转发）", async () => {
    // 直接构造一个绕过 Astro 路由层、pathname 非 /api/v1 的 URL 调 handler，
    // 验证其自带校验：拼接后规范化若逃出前缀即拒绝。
    const request = new Request("https://site.example/api/v1/articles");
    const url = new URL("https://site.example/api/v1/articles");
    Object.defineProperty(url, "pathname", {
      value: "/api/v1/../../admin/import",
    });
    const fetchMock = vi.fn(
      async (_url?: string | URL | Request, _init?: RequestInit) =>
        new Response("ok", { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await ALL({ request, url });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("代理超时与兜底（issue #98，静态守卫）", () => {
  it("handler 含 10s AbortController 超时与 502 兜底", async () => {
    const src = (await import("node:fs")).readFileSync(
      new URL("../src/pages/api/v1/[...path].ts", import.meta.url),
      "utf8"
    );
    expect(src).toMatch(/PROXY_TIMEOUT_MS\s*=\s*10_000/);
    expect(src).toMatch(
      /setTimeout\(\(\) => controller\.abort\(\), PROXY_TIMEOUT_MS\)/
    );
    expect(src).toMatch(/status:\s*502/);
    expect(src).toMatch(/clearTimeout\(timer\)/);
  });
});
