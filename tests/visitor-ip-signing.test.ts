// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  IP_SIGNING_HEADER,
  signVisitorIp,
} from "../src/utils/visitorIpSigning";
import { signClientIp } from "../worker/src/utils/client_ip";

/**
 * issue #84（H3）：Pages 签名侧与 Worker 验签侧的 HMAC 算法必须逐字节一致，
 * 否则可信跳转发的 X-Real-IP 会被误判为伪造（fail-closed 导致去重回退出口 IP）。
 * 本测试是两侧共享契约的机械守卫。
 */
describe("访客 IP 签名跨端一致性（issue #84）", () => {
  const SECRET = "issue84-cross-boundary-secret";

  it("同一 IP + 同一 secret：前端签名 === Worker 验签期望值", async () => {
    for (const ip of ["203.0.113.9", "2001:db8::1", " 203.0.113.9 "]) {
      expect(await signVisitorIp(ip, SECRET)).toBe(
        await signClientIp(ip, SECRET)
      );
    }
  });

  it("不同 secret 产出不同签名；空值 / 无 secret 不产出签名", async () => {
    const a = await signVisitorIp("203.0.113.9", SECRET);
    const b = await signVisitorIp("203.0.113.9", "other-secret");
    expect(a).not.toBe(b);
    expect(await signVisitorIp("", SECRET)).toBeNull();
    expect(await signVisitorIp("203.0.113.9", undefined)).toBeNull();
  });

  it("签名头名常量与 Worker 侧一致", async () => {
    const worker = await import("../worker/src/utils/client_ip");
    expect(IP_SIGNING_HEADER).toBe(worker.IP_SIGNING_HEADER);
  });
});
