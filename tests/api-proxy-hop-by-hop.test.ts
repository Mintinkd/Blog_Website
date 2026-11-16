// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildProxyResponseHeaders } from "../src/utils/api-proxy";
import { ALLOWED_ORIGINS } from "../src/generated/cors-origins";

/** 白名单内的 Origin（用生成物真值，避免自造值让断言退化成 `null !== "*"`） */
const ALLOWED_ORIGIN = ALLOWED_ORIGINS[0];

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

    const out = buildProxyResponseHeaders(upstream, false, ALLOWED_ORIGIN);

    // 白名单 Origin → 精确回显（证明「重建」真的发生了，不只是没留下 `*`）
    expect(out.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(out.get("vary")).toBe("Origin");
    expect(out.get("connection")).toBeNull();
    expect(out.get("x-internal-token")).toBeNull();
  });

  it("Connection 点名 CORS 头时，重建结果仍生效（锁定剥离先于重建的次序）", () => {
    // 若实现把「剥 hop-by-hop」放在「按 Origin 重建 CORS」之后，
    // 上游就能用 `Connection: access-control-allow-origin` 把重建结果一同删掉。
    const upstream = new Headers({
      "access-control-allow-origin": "*",
      connection: "access-control-allow-origin, x-internal-token",
      "x-internal-token": "should-not-leak",
    });

    const out = buildProxyResponseHeaders(upstream, false, ALLOWED_ORIGIN);

    expect(out.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(out.get("x-internal-token")).toBeNull();
  });

  it("无请求 Origin 且上游点名 CORS 头：不重建也不残留", () => {
    const upstream = new Headers({
      "access-control-allow-origin": "https://evil.example.test",
      connection: "access-control-allow-origin",
    });

    const out = buildProxyResponseHeaders(upstream, false, null);

    expect(out.get("access-control-allow-origin")).toBeNull();
    expect(out.get("connection")).toBeNull();
  });
});
