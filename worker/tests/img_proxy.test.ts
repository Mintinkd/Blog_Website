import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchWithValidatedRedirects,
  RESOLUTION_TTL_MS,
} from "../src/handlers/img_proxy";

/**
 * issue #19：解析后 IP 复核的测试。
 *
 * 接缝：fetchWithValidatedRedirects —— img/text/scrape 三条通道共用的唯一拉取入口。
 * 网络边界（global fetch）以桩替换：DoH 查询与目标拉取按 URL 分流，
 * 目标拉取调用被记录下来，用于断言「拒绝时不发起真实请求」。
 */

const DOH_PREFIX = "https://cloudflare-dns.com/dns-query";

type DohRecord = { type: "A" | "AAAA"; data: string };

function netAnswer(records: DohRecord[], status = 0): Response {
  return new Response(
    JSON.stringify({
      Status: status,
      Answer: records.map((r) => ({
        name: "target.example.org",
        type: r.type === "A" ? 1 : 28,
        data: r.data,
        TTL: 300,
      })),
    }),
    { status: 200, headers: { "Content-Type": "application/dns-json" } }
  );
}

/**
 * 安装网络桩；返回目标拉取与 DoH 查询各自被调用的 URL 列表。
 * dohByType 按查询类型（A / AAAA）决定 DoH 响应；缺失则该查询直接拒绝。
 */
function installNetworkStub(
  dohByType: Record<
    string,
    (url: URL, init?: RequestInit) => Response | Promise<Response>
  >,
  target?: (url: URL) => Response | Promise<Response>
) {
  const targetCalls: string[] = [];
  const dohCalls: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (href.startsWith(DOH_PREFIX)) {
      dohCalls.push(href);
      const type = new URL(href).searchParams.get("type") || "";
      const answer = dohByType[type];
      if (!answer)
        return Promise.reject(new Error(`unexpected DoH query type: ${type}`));
      return Promise.resolve().then(() => answer(new URL(href), init));
    }
    targetCalls.push(href);
    return Promise.resolve().then(() =>
      target
        ? target(new URL(href))
        : new Response("upstream-ok", { status: 200 })
    );
  });
  return { targetCalls, dohCalls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("fetchWithValidatedRedirects 解析后 IP 复核", () => {
  it("域名解析到回环地址时拒绝，且不发起目标请求", async () => {
    const { targetCalls } = installNetworkStub({
      A: () => netAnswer([{ type: "A", data: "127.0.0.1" }]),
      AAAA: () => netAnswer([]),
    });

    const result = await fetchWithValidatedRedirects(
      new URL("https://rebind.attacker.com/img.png"),
      {}
    );

    expect(result.kind).toBe("blocked");
    expect(targetCalls).toEqual([]);
  });

  it("域名解析失败（NXDOMAIN）时明确拒绝，且不发起目标请求", async () => {
    const { targetCalls } = installNetworkStub({
      A: () => netAnswer([], 3),
      AAAA: () => netAnswer([], 3),
    });

    const result = await fetchWithValidatedRedirects(
      new URL("https://dead.example.org/img.png"),
      {}
    );

    expect(result.kind).toBe("resolution_failed");
    expect(targetCalls).toEqual([]);
  });

  it("域名解析到公网地址时正常放行并发起目标请求", async () => {
    const { targetCalls } = installNetworkStub({
      A: () => netAnswer([{ type: "A", data: "93.184.216.34" }]),
      AAAA: () => netAnswer([]),
    });

    const result = await fetchWithValidatedRedirects(
      new URL("https://cdn.publicsite.net/img.png"),
      {}
    );

    expect(result.kind).toBe("ok");
    expect(targetCalls).toEqual(["https://cdn.publicsite.net/img.png"]);
  });

  it.each([
    ["127.0.0.1", "A"],
    ["10.1.2.3", "A"],
    ["172.16.5.5", "A"],
    ["192.168.0.1", "A"],
    ["169.254.10.20", "A"],
    ["100.64.0.1", "A"],
    ["0.0.0.0", "A"],
    ["::1", "AAAA"],
    ["fc00::1", "AAAA"],
    ["fe80::1", "AAAA"],
  ] as const)(
    "域名解析到受限地址 %s 时拒绝，且不发起目标请求",
    async (ip, type) => {
      const { targetCalls } = installNetworkStub({
        A: () => netAnswer(type === "A" ? [{ type: "A", data: ip }] : []),
        AAAA: () =>
          netAnswer(type === "AAAA" ? [{ type: "AAAA", data: ip }] : []),
      });

      const result = await fetchWithValidatedRedirects(
        new URL("https://mixed.attacker.com/img.png"),
        {}
      );

      expect(result.kind).toBe("blocked");
      expect(targetCalls).toEqual([]);
    }
  );

  it("多条解析结果中任一条受限即拒绝（A 公网 + AAAA 内网）", async () => {
    const { targetCalls } = installNetworkStub({
      A: () => netAnswer([{ type: "A", data: "93.184.216.34" }]),
      AAAA: () => netAnswer([{ type: "AAAA", data: "fd12:3456::1" }]),
    });

    const result = await fetchWithValidatedRedirects(
      new URL("https://dualstack.attacker.com/img.png"),
      {}
    );

    expect(result.kind).toBe("blocked");
    expect(targetCalls).toEqual([]);
  });

  it("重定向跳的目标解析到内网时拒绝，且不拉取该跳", async () => {
    const { targetCalls } = installNetworkStub(
      {
        A: (q) =>
          q.searchParams.get("name") === "hop2.attacker.com"
            ? netAnswer([{ type: "A", data: "192.168.1.10" }])
            : netAnswer([{ type: "A", data: "93.184.216.34" }]),
        AAAA: () => netAnswer([]),
      },
      (u) =>
        u.hostname === "first.publicsite.net"
          ? new Response(null, {
              status: 302,
              headers: { Location: "https://hop2.attacker.com/x" },
            })
          : new Response("upstream-ok", { status: 200 })
    );

    const result = await fetchWithValidatedRedirects(
      new URL("https://first.publicsite.net/img.png"),
      {}
    );

    expect(result.kind).toBe("blocked");
    expect(targetCalls).toEqual(["https://first.publicsite.net/img.png"]);
  });

  it("受限 IP 字面量保持拦截，且无需 DoH 查询", async () => {
    const { targetCalls, dohCalls } = installNetworkStub({});

    const result = await fetchWithValidatedRedirects(
      new URL("https://[::ffff:127.0.0.1]/img.png"),
      {}
    );

    expect(result.kind).toBe("blocked");
    expect(dohCalls).toEqual([]);
    expect(targetCalls).toEqual([]);
  });

  it("公网 IP 字面量无需 DoH 查询即可放行", async () => {
    const { targetCalls, dohCalls } = installNetworkStub({});

    const result = await fetchWithValidatedRedirects(
      new URL("https://93.184.216.34/img.png"),
      {}
    );

    expect(result.kind).toBe("ok");
    expect(dohCalls).toEqual([]);
    expect(targetCalls).toEqual(["https://93.184.216.34/img.png"]);
  });

  it("DoH 查询超时或网络异常时明确拒绝（fail-closed）", async () => {
    const { targetCalls } = installNetworkStub({
      A: () => {
        throw new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError"
        );
      },
      AAAA: () => netAnswer([]),
    });

    const result = await fetchWithValidatedRedirects(
      new URL("https://flaky.publicsite.net/img.png"),
      {}
    );

    expect(result.kind).toBe("resolution_failed");
    expect(targetCalls).toEqual([]);
  });

  it("DoH 无 A/AAAA 记录时明确拒绝（fail-closed）", async () => {
    const { targetCalls } = installNetworkStub({
      A: () => netAnswer([]),
      AAAA: () => netAnswer([]),
    });

    const result = await fetchWithValidatedRedirects(
      new URL("https://nodata.publicsite.net/img.png"),
      {}
    );

    expect(result.kind).toBe("resolution_failed");
    expect(targetCalls).toEqual([]);
  });

  it("同主机重定向（如 http→https）不重复 DoH 查询", async () => {
    const { targetCalls, dohCalls } = installNetworkStub(
      {
        A: () => netAnswer([{ type: "A", data: "93.184.216.34" }]),
        AAAA: () => netAnswer([]),
      },
      (u) =>
        u.protocol === "http:"
          ? new Response(null, {
              status: 301,
              headers: { Location: "https://same.publicsite.net/img.png" },
            })
          : new Response("upstream-ok", { status: 200 })
    );

    const result = await fetchWithValidatedRedirects(
      new URL("http://same.publicsite.net/img.png"),
      {}
    );

    expect(result.kind).toBe("ok");
    expect(dohCalls.length).toBe(2); // A + AAAA 各一次，第二跳复用
    expect(targetCalls).toEqual([
      "http://same.publicsite.net/img.png",
      "https://same.publicsite.net/img.png",
    ]);
  });

  it(`同主机判定超过 ${RESOLUTION_TTL_MS}ms 后重新 DoH（缩窗，不跨 TTL 复用旧判定）`, async () => {
    vi.useFakeTimers();
    let revalidated = false;
    const { dohCalls } = installNetworkStub(
      {
        A: (q) => {
          if (
            q.searchParams.get("name") === "slow.publicsite.net" &&
            revalidated
          )
            return netAnswer([{ type: "A", data: "169.254.169.254" }]); // 第二跳被 rebind 到 metadata
          return netAnswer([{ type: "A", data: "93.184.216.34" }]);
        },
        AAAA: () => netAnswer([]),
      },
      (u) => {
        if (u.protocol === "http:") {
          // 模拟慢重定向：第一跳耗时超过 TTL，下一跳必须重新解析
          revalidated = true;
          vi.advanceTimersByTime(RESOLUTION_TTL_MS + 1);
          return new Response(null, {
            status: 301,
            headers: { Location: "https://slow.publicsite.net/img.png" },
          });
        }
        return new Response("upstream-ok", { status: 200 });
      }
    );

    const result = await fetchWithValidatedRedirects(
      new URL("http://slow.publicsite.net/img.png"),
      {}
    );

    expect(result.kind).toBe("blocked");
    expect(dohCalls.length).toBe(4); // 首跳 A/AAAA + 过期后 A/AAAA
  });
});

/** #88 / H10：blocked 判定必须留下可告警的结构化日志（不含原始 IP / 目标 query） */
describe("fetchWithValidatedRedirects blocked 结构化日志", () => {
  it("DoH 命中内网时输出 [ssrf-blocked] JSON，含 host/reason/blocked_ips/client_ip_hash", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installNetworkStub({
      A: () => netAnswer([{ type: "A", data: "169.254.169.254" }]),
      AAAA: () => netAnswer([]),
    });

    const result = await fetchWithValidatedRedirects(
      new URL("https://rebind.attacker.com/secret?token=abc"),
      {},
      { channel: "img", clientIp: "203.0.113.9" }
    );

    expect(result.kind).toBe("blocked");
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line.startsWith("[ssrf-blocked] ")).toBe(true);
    const payload = JSON.parse(line.slice("[ssrf-blocked] ".length));
    expect(payload).toMatchObject({
      event: "ssrf_blocked",
      channel: "img",
      host: "rebind.attacker.com",
      hop: 0,
      reason: "doh",
      blocked_ips: ["169.254.169.254"],
    });
    expect(payload.client_ip_hash).toMatch(/^[0-9a-f]{40}$/);
    expect(line).not.toContain("203.0.113.9");
    expect(line).not.toContain("token=abc");
  });

  it("重定向目标被同步校验拒绝时也记录 blocked 日志（reason=redirect_validation）", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installNetworkStub(
      {
        A: () => netAnswer([{ type: "A", data: "93.184.216.34" }]),
        AAAA: () => netAnswer([]),
      },
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/admin" },
        })
    );

    const result = await fetchWithValidatedRedirects(
      new URL("https://first.publicsite.net/img.png"),
      {},
      { channel: "img" }
    );

    expect(result.kind).toBe("blocked");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(
      '"reason":"redirect_validation"'
    );
  });
});
