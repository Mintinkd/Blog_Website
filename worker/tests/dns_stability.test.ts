import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithValidatedRedirects } from "../src/handlers/img_proxy";

/**
 * issue #109 / H10-R：双解析器一致性校验（Workers 上可行的最强 rebinding 检测）。
 *
 * 背景与平台限制见 `docs/adr/0007-dns-rebinding-connection-binding.md`：
 * `fetch` 无法把连接绑定到已校验 IP（`cf.resolveOverride` 只对同 zone 主机生效且只收
 * 主机名；`cloudflare:sockets` 不允许 80/443 且无 SNI 覆盖）。因此改为要求
 * **两个独立解析器给出同一答案集合**：分裂解析 / 短 TTL 抖动都会在这里被拒。
 *
 * 接缝：fetchWithValidatedRedirects（img/text/scrape 三通道共用的唯一拉取入口）。
 */

const PRIMARY = "https://cloudflare-dns.com/dns-query";
const SECONDARY = "https://dns.google/resolve";

function dohAnswer(a: string[], aaaa: string[] = []): Response {
  return new Response(
    JSON.stringify({
      Status: 0,
      Answer: [
        ...a.map((data) => ({ type: 1, data, TTL: 60 })),
        ...aaaa.map((data) => ({ type: 28, data, TTL: 60 })),
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/dns-json" } }
  );
}

interface StubOptions {
  /** 主解析器答案（缺失则该查询失败） */
  primary?: (type: string) => Response | "throw";
  /** 第二解析器答案（"unavailable" 模拟 dns.google 不可用） */
  secondary?: ((type: string) => Response | "throw") | "unavailable";
}

function installStub(opts: StubOptions) {
  const targetCalls: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (href.startsWith(PRIMARY) || href.startsWith(SECONDARY)) {
      const type = new URL(href).searchParams.get("type") || "";
      if (href.startsWith(SECONDARY)) {
        if (opts.secondary === "unavailable")
          return Promise.reject(new Error("secondary resolver down"));
        const answer = opts.secondary?.(type);
        if (!answer) return Promise.reject(new Error("no secondary answer"));
        return answer === "throw"
          ? Promise.reject(new Error("secondary failed"))
          : Promise.resolve(answer);
      }
      const answer = opts.primary?.(type);
      if (!answer) return Promise.reject(new Error("no primary answer"));
      return answer === "throw"
        ? Promise.reject(new Error("primary failed"))
        : Promise.resolve(answer);
    }
    targetCalls.push(href);
    return Promise.resolve(new Response("upstream-ok", { status: 200 }));
  });
  return { targetCalls };
}

const url = new URL("https://target.example.org/img.png");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("双解析器一致性（#109）", () => {
  it("两个解析器答案一致 → 放行并拉取目标", async () => {
    const { targetCalls } = installStub({
      primary: (t) =>
        t === "A" ? dohAnswer(["93.184.216.34"]) : dohAnswer([]),
      secondary: (t) =>
        t === "A" ? dohAnswer(["93.184.216.34"]) : dohAnswer([]),
    });

    const result = await fetchWithValidatedRedirects(url, {});
    expect(result.kind).toBe("ok");
    expect(targetCalls).toHaveLength(1);
  });

  it("答案集合顺序不同但内容相同 → 仍放行（顺序无关比较）", async () => {
    const { targetCalls } = installStub({
      primary: () => dohAnswer(["93.184.216.34", "93.184.216.35"]),
      secondary: () => dohAnswer(["93.184.216.35", "93.184.216.34"]),
    });

    const result = await fetchWithValidatedRedirects(url, {});
    expect(result.kind).toBe("ok");
    expect(targetCalls).toHaveLength(1);
  });

  it("分裂解析（主解析器公网、备解析器内网）→ 拒绝且不拉取目标", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { targetCalls } = installStub({
      primary: (t) =>
        t === "A" ? dohAnswer(["93.184.216.34"]) : dohAnswer([]),
      secondary: (t) =>
        t === "A" ? dohAnswer(["169.254.169.254"]) : dohAnswer([]),
    });

    const result = await fetchWithValidatedRedirects(url, {
      headers: {},
    });

    expect(result.kind).toBe("blocked");
    expect(targetCalls).toHaveLength(0);
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("[ssrf-blocked]");
    expect(logged).toContain('"reason":"rebinding"');
    expect(logged).toContain('"host":"target.example.org"');
    // 不记录完整目标 URL / 原始客户端 IP
    expect(logged).not.toContain("img.png");
  });

  it("答案集合不完全一致（多一个 IP 也算不稳定）→ 拒绝", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    installStub({
      primary: () => dohAnswer(["93.184.216.34"]),
      secondary: () => dohAnswer(["93.184.216.34", "93.184.216.99"]),
    });

    const result = await fetchWithValidatedRedirects(url, {});
    expect(result.kind).toBe("blocked");
  });

  it("第二解析器不可用时退回主解析器复检：答案稳定则放行（不因备用挂掉就拒服务）", async () => {
    let round = 0;
    const { targetCalls } = installStub({
      primary: (t) => {
        if (t === "A") {
          round += 1;
          return dohAnswer(["93.184.216.34"]);
        }
        return dohAnswer([]);
      },
      secondary: "unavailable",
    });

    const result = await fetchWithValidatedRedirects(url, {});
    expect(result.kind).toBe("ok");
    expect(round).toBeGreaterThanOrEqual(2); // 主解析器被复检
    expect(targetCalls).toHaveLength(1);
  });

  it("第二解析器不可用且主解析器复检答案变化 → 拒绝（fail-closed）", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let aCount = 0;
    installStub({
      primary: (t) => {
        if (t !== "A") return dohAnswer([]);
        aCount += 1;
        // 第一次公网，复检时换成 metadata：模拟短 TTL 抖动
        return aCount === 1
          ? dohAnswer(["93.184.216.34"])
          : dohAnswer(["169.254.169.254"]);
      },
      secondary: "unavailable",
    });

    const result = await fetchWithValidatedRedirects(url, {});
    expect(result.kind).toBe("blocked");
  });

  it("主解析器查询失败 → resolution_failed（原有 fail-closed 口径不变）", async () => {
    installStub({
      primary: () => "throw",
      secondary: () => dohAnswer([]),
    });

    const result = await fetchWithValidatedRedirects(url, {});
    expect(result.kind).toBe("resolution_failed");
  });
});
