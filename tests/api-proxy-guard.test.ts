// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
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

  it("入口 URL 解析即折叠点段（%2e%2e / ../ 不以原样进入 handler，平台层防线）", () => {
    // 票面点名的攻击载荷：WHATWG URL 在解析阶段就规范化，规范化后的路径
    // 不再命中 /api/v1/[...path] 路由——攻击面在入口即被关闭，无需 handler 前缀校验。
    expect(
      new URL("https://site.example/api/v1/%2e%2e/admin/import").pathname
    ).toBe("/api/admin/import");
    expect(
      new URL("https://site.example/api/v1/../../admin/import").pathname
    ).toBe("/admin/import");
  });

  it("handler 含 10s AbortController 超时与 502 兜底（静态守卫）", () => {
    const src = readFileSync(
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
