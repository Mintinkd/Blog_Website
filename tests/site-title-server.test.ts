// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSiteTitle } from "../src/utils/siteTitleServer";

/**
 * #39：文章页 SSR 站点标题接缝。
 *
 * 标题来自 Worker 公共 `/api/v1/config`；失败 / 超时 / 脏数据一律返回
 * undefined，由 meta 构造回退默认站名，不让配置故障阻断文章页。
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("文章页站点标题", () => {
  it("读取公共 config 的 site_title", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          code: 0,
          message: "ok",
          data: { site_title: " My Blog " },
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadSiteTitle("https://api.example.test")).resolves.toBe(
      "My Blog"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/v1/config",
      { signal: expect.any(AbortSignal) }
    );
  });

  it("上游失败或业务码非 0 时回退 undefined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(jsonResponse({ code: 10008, data: null }, 500))
      )
    );

    await expect(loadSiteTitle("https://api.example.test")).resolves.toBe(
      undefined
    );
  });

  it("site_title 缺失或为空白时回退 undefined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(jsonResponse({ code: 0, data: { site_title: "   " } }))
      )
    );

    await expect(loadSiteTitle("https://api.example.test")).resolves.toBe(
      undefined
    );
  });

  it("网络失败时回退 undefined", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline")))
    );

    await expect(loadSiteTitle("https://api.example.test")).resolves.toBe(
      undefined
    );
  });
});
