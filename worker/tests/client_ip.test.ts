import { describe, expect, it } from "vitest";
import {
  IP_SIGNING_HEADER,
  resolveClientIp,
  signClientIp,
} from "../src/utils/client_ip";

/**
 * issue #84（H3）：客户端 IP 单点解析 + 可信跳签名验签。
 *
 * 接缝：resolveClientIp(request, secret) 与 signClientIp(ip, secret)。
 * 期望来自票面与 ADR 0005：签名 X-Real-IP 优先（可信 Pages 跳）→
 * CF-Connecting-IP（边缘不可伪造）→ XFF[0] → unknown；伪造签名不采信。
 */
const SECRET = "issue84-shared-signing-secret";
const VISITOR_IP = "203.0.113.9";
const EDGE_IP = "198.51.100.1"; // Pages 出口 / 边缘出口地址

function req(headers: Record<string, string>): Request {
  return new Request("https://api.example.test/api/v1/articles/1/like", {
    method: "POST",
    headers,
  });
}

describe("resolveClientIp 优先级（issue #84）", () => {
  it("签名通过的 X-Real-IP 胜出（经可信 Pages 代理）", async () => {
    const sig = await signClientIp(VISITOR_IP, SECRET);
    const result = await resolveClientIp(
      req({
        "X-Real-IP": VISITOR_IP,
        [IP_SIGNING_HEADER]: sig!,
        "CF-Connecting-IP": EDGE_IP, // 出口 IP，必须被 X-Real-IP 覆盖
      }),
      SECRET
    );
    expect(result).toEqual({ ip: VISITOR_IP, source: "signed-proxy" });
  });

  it("直连：无 X-Real-IP → 采信边缘 CF-Connecting-IP", async () => {
    const result = await resolveClientIp(
      req({ "CF-Connecting-IP": VISITOR_IP }),
      SECRET
    );
    expect(result).toEqual({ ip: VISITOR_IP, source: "edge" });
  });

  it("仅有 XFF → 取首跳", async () => {
    const result = await resolveClientIp(
      req({ "X-Forwarded-For": "203.0.113.42, 10.0.0.1" }),
      SECRET
    );
    expect(result).toEqual({ ip: "203.0.113.42", source: "xff" });
  });

  it("全无 → unknown", async () => {
    expect(await resolveClientIp(req({}), SECRET)).toEqual({
      ip: "unknown",
      source: "unknown",
    });
  });
});

describe("伪造防护（issue #84）", () => {
  it("伪造 X-Real-IP 但签名无效 → 回退 CF-Connecting-IP（不可绕过）", async () => {
    const result = await resolveClientIp(
      req({
        "X-Real-IP": "203.0.113.666", // 伪造值
        [IP_SIGNING_HEADER]: "deadbeef", // 不知 secret，伪造签名
        "CF-Connecting-IP": VISITOR_IP, // 边缘可信的真实来源
      }),
      SECRET
    );
    expect(result).toEqual({ ip: VISITOR_IP, source: "edge" });
  });

  it("签名针对 A IP，却用于 B IP → 验签失败回退（签名绑定 IP）", async () => {
    const sigForA = await signClientIp("203.0.113.9", SECRET);
    const result = await resolveClientIp(
      req({
        "X-Real-IP": "203.0.113.10", // 换 IP
        [IP_SIGNING_HEADER]: sigForA!, // 沿用 A 的签名
        "CF-Connecting-IP": EDGE_IP,
      }),
      SECRET
    );
    expect(result.source).toBe("edge");
    expect(result.ip).toBe(EDGE_IP);
  });

  it("secret 未配置 → fail-closed 不采信任何 X-Real-IP（即使带签名）", async () => {
    const sig = await signClientIp(VISITOR_IP, SECRET);
    const result = await resolveClientIp(
      req({
        "X-Real-IP": VISITOR_IP,
        [IP_SIGNING_HEADER]: sig!,
        "CF-Connecting-IP": EDGE_IP,
      }),
      undefined
    );
    expect(result).toEqual({ ip: EDGE_IP, source: "edge" });
  });

  it("无 secret 且无 CF-Connecting-IP → 不采信 X-Real-IP，落到 XFF/unknown", async () => {
    const result = await resolveClientIp(
      req({ "X-Real-IP": VISITOR_IP, "X-Forwarded-For": "203.0.113.7" }),
      null
    );
    expect(result).toEqual({ ip: "203.0.113.7", source: "xff" });
  });

  it("trim 后验签一致；不同 secret 的签名互不通用", async () => {
    const sig = await signClientIp(`  ${VISITOR_IP}  `, SECRET);
    const ok = await resolveClientIp(
      req({ "X-Real-IP": VISITOR_IP, [IP_SIGNING_HEADER]: sig! }),
      SECRET
    );
    expect(ok.source).toBe("signed-proxy");

    const otherSecretSig = await signClientIp(VISITOR_IP, "another-secret");
    const fail = await resolveClientIp(
      req({ "X-Real-IP": VISITOR_IP, [IP_SIGNING_HEADER]: otherSecretSig! }),
      SECRET
    );
    expect(fail.source).toBe("unknown");
  });

  it("空 IP 不签名", async () => {
    expect(await signClientIp("   ", SECRET)).toBeNull();
  });
});
