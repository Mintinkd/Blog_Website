// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PATHS,
  parseDeployConfig,
  runCli,
  waitForReady,
} from "../scripts/wait-for-deploy.mjs";

/**
 * issue #106 / L8：CI 的部署就绪检查（替代固定 `sleep 120`）。
 *
 * 接缝：waitForReady（纯轮询逻辑，注入 fetch / sleep / now）+ parseDeployConfig（配置校验）。
 * 验收要求：轮询带超时上限、失败有明确日志与退出码、不静默通过。
 */

interface Attempt {
  url: string;
  status: number | "error";
}

/**
 * 造一个按「轮次」作答的 fetch 桩：rounds[i] 是第 i 次轮询每个路径的答案。
 * 同一轮内按请求顺序消费。
 */
function makeFetch(
  rounds: Array<Array<{ status: number; body?: unknown } | "throw">>
) {
  let round = 0;
  const calls: Attempt[] = [];
  const fetchImpl = async (url: string | URL | Request) => {
    const href = String(url);
    const plan = rounds[Math.min(round, rounds.length - 1)] ?? [];
    const index = calls.length % Math.max(plan.length, 1);
    const answer = plan[index];
    if (answer === "throw") {
      calls.push({ url: href, status: "error" });
      throw new Error("ECONNRESET");
    }
    const status = answer?.status ?? 500;
    calls.push({ url: href, status });
    return new Response(
      answer?.body === undefined ? "" : JSON.stringify(answer.body),
      {
        status,
        headers: { "content-type": "application/json" },
      }
    );
  };
  return {
    fetchImpl,
    calls,
    nextRound: () => {
      round += 1;
    },
    round: () => round,
  };
}

/**
 * 把「按轮次作答」的桩包一层：每轮两条请求跑完（calls 长度到偶数）再进下一轮。
 * 用 try/finally，保证探测抛错（网络异常）时也能推进轮次。
 */
function roundAware(fetch: ReturnType<typeof makeFetch>) {
  return async (url: string | URL | Request) => {
    try {
      return await fetch.fetchImpl(url);
    } finally {
      if (fetch.calls.length % 2 === 0) fetch.nextRound();
    }
  };
}

function fakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("parseDeployConfig（#106）", () => {
  it("默认配置：base URL 与两条探针路径", () => {
    const config = parseDeployConfig({});
    expect(config.baseUrl).toBe("https://blog.zenfishlog.dpdns.org");
    expect(config.paths).toEqual(DEFAULT_PATHS);
    expect(config.timeoutMs).toBeGreaterThan(0);
    expect(config.intervalMs).toBeGreaterThan(0);
  });

  it("允许用环境变量覆盖 base URL 与超时", () => {
    const config = parseDeployConfig({
      DEPLOY_BASE_URL: "https://staging.example.test",
      DEPLOY_TIMEOUT_SEC: "30",
      DEPLOY_INTERVAL_SEC: "2",
    });
    expect(config.baseUrl).toBe("https://staging.example.test");
    expect(config.timeoutMs).toBe(30_000);
    expect(config.intervalMs).toBe(2_000);
  });

  it.each(["", "not-a-url", "ftp://example.com", "javascript:alert(1)"])(
    "base URL 非法时 fail-closed：%j",
    (value) => {
      expect(() => parseDeployConfig({ DEPLOY_BASE_URL: value })).toThrow();
    }
  );

  it.each(["abc", "0", "-5"])("超时非正整数时 fail-closed：%j", (value) => {
    expect(() => parseDeployConfig({ DEPLOY_TIMEOUT_SEC: value })).toThrow();
  });

  it("探针路径不得为空（空列表等于无条件通过）", () => {
    expect(DEFAULT_PATHS.length).toBeGreaterThan(0);
    expect(DEFAULT_PATHS).toContain("/api/v1/health");
  });
});

describe("waitForReady（#106）", () => {
  it("首轮全绿：不重试，返回尝试次数 1", async () => {
    const fetch = makeFetch([
      [
        { status: 200 },
        { status: 200, body: { status: "ok", db: "connected" } },
      ],
    ]);
    const clock = fakeClock();

    const result = await waitForReady({
      baseUrl: "https://example.test",
      paths: ["/", "/api/v1/health"],
      timeoutMs: 60_000,
      intervalMs: 5_000,
      fetchImpl: fetch.fetchImpl,
      now: clock.now,
      sleep: clock.sleep,
      log: () => {},
    });

    expect(result.attempts).toBe(1);
    expect(fetch.calls).toHaveLength(2);
    expect(fetch.calls[0].url).toBe("https://example.test/");
  });

  it("首轮未就绪、次轮全绿：重试一次后成功", async () => {
    const fetch = makeFetch([
      [{ status: 500 }, { status: 200, body: { status: "error" } }],
      [
        { status: 200 },
        { status: 200, body: { status: "ok", db: "connected" } },
      ],
    ]);
    const clock = fakeClock();

    const result = await waitForReady({
      baseUrl: "https://example.test",
      paths: ["/", "/api/v1/health"],
      timeoutMs: 60_000,
      intervalMs: 5_000,
      fetchImpl: roundAware(fetch),
      now: clock.now,
      sleep: clock.sleep,
      log: () => {},
    });

    expect(result.attempts).toBe(2);
  });

  it("health 返回 200 但 body.status=error 时不算就绪（避免 DB 挂掉也放行）", async () => {
    const fetch = makeFetch([
      [{ status: 200 }, { status: 200, body: { status: "error" } }],
      [{ status: 200 }, { status: 200, body: { status: "error" } }],
    ]);
    const clock = fakeClock();

    await expect(
      waitForReady({
        baseUrl: "https://example.test",
        paths: ["/", "/api/v1/health"],
        timeoutMs: 10_000,
        intervalMs: 5_000,
        fetchImpl: roundAware(fetch),
        now: clock.now,
        sleep: clock.sleep,
        log: () => {},
      })
    ).rejects.toThrow(/\/api\/v1\/health/);
  });

  it("403 标成边缘拦截：detail 含提示，避免被当成「还没部署好」", async () => {
    const clock = fakeClock();
    const logs: string[] = [];
    const fetch403 = async () => new Response("blocked", { status: 403 });

    await expect(
      waitForReady({
        baseUrl: "https://example.test",
        paths: ["/"],
        timeoutMs: 3_000,
        intervalMs: 1_000,
        fetchImpl: fetch403,
        now: clock.now,
        sleep: clock.sleep,
        log: (line: string) => logs.push(line),
      })
    ).rejects.toThrow(/403（边缘拦截/);

    expect(logs.some((line) => line.includes("403（边缘拦截"))).toBe(true);
  });

  it("超时后抛出，错误信息含每条路径的最后状态（失败不静默）", async () => {
    const fetch = makeFetch([[{ status: 502 }, { status: 503 }]]);
    const clock = fakeClock();
    const logs: string[] = [];

    await expect(
      waitForReady({
        baseUrl: "https://example.test",
        paths: ["/", "/api/v1/health"],
        timeoutMs: 12_000,
        intervalMs: 5_000,
        fetchImpl: roundAware(fetch),
        now: clock.now,
        sleep: clock.sleep,
        log: (line: string) => logs.push(line),
      })
    ).rejects.toThrow(/502[\s\S]*503|503[\s\S]*502/);

    // 每轮都有可读日志（attempt 序号 + 各路径状态）
    expect(logs.some((l) => /attempt 1/.test(l))).toBe(true);
    // 日志行必须逐条路径可辨（否则多路径时无法判断是谁没就绪）
    expect(logs[0]).toContain("/ -> ");
    expect(logs[0]).toContain("/api/v1/health -> ");

    // 错误消息要带上每条路径的**末次**状态，而不是笼统一句「超时」
    const clock2 = fakeClock();
    await expect(
      waitForReady({
        baseUrl: "https://example.test",
        paths: ["/", "/api/v1/health"],
        timeoutMs: 12_000,
        intervalMs: 5_000,
        fetchImpl: roundAware(makeFetch([[{ status: 502 }, { status: 503 }]])),
        now: clock2.now,
        sleep: clock2.sleep,
        log: () => {},
      })
    ).rejects.toThrow(/\/ -> 502[\s\S]*\/api\/v1\/health -> 503/);
  });

  it("网络异常按未就绪处理，继续重试而不是直接崩", async () => {
    const fetch = makeFetch([
      ["throw", "throw"],
      [
        { status: 200 },
        { status: 200, body: { status: "ok", db: "connected" } },
      ],
    ]);
    const clock = fakeClock();

    const result = await waitForReady({
      baseUrl: "https://example.test",
      paths: ["/", "/api/v1/health"],
      timeoutMs: 60_000,
      intervalMs: 5_000,
      fetchImpl: roundAware(fetch),
      now: clock.now,
      sleep: clock.sleep,
      log: () => {},
    });

    expect(result.attempts).toBe(2);
  });

  it("间隔累计不会突破超时上限：最多轮询 ceil(timeout/interval) 次", async () => {
    const fetch = makeFetch([[{ status: 500 }, { status: 500 }]]);
    const clock = fakeClock();

    await expect(
      waitForReady({
        baseUrl: "https://example.test",
        paths: ["/", "/api/v1/health"],
        timeoutMs: 12_000,
        intervalMs: 5_000,
        fetchImpl: roundAware(fetch),
        now: clock.now,
        sleep: clock.sleep,
        log: () => {},
      })
    ).rejects.toThrow();

    // 12s / 5s → 最多 3 轮（0s, 5s, 10s），不会无限跑
    expect(fetch.calls.length).toBeLessThanOrEqual(6);
  });
});

/**
 * CLI 退出码（issue #106 验收「失败有非零退出码」）：
 * 只看 waitForReady 抛异常不够——CI 里被 catch 掉、进程仍退 0 就等于门禁没生效。
 */
describe("runCli 退出码（#106）", () => {
  const okRound = [
    { status: 200 },
    { status: 200, body: { status: "ok", db: "connected" } },
  ];

  it("全部探针就绪 → 返回 0", async () => {
    const fetch = makeFetch([okRound]);
    const code = await runCli(
      { DEPLOY_BASE_URL: "https://example.test" },
      {
        fetchImpl: roundAware(fetch),
        now: fakeClock().now,
        sleep: fakeClock().sleep,
        log: () => {},
      }
    );
    expect(code).toBe(0);
  });

  it("超时 → 返回 1，且日志里有 FAILED 与末次状态", async () => {
    const fetch = makeFetch([[{ status: 502 }, { status: 503 }]]);
    const clock = fakeClock();
    const logs: string[] = [];
    const code = await runCli(
      {
        DEPLOY_BASE_URL: "https://example.test",
        DEPLOY_TIMEOUT_SEC: "12",
        DEPLOY_INTERVAL_SEC: "5",
      },
      {
        fetchImpl: roundAware(fetch),
        now: clock.now,
        sleep: clock.sleep,
        log: (line: string) => logs.push(line),
      }
    );

    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("FAILED");
    expect(logs.join("\n")).toMatch(/\/ -> 502/);
  });

  it("配置非法（超时写成字符串）→ 返回 1，不静默跳过", async () => {
    const logs: string[] = [];
    const code = await runCli(
      { DEPLOY_BASE_URL: "https://example.test", DEPLOY_TIMEOUT_SEC: "abc" },
      { log: (line: string) => logs.push(line) }
    );
    expect(code).toBe(1);
    expect(logs.join("\n")).toContain("FAILED");
  });
});
