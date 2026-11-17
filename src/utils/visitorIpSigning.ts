/**
 * Pages 转发点的访客 IP 签名（issue #84 / H3）。
 *
 * 与 worker/src/utils/client_ip.ts 的 signClientIp 同算法：
 *   HMAC-SHA256("client-ip:v1:" + ip.trim(), VISITOR_IP_SIGNING_SECRET) → hex
 * 两侧共享同一 secret（分别配置为 Pages / Worker 环境变量）。
 *
 * Pages 在把访客 cf-connecting-ip 写入 X-Real-IP 时，必须同时用本函数生成
 * X-Real-IP-Sig；Worker 验签通过才采信 X-Real-IP，从而杜绝直连伪造。
 * 这是 ADR 0005「X-Real-IP 才是访客 IP」裁定在跨信任跳场景下的必要加固
 * （READER_ANALYTICS.md:59 的「advisory 不加密钥」仅适用于统计维度头，
 * 去重 / 限流用的 IP 涉及配额与计数，属可被绕过的资源，故本票单独加签）。
 *
 * 环境变量非 PUBLIC_，只在服务端（Pages Function / SSR）可见，不下发浏览器。
 */

/** 必须与 worker/src/utils/client_ip.ts 的 SIGNING_CONTEXT 逐字一致 */
const SIGNING_CONTEXT = "client-ip:v1:";
export const IP_SIGNING_HEADER = "x-real-ip-sig";

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 生成签名；无 secret 或空 IP 返回 null（调用方据此不写签名头，Worker 端 fail-closed） */
export async function signVisitorIp(
  ip: string | null | undefined,
  secret: string | undefined
): Promise<string | null> {
  const normalized = ip?.trim();
  if (!normalized || !secret) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(SIGNING_CONTEXT + normalized)
  );
  return toHex(new Uint8Array(signature));
}

/**
 * 读取服务端 secret。
 *
 * **必须优先读运行时 env**：Astro 在构建期把 `import.meta.env.*` 内联成字面量，
 * Cloudflare 上私有变量不会在构建期出现（CI 只注入 CLOUDFLARE_*），若只读
 * `import.meta.env` 则线上恒为 `undefined` → 不写签名头 → Worker 端 fail-closed
 * 退回 `CF-Connecting-IP`（那是 Pages 出口 IP，全站同一值），点赞去重 / 限流 /
 * 评论溯源按 IP 的口径全部失真。这正是 #84 要修的现象，故运行时 env 为第一来源。
 *
 * `@astrojs/cloudflare` 把 Pages 的环境变量挂在 `Astro.locals.runtime.env`，
 * 由调用方传入（本模块保持无 Astro 依赖，便于单测）。
 */
export function visitorIpSigningSecret(
  runtimeEnv?: unknown
): string | undefined {
  const fromRuntime = readEnvString(runtimeEnv, "VISITOR_IP_SIGNING_SECRET");
  if (fromRuntime) return fromRuntime;
  // 兜底：本地 dev / 构建期显式注入时（.env 或 Pages 构建设置）走内联值
  return readEnvString(import.meta.env, "VISITOR_IP_SIGNING_SECRET");
}

function readEnvString(env: unknown, key: string): string | undefined {
  if (!env || typeof env !== "object") return undefined;
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
