import { describe, expect, it, vi } from "vitest";
import {
  consumeRateLimit,
  rateLimitKey,
  slidingWindowCount,
  type RateLimitConfig,
  type RateLimitKV,
} from "../src/utils/rate_limiter";

/**
 * issue #91 / M3：统一 RateLimiter 的算法与边界突发上限。
 *
 * 接缝：rate_limiter 纯函数 + KV 交互（nowMs 注入，确定性）。
 * 期望值全部手写字面量，不从被测实现反推。
 */

const MINUTE = 60_000;
const CFG: RateLimitConfig = { windowMs: MINUTE, maxRequests: 10 };

/** 有状态 KV 桩：Map 存值，put 记录调用（验证 await 写入与 TTL）。 */
function makeKv() {
  const store = new Map<string, string>();
  const put = vi.fn(
    async (
      key: string,
      value: string,
      _options?: { expirationTtl?: number }
    ) => {
      store.set(key, value);
    }
  );
  const kv: RateLimitKV = {
    get: async (key) => store.get(key) ?? null,
    put,
  };
  return { kv, put, store };
}

describe("滑动窗口计数（issue #91）", () => {
  it("elapsedRatio=0 时上一窗口全额计入，=1 时归零", () => {
    expect(slidingWindowCount(10, 0, 0)).toBe(10);
    expect(slidingWindowCount(10, 0, 1)).toBe(0);
    expect(slidingWindowCount(10, 3, 0.5)).toBe(8);
    expect(slidingWindowCount(0, 7, 0.99)).toBeCloseTo(7);
  });

  it("ratio 越界被钳制到 [0,1]", () => {
    expect(slidingWindowCount(10, 0, -1)).toBe(10);
    expect(slidingWindowCount(10, 0, 2)).toBe(0);
  });
});

describe("统一键名规则", () => {
  it("scope + identity + windowIndex 组成确定性键", () => {
    expect(rateLimitKey("img", "1.2.3.4", 42)).toBe("ratelimit:img:1.2.3.4:42");
    expect(rateLimitKey("search", "unknown:GET:/search", 0)).toBe(
      "ratelimit:search:unknown:GET:/search:0"
    );
  });
});

describe("窗口边界突发上限（issue #91 AC：固定窗口 2× → 滑动窗口 ≤1×）", () => {
  it("上一窗口打满 10 次，切换瞬间（ratio≈0）最多只放行 1 次，不再突发到 2×", async () => {
    const { kv, store } = makeKv();
    // 窗口 0（index 0）打满 10 次
    store.set(rateLimitKey("x", "ip", 0), "10");

    // 切到窗口 1 的第一毫秒：prev 残余 ≈ 9.9998（<10）→ 放行 1 次（curr 0→1）；
    // 固定窗口此时会重置计数、放行满 10 次（2× 突发）。滑动窗口把突发压到 1 次。
    const first = await consumeRateLimit(kv, {
      scope: "x",
      identity: "ip",
      config: CFG,
      nowMs: MINUTE + 1,
    });
    expect(first.allowed).toBe(true);
    expect(first.count).toBeGreaterThan(9.99);

    const second = await consumeRateLimit(kv, {
      scope: "x",
      identity: "ip",
      config: CFG,
      nowMs: MINUTE + 2,
    });
    expect(second.allowed).toBe(false);
    expect(second.retryAfterSec).toBeGreaterThan(0);
  });

  it("窗口中点（ratio=0.5）：上一窗口残余权重减半，可放行至多 5 次", async () => {
    const { kv, store } = makeKv();
    store.set(rateLimitKey("x", "ip", 0), "10"); // 上一窗口满
    const midpoint = MINUTE + MINUTE / 2; // 窗口 1 的 50% 处

    // prev 残余 = 10 * (1 - 0.5) = 5；curr 从 0 开始，count < 10 → 可放行
    for (let i = 0; i < 5; i += 1) {
      const v = await consumeRateLimit(kv, {
        scope: "x",
        identity: "ip",
        config: CFG,
        nowMs: midpoint,
      });
      expect(v.allowed).toBe(true);
    }
    // 第 6 次：curr=5, prev 残余=5 → count=10 ≥ 10 → 拒绝
    const blocked = await consumeRateLimit(kv, {
      scope: "x",
      identity: "ip",
      config: CFG,
      nowMs: midpoint,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(10);
  });

  it("新窗口无上一窗口计数时退化为固定窗口：10 次放行，第 11 次拒绝", async () => {
    const { kv } = makeKv();
    for (let i = 0; i < 10; i += 1) {
      const v = await consumeRateLimit(kv, {
        scope: "x",
        identity: "ip",
        config: CFG,
        nowMs: 5_000,
      });
      expect(v.allowed).toBe(true);
    }
    const blocked = await consumeRateLimit(kv, {
      scope: "x",
      identity: "ip",
      config: CFG,
      nowMs: 5_000,
    });
    expect(blocked.allowed).toBe(false);
  });
});

describe("写入语义（缩小非原子窗口）", () => {
  it("放行时用 await put 写入当前窗口，TTL 覆盖两个窗口", async () => {
    const { kv, put } = makeKv();
    const v = await consumeRateLimit(kv, {
      scope: "x",
      identity: "ip",
      config: CFG,
      nowMs: 1_000,
    });
    expect(v.allowed).toBe(true);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toBe(rateLimitKey("x", "ip", 0));
    expect(put.mock.calls[0][1]).toBe("1");
    expect(put.mock.calls[0][2]).toEqual({ expirationTtl: 120 });
  });

  it("拒绝时不写 KV", async () => {
    const { kv, put, store } = makeKv();
    store.set(rateLimitKey("x", "ip", 0), "10");
    const v = await consumeRateLimit(kv, {
      scope: "x",
      identity: "ip",
      config: CFG,
      nowMs: 1_000,
    });
    expect(v.allowed).toBe(false);
    expect(put).not.toHaveBeenCalled();
  });
});
