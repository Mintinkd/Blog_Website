// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildCorsHeaders,
  buildPreflightHeaders,
  buildProxyErrorHeaders,
  buildProxyResponseHeaders,
} from "../src/utils/api-proxy";
import { ALLOWED_ORIGINS } from "../src/generated/cors-origins";

/**
 * 同源 /api/v1 代理的响应头构造（#28 建立，#85 / H4 收严）。
 *
 * Astro dev 的代理跑在 Node：undici 会自动解压响应体，却仍保留上游的
 * `Content-Encoding: gzip`，浏览器二次解压直接 ERR_CONTENT_DECODING_FAILED。
 * 生产构建跑在 workerd：body 保持压缩态，头必须原样透传。
 * H4 追加：CORS 白名单精确回显（绝不再无条件 *）、预检补安全头。
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
    const headers = buildProxyResponseHeaders(upstreamHeaders(), true, null);
    expect(headers.get("content-encoding")).toBeNull();
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("cache-control")).toBe("no-store");
  });

  it("生产下保留上游编码与长度头（body 仍为压缩态）", () => {
    const headers = buildProxyResponseHeaders(upstreamHeaders(), false, null);
    expect(headers.get("content-encoding")).toBe("gzip");
    expect(headers.get("content-length")).toBe("123");
  });
});

describe("API 代理 CORS 白名单（issue #85 / H4）", () => {
  it("白名单 Origin 精确回显并带 Vary: Origin", () => {
    for (const origin of ALLOWED_ORIGINS) {
      const headers = buildProxyResponseHeaders(
        upstreamHeaders(),
        false,
        origin
      );
      expect(headers.get("access-control-allow-origin")).toBe(origin);
      expect(headers.get("vary")).toBe("Origin");
    }
  });

  it("非白名单 Origin 不写 ACAO（不再无条件 *）", () => {
    for (const origin of [
      "https://evil.example.test",
      "https://blog.zenfishlog.dpdns.org.evil.test",
    ]) {
      const headers = buildProxyResponseHeaders(
        upstreamHeaders(),
        false,
        origin
      );
      expect(headers.get("access-control-allow-origin")).toBeNull();
      expect(headers.get("vary")).toBe("Origin");
    }
  });

  it("无 Origin（同源请求）不写 ACAO", () => {
    expect(
      buildProxyResponseHeaders(upstreamHeaders(), false, null).get(
        "access-control-allow-origin"
      )
    ).toBeNull();
  });

  it("上游若带 ACAO: * 也不会残留（代理层先清后设）", () => {
    const upstream = upstreamHeaders();
    upstream.set("access-control-allow-origin", "*");
    const blocked = buildProxyResponseHeaders(
      upstream,
      false,
      "https://evil.test"
    );
    expect(blocked.get("access-control-allow-origin")).toBeNull();
    const allowed = buildProxyResponseHeaders(
      upstream,
      false,
      "https://blog.zenfishlog.dpdns.org"
    );
    expect(allowed.get("access-control-allow-origin")).toBe(
      "https://blog.zenfishlog.dpdns.org"
    );
  });

  it("CORS 方法与头收敛，不含 *", () => {
    const headers = buildCorsHeaders("http://localhost:4321");
    expect(headers.get("access-control-allow-methods")).not.toContain("*");
    expect(headers.get("access-control-allow-headers")).toContain(
      "Authorization"
    );
    expect(headers.get("access-control-max-age")).toBe("86400");
  });
});

describe("OPTIONS 预检安全头（issue #85 / H4）", () => {
  it("预检带 5 个安全头 + 白名单 CORS", () => {
    const headers = buildPreflightHeaders("https://blog.zenfishlog.dpdns.org");
    expect(headers.get("content-security-policy")).toContain(
      "default-src 'self'"
    );
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin"
    );
    expect(headers.get("permissions-policy")).toContain("camera=()");
    expect(headers.get("access-control-allow-origin")).toBe(
      "https://blog.zenfishlog.dpdns.org"
    );
  });

  it("预检非白名单 Origin 无 ACAO 但仍有安全头", () => {
    const headers = buildPreflightHeaders("https://evil.test");
    expect(headers.get("access-control-allow-origin")).toBeNull();
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("上游 Vary 合并（2026-11-17 审查）", () => {
  it("保留上游 Vary: Accept-Encoding，并补本地 Origin", () => {
    const upstream = upstreamHeaders();
    upstream.set("vary", "Accept-Encoding");
    const headers = buildProxyResponseHeaders(upstream, false, null);
    expect(headers.get("vary")).toBe("Accept-Encoding, Origin");
  });

  it("上游 Vary 已含 Origin 时不重复、不改变其余 token 顺序", () => {
    const upstream = upstreamHeaders();
    upstream.set("vary", "Origin, Accept-Encoding");
    const headers = buildProxyResponseHeaders(upstream, false, null);
    expect(headers.get("vary")).toBe("Accept-Encoding, Origin");
  });

  it("Vary: * 原样保留（RFC 7234 §4.1）", () => {
    const upstream = upstreamHeaders();
    upstream.set("vary", "*");
    const headers = buildProxyResponseHeaders(upstream, false, null);
    expect(headers.get("vary")).toBe("*");
  });

  it("无上游 Vary 时仍写 Origin", () => {
    expect(
      buildProxyResponseHeaders(upstreamHeaders(), false, null).get("vary")
    ).toBe("Origin");
  });
});

describe("代理 502 错误响应头（2026-11-17 审查）", () => {
  it("application/json + 白名单 CORS + 安全头，不套预检专属字段之外的语义", () => {
    const headers = buildProxyErrorHeaders("https://blog.zenfishlog.dpdns.org");
    expect(headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(headers.get("access-control-allow-origin")).toBe(
      "https://blog.zenfishlog.dpdns.org"
    );
    expect(headers.get("vary")).toBe("Origin");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("非白名单 Origin 不写 ACAO，但仍带 JSON 类型", () => {
    const headers = buildProxyErrorHeaders("https://evil.test");
    expect(headers.get("access-control-allow-origin")).toBeNull();
    expect(headers.get("content-type")).toBe("application/json; charset=utf-8");
  });
});

describe("双端 CORS 白名单漂移守卫（issue #85 / H4）", () => {
  it("根包与 Worker 生成物字节一致，且与单一描述符同步", () => {
    const root = readFileSync(
      new URL("../src/generated/cors-origins.ts", import.meta.url),
      "utf8"
    );
    const worker = readFileSync(
      new URL("../worker/src/generated/cors-origins.ts", import.meta.url),
      "utf8"
    );
    expect(root).toBe(worker);
    const descriptor = JSON.parse(
      readFileSync(new URL("../cors.origins.json", import.meta.url), "utf8")
    );
    expect([...ALLOWED_ORIGINS]).toEqual(descriptor.origins);
  });
});
