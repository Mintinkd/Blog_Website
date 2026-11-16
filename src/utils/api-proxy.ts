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
 */
import { isAllowedOrigin } from "../generated/cors-origins";
import { SECURITY_HEADERS } from "../../scripts/security-headers.mjs";

const ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization";
const MAX_AGE = "86400";

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
 * 上游响应 → 浏览器响应头。
 * 先清掉上游与本地的所有 CORS 头，再按请求 Origin 精确回显，杜绝 `*` 透传/残留。
 */
export function buildProxyResponseHeaders(
  upstream: Headers,
  dev: boolean,
  origin: string | null | undefined
): Headers {
  const headers = new Headers(upstream);
  for (const key of [
    "access-control-allow-origin",
    "access-control-allow-methods",
    "access-control-allow-headers",
    "access-control-max-age",
    "vary",
  ]) {
    headers.delete(key);
  }
  const cors = buildCorsHeaders(origin);
  for (const [key, value] of cors) {
    headers.set(key, value);
  }
  if (dev) {
    headers.delete("content-encoding");
    headers.delete("content-length");
  }
  return headers;
}
