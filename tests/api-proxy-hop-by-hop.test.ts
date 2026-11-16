// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildProxyResponseHeaders } from "../src/utils/api-proxy";

/**
 * issue #110：同源代理剥离 RFC 7230 §6.1 定义的 hop-by-hop 头。
 *
 * 接缝：buildProxyResponseHeaders（纯函数）—— 上游 Headers → 浏览器 Headers 的唯一出口。
 * 缺陷来自 #98 的 D1 用例（`it.fails` 留痕），本票修复后该用例改回 `it`。
 */

/** RFC 7230 §6.1 的 8 类标准 hop-by-hop 头 */
const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
] as const;

describe("代理 hop-by-hop 头剥离（#110）", () => {
  it("8 类标准 hop-by-hop 头全部不穿透", () => {
    const upstream = new Headers({
      "content-type": "application/json",
      connection: "keep-alive",
      "keep-alive": "timeout=5",
      "proxy-authenticate": 'Basic realm="x"',
      "proxy-authorization": "Basic Zm9vOmJhcg==",
      te: "trailers",
      trailer: "Expires",
      "transfer-encoding": "chunked",
      upgrade: "h2c",
    });

    const out = buildProxyResponseHeaders(upstream, false, null);

    for (const name of HOP_BY_HOP) {
      expect(out.get(name), `${name} 应被剥离`).toBeNull();
    }
    // 端到端头保留
    expect(out.get("content-type")).toBe("application/json");
  });

  it("Connection 头自身列举的自定义头一并剥离（大小写 / 空白 / 多次列举）", () => {
    const upstream = new Headers({
      "content-type": "text/plain",
      connection: "  Keep-Alive , X-Internal-Token ,X-Trace  ",
      "x-internal-token": "should-not-leak",
      "x-trace": "abc",
      "x-keep": "kept",
    });

    const out = buildProxyResponseHeaders(upstream, false, null);

    expect(out.get("connection")).toBeNull();
    expect(out.get("x-internal-token")).toBeNull();
    expect(out.get("x-trace")).toBeNull();
    // 未被 Connection 点名的端到端头不受影响
    expect(out.get("x-keep")).toBe("kept");
  });

  it("Connection: close 之类无自定义头的取值只删自身，不误删其它头", () => {
    const upstream = new Headers({
      connection: "close",
      "content-type": "application/json",
      "x-keep": "kept",
    });

    const out = buildProxyResponseHeaders(upstream, false, null);

    expect(out.get("connection")).toBeNull();
    expect(out.get("x-keep")).toBe("kept");
    expect(out.get("content-type")).toBe("application/json");
  });

  it("Connection 列举的名字不存在时不报错，且不产生空头", () => {
    const upstream = new Headers({
      connection: "x-not-present, x-also-missing",
      "content-type": "application/json",
    });

    const out = buildProxyResponseHeaders(upstream, false, null);

    expect(out.get("connection")).toBeNull();
    expect(out.get("x-not-present")).toBeNull();
    expect(out.get("content-type")).toBe("application/json");
  });

  it("dev 分支仍剥离 content-encoding / content-length（#28 口径不退化）", () => {
    const upstream = new Headers({
      "content-encoding": "gzip",
      "content-length": "123",
      "content-type": "application/json",
    });

    const dev = buildProxyResponseHeaders(upstream, true, null);
    expect(dev.get("content-encoding")).toBeNull();
    expect(dev.get("content-length")).toBeNull();

    // 生产（workerd）保持压缩态，两个头必须原样透传
    const prod = buildProxyResponseHeaders(upstream, false, null);
    expect(prod.get("content-encoding")).toBe("gzip");
    expect(prod.get("content-length")).toBe("123");
  });

  it("CORS 重建与 hop-by-hop 剥离共存：上游 ACAO * 不残留", () => {
    const upstream = new Headers({
      "access-control-allow-origin": "*",
      connection: "keep-alive, x-internal-token",
      "x-internal-token": "should-not-leak",
    });

    const out = buildProxyResponseHeaders(
      upstream,
      false,
      "https://allowed.example.test"
    );

    expect(out.get("access-control-allow-origin")).not.toBe("*");
    expect(out.get("connection")).toBeNull();
    expect(out.get("x-internal-token")).toBeNull();
  });
});
