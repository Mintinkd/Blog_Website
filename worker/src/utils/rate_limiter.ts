/**
 * 统一限流器（issue #91 / M3）。
 *
 * 三处原本各写一份限流（全局中间件 / img-proxy / text-proxy，另 scrape 同构），
 * 规则分散且用固定窗口 `Math.floor(now / window_ms)`——窗口边界突发可达 2× 配额，
 * KV get→判断→put 非原子。本模块收敛为一套算法与配置：
 *
 * 算法：滑动窗口计数（sliding window counter）——当前窗口实计数 + 上一窗口计数按
 *   当前窗口已流逝比例线性衰减加权。相比固定窗口，边界突发被上一窗口的残余权重抑制，
 *   不会在切换瞬间出现 2× 配额（有单测钉上限）。
 *
 * 非原子：KV 无原子自增，仍存在 get→put 并发窗口，跨 PoP 最终一致（~60s）导致计数低估。
 *   本模块无法根治这两点，作为残余风险在 #91 关闭评论如实记录；彻底解决需 Durable Objects
 *   或 Cloudflare Rate Limiting API（Out of scope）。
 *
 * 时间源注入：nowMs 由调用方传入，便于单测确定性断言窗口边界。
 */

export interface RateLimitConfig {
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 窗口内最大请求数 */
  maxRequests: number;
}

export interface RateLimitVerdict {
  /** 是否放行 */
  allowed: boolean;
  /** 当前估算的请求数（含上一窗口加权） */
  count: number;
  /** 被拒时距「最迟可用」的保守秒数（上一窗口残余完全滑出；放行时为 0） */
  retryAfterSec: number;
}

/** KV 的最小接口（便于单测桩，与 Env.RATE_LIMIT 兼容）。 */
export interface RateLimitKV {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void>;
}

/** 统一键名规则：`ratelimit:<scope>:<identity>:<windowIndex>`。 */
export function rateLimitKey(
  scope: string,
  identity: string,
  windowIndex: number
): string {
  return `ratelimit:${scope}:${identity}:${windowIndex}`;
}

/**
 * 滑动窗口计数估算。
 * @param prevCount 上一窗口实际计数
 * @param currCount 当前窗口实际计数
 * @param elapsedRatio 当前窗口已流逝比例 [0,1)
 * @returns 估算的窗口内累计请求数（浮点，调用方与 maxRequests 比较）
 */
export function slidingWindowCount(
  prevCount: number,
  currCount: number,
  elapsedRatio: number
): number {
  const ratio = Math.min(1, Math.max(0, elapsedRatio));
  return currCount + prevCount * (1 - ratio);
}

/**
 * 检查并消费一次配额。纯 KV 交互，不涉及响应构造 / IP 解析 / 路由分桶——
 * 那些由各调用点负责，保证算法单点、策略分散。
 */
export async function consumeRateLimit(
  kv: RateLimitKV,
  opts: {
    scope: string;
    identity: string;
    config: RateLimitConfig;
    nowMs: number;
  }
): Promise<RateLimitVerdict> {
  const { scope, identity, config, nowMs } = opts;
  const windowIndex = Math.floor(nowMs / config.windowMs);
  const elapsedRatio = (nowMs % config.windowMs) / config.windowMs;
  const currKey = rateLimitKey(scope, identity, windowIndex);
  const prevKey = rateLimitKey(scope, identity, windowIndex - 1);

  // await（而非 waitUntil）：写完成才返回，缩小 get→put 的并发超发窗口。
  const [currRaw, prevRaw] = await Promise.all([
    kv.get(currKey),
    kv.get(prevKey),
  ]);
  const currCount = parseInt(currRaw ?? "0", 10) || 0;
  const prevCount = parseInt(prevRaw ?? "0", 10) || 0;
  const count = slidingWindowCount(prevCount, currCount, elapsedRatio);

  if (count >= config.maxRequests) {
    // 滑动窗口下，仅等「当前窗口结束」不够——进入下一窗口后，本窗口计数仍作为
    // 「上一窗口」带残余权重。保守上界：再等一整个窗口，上一窗口计数必已完全滑出，
    // 此时 count 只剩新窗口自身计数，一定可重试。文案给出的是「最迟」可用时间。
    const remainingMs = config.windowMs - (nowMs % config.windowMs);
    const retryAfterSec = Math.max(
      1,
      Math.ceil((remainingMs + config.windowMs) / 1000)
    );
    return { allowed: false, count, retryAfterSec };
  }

  // TTL 覆盖两个窗口，确保进入下一窗口后仍能读到本窗口作为「上一窗口」。
  await kv.put(currKey, String(currCount + 1), {
    expirationTtl: Math.ceil((2 * config.windowMs) / 1000),
  });
  return { allowed: true, count, retryAfterSec: 0 };
}
