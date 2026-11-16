import { describe, expect, it } from "vitest";
import { withSecurityHeaders } from "../src/middleware/security_headers";

/**
 * issue #93 / M7：安全头中间件不得覆盖 handler 自设的专用 CSP。
 * img-proxy 的 SVG 沙箱 CSP 经 router 统一出口时必须保留，否则纵深防御失效。
 */

describe("withSecurityHeaders 保留专用 CSP（issue #93）", () => {
  it("响应已有 CSP 时保留，其余 4 头仍注入", () => {
    const res = new Response("x", {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
    const out = withSecurityHeaders(res);
    expect(out.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; sandbox"
    );
    expect(out.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(out.headers.get("X-Frame-Options")).toBe("DENY");
    expect(out.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin"
    );
  });

  it("响应无 CSP 时仍注入 API 默认 CSP（既有行为不变）", () => {
    const out = withSecurityHeaders(new Response("{}"));
    expect(out.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    );
  });
});
