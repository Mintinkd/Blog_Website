import { describe, expect, it, vi } from "vitest";
import { handleImgProxy, svgSafeHeaders } from "../src/handlers/img_proxy";
import type { Env } from "../src/index";

const SVG_BODY = new TextEncoder().encode('<svg onload="alert(1)">x</svg>');
const PNG_BODY = new TextEncoder().encode("fake-png");

/** 缓存命中桩：MEDIA.getWithMetadata 返回指定 ct + body；RATE_LIMIT 放行。 */
function cacheHitEnv(ct: string, body: Uint8Array): Env {
  return {
    RATE_LIMIT: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    },
    MEDIA: {
      getWithMetadata: vi.fn(async () => ({ value: body, metadata: { ct } })),
    },
  } as unknown as Env;
}

function ctx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function imgRequest(): Request {
  return new Request(
    "https://api.example.com/api/v1/img-proxy?url=" +
      encodeURIComponent("https://cdn.imagesite.io/a.svg"),
    { headers: { "CF-Connecting-IP": "203.0.113.5" } }
  );
}

/**
 * issue #93 / M7：图片代理 SVG 纵深防御。
 *
 * 接缝：svgSafeHeaders(contentType) 纯函数 —— handler 的缓存命中 / miss 两条
 * 返回路径共用它合并响应头，避免其中一条漏加（票面点名的错误出口）。
 *
 * 期望值全部手写字面量，不从被测实现反推。
 */

describe("SVG 响应纵深防御头（issue #93 / M7）", () => {
  it("image/svg+xml 返回 attachment + 沙箱 CSP + nosniff", () => {
    const headers = svgSafeHeaders("image/svg+xml");
    expect(headers).toEqual({
      "Content-Disposition": "attachment",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("带 charset 参数的 SVG Content-Type 也能识别（handler 已 split(';')，这里复验）", () => {
    expect(svgSafeHeaders("image/svg+xml; charset=utf-8")).toEqual({
      "Content-Disposition": "attachment",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    });
  });

  it("大小写不敏感", () => {
    expect(svgSafeHeaders("IMAGE/SVG+XML")).toHaveProperty(
      "Content-Disposition",
      "attachment"
    );
  });

  it("非 SVG 图片返回空对象，响应头完全不变", () => {
    for (const ct of [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/avif",
    ]) {
      expect(svgSafeHeaders(ct), ct).toEqual({});
    }
  });
});

describe("handleImgProxy 缓存命中路径的 SVG 安全头（issue #93）", () => {
  it("缓存命中 SVG：带 attachment + 沙箱 CSP + nosniff", async () => {
    const res = await handleImgProxy(
      imgRequest(),
      cacheHitEnv("image/svg+xml", SVG_BODY),
      ctx()
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Img-Proxy")).toBe("cache-hit");
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; sandbox"
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("缓存命中非 SVG：无 attachment / 无沙箱 CSP，响应头不变", async () => {
    const res = await handleImgProxy(
      imgRequest(),
      cacheHitEnv("image/png", PNG_BODY),
      ctx()
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toBeNull();
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("两条返回路径（cache-hit / cache-miss）都应用 SVG 安全头（静态守卫防漏）", async () => {
    const { readFileSync } = await import("node:fs");
    // workers-types 的 URL 与 node:fs 的 URL 类型不兼容，用 cwd 相对路径（vitest 在 worker/ 下运行）
    const src = readFileSync("src/handlers/img_proxy.ts", "utf8");
    // 两处 X-Img-Proxy 标记（cache-hit / cache-miss）所在响应对象均带 svgSafeHeaders 展开
    const hitBlock = src.slice(
      src.indexOf('"X-Img-Proxy": "cache-hit"'),
      src.indexOf('"X-Img-Proxy": "cache-hit"') + 200
    );
    const missBlock = src.slice(
      src.indexOf('"X-Img-Proxy": "cache-miss"'),
      src.indexOf('"X-Img-Proxy": "cache-miss"') + 200
    );
    expect(hitBlock).toContain("...svgSafeHeaders");
    expect(missBlock).toContain("...svgSafeHeaders");
  });
});
