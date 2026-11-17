/**
 * 同源 `/api/v1/*` 代理的响应头构造（issue #28 建立，#85 / H4 收严）。
 *
 * Astro dev 下该路由跑在 Node：undici 会自动解压 fetch 响应体，却仍保留
 * 上游的 `Content-Encoding` / `Content-Length`；浏览器按头再解压一次，直接
 * `ERR_CONTENT_DECODING_FAILED`。生产构建跑在 workerd，body 保持压缩态，
 * 头必须原样透传，否则浏览器无法解码。因此只在 dev 分支剥离这两个头。
 *
 * #85 / H4：代理此前无条件 `Access-Control-Allow-Origin: *`，把 Worker 已收紧的
 * CORS 白名单重新放开，任意第三方站点可跨域读本站公开 API。现改为：
 * - 白名单精确回显 Origin（与 Worker 共用 cors.origins.json 生成物），带 Vary: Origin；
 * - 非白名单 / 无 Origin 不写 ACAO（同源请求本就不需要）；
 * - 预检 OPTIONS 与正常响应都补安全响应头（与 src/middleware.ts / _headers 同口径）。
 *
 * #110：`buildProxyResponseHeaders` 剥离 RFC 7230 §6.1 的 hop-by-hop 头。这些头
 * 描述的是「单跳连接」语义（Connection / Transfer-Encoding / Upgrade 等），只对
 * 上游与代理之间的连接有效；透传给浏览器会让浏览器按错误的连接语义解码响应，
 * 也会把 Connection 里点名的内网自定义头（如 X-Internal-Token）泄露出去。
 */
import { isAllowedOrigin } from "../generated/cors-origins";
import { SECURITY_HEADERS } from "../../scripts/security-headers.mjs";

const ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization";
const MAX_AGE = "86400";

/** RFC 7230 §6.1 定义的 8 类标准 hop-by-hop 头（小写，Headers 名归一化后比对） */
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
] as const;

/**
 * 需要剥离的头名集合：8 类标准头 + 上游 `Connection` 头里点名的自定义头。
 * 必须先读 Connection 再删，否则自身被删后列举信息一并丢失。
 */
function hopByHopHeaderNames(upstream: Headers): Set<string> {
  const names = new Set<string>(HOP_BY_HOP_HEADERS);
  const connection = upstream.get("connection");
  if (connection) {
    for (const token of connection.split(",")) {
      const name = token.trim().toLowerCase();
      if (name) names.add(name);
    }
  }
  return names;
}

/** 构造同源代理的 CORS 头：白名单回显 + Vary，绝不无条件 `*` */
export function buildCorsHeaders(origin: string | null | undefined): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Max-Age": MAX_AGE,
    Vary: "Origin",
  });
  if (isAllowedOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

/** OPTIONS 预检响应头：CORS + 安全头，与 src/middleware.ts 口径一致 */
export function buildPreflightHeaders(
  origin: string | null | undefined
): Headers {
  const headers = buildCorsHeaders(origin);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  return headers;
}

/**
 * 上游 `Vary` + 本地的 `Origin` 合并（2026-11-17 审查修正）。
 *
 * 此前整条 `headers.delete("vary")` 会连带丢掉上游的 `Vary: Accept-Encoding`
 * 等缓存键，共用缓存可能把 gzip / br 变体发给不支持的客户端。现只摘掉
 * `Origin`（由 `buildCorsHeaders` 重建），其余 token 原样保留；上游若为
 * `Vary: *` 则整体保持 `*`（RFC 7234 §4.1）。
 */
function mergeVary(upstream: Headers): string {
  const raw = upstream.get("vary");
  if (!raw) return "Origin";
  const tokens = raw
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.some((token) => token === "*")) return "*";
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (key === "origin" || seen.has(key)) continue;
    seen.add(key);
    merged.push(token);
  }
  merged.push("Origin");
  return merged.join(", ");
}

/**
 * 上游响应 → 浏览器响应头。
 * 先剥离 hop-by-hop 头（#110），再清掉上游与本地的所有 CORS 头，
 * 最后按请求 Origin 精确回显，杜绝 `*` 透传/残留；`Vary` 只摘除 `Origin`
 * 后与上游剩余 token 合并，不整条丢弃。
 */
export function buildProxyResponseHeaders(
  upstream: Headers,
  dev: boolean,
  origin: string | null | undefined
): Headers {
  const headers = new Headers(upstream);
  const vary = mergeVary(upstream);
  for (const name of hopByHopHeaderNames(upstream)) {
    headers.delete(name);
  }
  for (const key of [
    "access-control-allow-origin",
    "access-control-allow-methods",
    "access-control-allow-headers",
    "access-control-max-age",
  ]) {
    headers.delete(key);
  }
  const cors = buildCorsHeaders(origin);
  for (const [key, value] of cors) {
    headers.set(key, value);
  }
  headers.set("vary", vary);
  if (dev) {
    headers.delete("content-encoding");
    headers.delete("content-length");
  }
  return headers;
}

/**
 * 代理自身生成的 JSON 错误响应头（2026-11-17 审查修正）。
 *
 * 502 兜底此前复用 `buildPreflightHeaders`：带上了预检专用的
 * `Access-Control-Allow-Methods` / `-Headers` / `Max-Age`，却漏了
 * `Content-Type: application/json`，客户端按文本解析。这里保留与正常代理
 * 响应同口径的白名单 CORS + 安全头，并补上 JSON 类型。
 */
export function buildProxyErrorHeaders(
  origin: string | null | undefined
): Headers {
  const headers = buildPreflightHeaders(origin);
  headers.set("content-type", "application/json; charset=utf-8");
  return headers;
}
