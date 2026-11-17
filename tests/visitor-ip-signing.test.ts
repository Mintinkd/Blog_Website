// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IP_SIGNING_HEADER,
  signVisitorIp,
  visitorIpSigningSecret,
} from "../src/utils/visitorIpSigning";

/**
 * issue #84（H3）：Pages 签名侧的算法与 secret 来源。
 *
 * 两件事各自钉住：
 * 1. 算法：期望值是从契约文字（`HMAC-SHA256("client-ip:v1:" + ip, secret)` → hex）
 *    用 `node:crypto` 独立算出的**手写十六进制**，不是拿 Worker 实现反推；
 * 2. secret 来源：线上必须读 Cloudflare 运行时 env。只读 `import.meta.env` 会
 *    在构建期内联成 undefined → 不写签名 → Worker 退回 Pages 出口 IP，
 *    #84 修的现象原样复现（本仓 2026-11-17 审查发现的真问题）。
 */
describe("访客 IP 签名算法（issue #84）", () => {
  const SECRET = "issue84-cross-boundary-secret";

  it("契约样例逐字节匹配手写十六进制", async () => {
    expect(await signVisitorIp("203.0.113.9", SECRET)).toBe(
      "5a8b892fc6ca67d2018354c1dfab39b694d46423fde48969da20bd93816e30ef"
    );
    expect(await signVisitorIp("2001:db8::1", SECRET)).toBe(
      "bb2d63de513af5d5fbe2bd0fd036e4e2960999732ed05cc9face4878eb837c22"
    );
    // 两端空白先 trim 再签名
    expect(await signVisitorIp("  203.0.113.9  ", SECRET)).toBe(
      "5a8b892fc6ca67d2018354c1dfab39b694d46423fde48969da20bd93816e30ef"
    );
  });

  it("不同 secret 产出不同签名；空 IP / 无 secret 不产出签名", async () => {
    const a = await signVisitorIp("203.0.113.9", SECRET);
    const b = await signVisitorIp("203.0.113.9", "other-secret");
    expect(a).not.toBe(b);
    expect(await signVisitorIp("", SECRET)).toBeNull();
    expect(await signVisitorIp("203.0.113.9", undefined)).toBeNull();
  });

  it("签名头名常量为小写 x-real-ip-sig（Worker 侧按小写读）", () => {
    expect(IP_SIGNING_HEADER).toBe("x-real-ip-sig");
  });
});

describe("签名 secret 的来源顺序（issue #84 修正）", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("运行时 env 优先于构建期内联值", () => {
    vi.stubEnv("VISITOR_IP_SIGNING_SECRET", "build-time-secret");
    expect(
      visitorIpSigningSecret({ VISITOR_IP_SIGNING_SECRET: "runtime-secret" })
    ).toBe("runtime-secret");
  });

  it("运行时 env 缺失时退回构建期内联值（本地 dev / 显式构建设置）", () => {
    vi.stubEnv("VISITOR_IP_SIGNING_SECRET", "build-time-secret");
    expect(visitorIpSigningSecret()).toBe("build-time-secret");
    expect(visitorIpSigningSecret({})).toBe("build-time-secret");
    expect(visitorIpSigningSecret(undefined)).toBe("build-time-secret");
  });

  it("两处都没有 / 非字符串 / 空白 → undefined（调用方不写签名头）", () => {
    vi.stubEnv("VISITOR_IP_SIGNING_SECRET", "");
    expect(visitorIpSigningSecret()).toBeUndefined();
    expect(visitorIpSigningSecret({ OTHER: "x" })).toBeUndefined();
    expect(
      visitorIpSigningSecret({ VISITOR_IP_SIGNING_SECRET: 123 })
    ).toBeUndefined();
    expect(
      visitorIpSigningSecret({ VISITOR_IP_SIGNING_SECRET: "   " })
    ).toBeUndefined();
    expect(visitorIpSigningSecret("not-an-object")).toBeUndefined();
  });
});
