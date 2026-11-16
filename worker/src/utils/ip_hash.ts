/**
 * IP 哈希单点（issue #104 / L5）。
 *
 * 背景：点赞去重与评论溯源都存 `ip_hash`，此前盐以「`-salt-<域>-<年份>`」的
 * 形式硬编码在源码。IPv4 空间只有 2^32，攻击者拿到 `ip_hash` 后可以用硬编码盐
 * 离线枚举反推真实 IP，隐私保护形同虚设。
 *
 * 现方案：
 * - 盐来自服务端 secret `IP_HASH_SECRET`（与 #84 / H3 的 `VISITOR_IP_SIGNING_SECRET`
 *   同一种配置形态：`wrangler secret put`），源码不再出现任何字面量盐；
 * - **单 secret + 双域盐**：`blog`（评论）与 `like`（点赞）用域前缀派生不同盐，
 *   保留「两域哈希不可交叉比对」的纵深防御，又只需运维维护一份 secret；
 * - 未配置 secret 时 fail-closed：抛 `MissingIpHashSecretError`，调用方返回 500，
 *   绝不退回到弱盐哈希（宁可点赞 / 评论不可用，也不写弱哈希污染存量数据）；
 * - 哈希算法不变（SHA-256），本票只换盐来源（#104 Out of scope：更换算法）。
 *
 * 存量数据结论见关票评论：旧 `ip_hash` 由硬编码盐产生，无法在不知明文 IP 的
 * 前提下重算，故不迁移；影响面是「点赞去重一次性重置」（同一访客可再点一次），
 * 评论的 `ip_hash` 仅用于溯源展示，无功能依赖。
 */

export const IP_HASH_SECRET_ENV = "IP_HASH_SECRET";

/** 哈希域：评论与点赞分开派生盐，避免两域哈希可交叉比对 */
export type IpHashScope = "blog" | "like";

const HASH_CONTEXT = "ip-hash:v1";

const encoder = new TextEncoder();

/** secret 未配置（或为空串 / 纯空白）时抛出，调用方据此 fail-closed */
export class MissingIpHashSecretError extends Error {
  constructor() {
    super(`${IP_HASH_SECRET_ENV} is not configured`);
    this.name = "MissingIpHashSecretError";
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 计算 IP 哈希（hex，64 字符）。
 * @throws {MissingIpHashSecretError} secret 缺失或为空白
 */
export async function hashIp(
  ip: string,
  scope: IpHashScope,
  secret: string | null | undefined
): Promise<string> {
  if (!secret || !secret.trim()) throw new MissingIpHashSecretError();
  const data = encoder.encode(
    `${HASH_CONTEXT}:${scope}:${ip.trim()}:${secret}`
  );
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}
