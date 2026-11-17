/**
 * 客户端 IP 单点解析（issue #84 / H3）。
 *
 * 拓扑事实（ADR 0005、docs/READER_ANALYTICS.md §3、visitor_context.ts 已裁定）：
 * - 浏览器 → Pages Function → Worker 的子请求里，Worker 看到的 `CF-Connecting-IP`
 *   是 Pages 出口地址，不是访客 IP；访客真实 IP 在 Pages 那一跳被写入 `X-Real-IP`。
 * - `CF-Connecting-IP` 由 Cloudflare 边缘强制设置，客户端无法伪造；
 *   `X-Real-IP` / `XFF` 是普通头，任何直连 Worker 的客户端都能伪造。
 *
 * 因此采用「可信跳签名」：Pages 转发点用共享 secret 对 IP 做 HMAC-SHA256，
 * 写入 `X-Real-IP-Sig`；本模块验签通过才采信 `X-Real-IP`。直连伪造者不知 secret，
 * 验签失败 → 回退边缘可信的 `CF-Connecting-IP`，无法绕过去重 / 限流。
 *
 * 优先级：X-Real-IP（验签通过）→ CF-Connecting-IP → XFF[0] → unknown。
 *
 * 共享 secret 由运维在 Pages（签名侧）与 Worker（验签侧）分别配置同名环境变量
 * `VISITOR_IP_SIGNING_SECRET`；未配置时 fail-closed——不采信任何 X-Real-IP。
 */

export const IP_SIGNING_HEADER = "x-real-ip-sig";
export const IP_SIGNING_SECRET_ENV = "VISITOR_IP_SIGNING_SECRET";

/** HMAC 输入域分隔前缀：避免与站点其它 HMAC 用途密钥复用时产生交叉签名 */
const SIGNING_CONTEXT = "client-ip:v1:";

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 计算 IP 的签名 hex（与前端 src/utils/visitorIpSigning.ts 同算法，两侧必须一致）。
 * 输入先 trim，空值返回 null（避免给空 IP 签名）。
 */
export async function signClientIp(
  ip: string,
  secret: string
): Promise<string | null> {
  const normalized = ip.trim();
  if (!normalized) return null;
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

export interface ClientIpResult {
  ip: string;
  /** 采信来源，便于日志 / 测试观测；不影响判定 */
  source: "signed-proxy" | "edge" | "xff" | "unknown";
}

/**
 * 单点解析客户端 IP。secret 为空时跳过 X-Real-IP（fail-closed）。
 * 验签常数时间比较，且不回显签名细节。
 */
export async function resolveClientIp(
  request: Request,
  secret?: string | null
): Promise<ClientIpResult> {
  const headers = request.headers;
  const xRealIp = headers.get("X-Real-IP")?.trim();

  if (xRealIp && secret) {
    const provided = headers.get(IP_SIGNING_HEADER)?.trim() ?? "";
    const expected = await signClientIp(xRealIp, secret);
    if (expected && provided && timingSafeEqual(expected, provided)) {
      return { ip: xRealIp, source: "signed-proxy" };
    }
  }

  const edgeIp = headers.get("CF-Connecting-IP")?.trim();
  if (edgeIp) return { ip: edgeIp, source: "edge" };

  const xff = headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  if (xff) return { ip: xff, source: "xff" };

  return { ip: "unknown", source: "unknown" };
}

/** 便捷包装：只要 IP 字符串（调用点大多只关心它） */
export async function getClientIpString(
  request: Request,
  secret?: string | null
): Promise<string> {
  return (await resolveClientIp(request, secret)).ip;
}

/**
 * 只要「可信 Pages 跳签名通过」的 `X-Real-IP`；其余来源一律 null。
 *
 * 与 `resolveClientIp` 的差别是**不做边缘 / XFF 回退**——阅读统计把
 * 「有没有 SSR 转发」本身当作语义（SSR 链路计 pv/uv，直连只计 requests），
 * 回退会把直连请求伪装成 SSR。验签仍复用同一份实现，不另写一份 HMAC。
 */
export async function resolveSignedProxyIp(
  request: Request,
  secret?: string | null
): Promise<string | null> {
  const result = await resolveClientIp(request, secret);
  return result.source === "signed-proxy" ? result.ip : null;
}
