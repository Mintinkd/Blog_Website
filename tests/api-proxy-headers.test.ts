// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildProxyResponseHeaders } from "../src/utils/api-proxy";

/**
 * 同源 /api/v1 代理的响应头构造。
 *
 * Astro dev 的代理跑在 Node：undici 会自动解压响应体，却仍保留上游的
 * `Content-Encoding: gzip`，浏览器二次解压直接 ERR_CONTENT_DECODING_FAILED。
 * 生产构建跑在 workerd：body 保持压缩态，头必须原样透传。
 * 两个分支都在这里钉住，避免“修好本地、弄坏线上”。
 */

function upstreamHeaders(): Headers {
  return new Headers({
    "content-type": "application/json",
    "content-encoding": "gzip",
    "content-length": "123",
    "cache-control": "no-store",
  });
}

describe("API 代理响应头", () => {
  it("dev 下剥离已解压响应体的编码与长度头", () => {
    const headers = buildProxyResponseHeaders(upstreamHeaders(), true);
    expect(headers.get("content-encoding")).toBeNull();
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("cache-control")).toBe("no-store");
  });

  it("生产下保留上游编码与长度头（body 仍为压缩态）", () => {
    const headers = buildProxyResponseHeaders(upstreamHeaders(), false);
    expect(headers.get("content-encoding")).toBe("gzip");
    expect(headers.get("content-length")).toBe("123");
  });

  it("两种环境都补同源 CORS 头", () => {
    for (const dev of [true, false]) {
      const headers = buildProxyResponseHeaders(upstreamHeaders(), dev);
      expect(headers.get("access-control-allow-origin")).toBe("*");
      expect(headers.get("access-control-allow-methods")).toContain("PUT");
      expect(headers.get("access-control-allow-headers")).toContain(
        "Authorization"
      );
    }
  });
});
