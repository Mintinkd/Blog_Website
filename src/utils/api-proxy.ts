/**
 * 同源 `/api/v1/*` 代理的响应头构造。
 *
 * Astro dev 下该路由跑在 Node：undici 会自动解压 fetch 响应体，却仍保留
 * 上游的 `Content-Encoding` / `Content-Length`；浏览器按头再解压一次，直接
 * `ERR_CONTENT_DECODING_FAILED`。生产构建跑在 workerd，body 保持压缩态，
 * 头必须原样透传，否则浏览器无法解码。
 *
 * 因此只在 dev 分支剥离这两个头。`dev` 由调用方从 `import.meta.env.DEV`
 * 注入，纯函数便于同时锁住两个分支。
 */

export const PROXY_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
} as const;

export function buildProxyResponseHeaders(
  upstream: Headers,
  dev: boolean
): Headers {
  const headers = new Headers(upstream);
  for (const [key, value] of Object.entries(PROXY_CORS_HEADERS)) {
    headers.set(key, value);
  }
  if (dev) {
    headers.delete("content-encoding");
    headers.delete("content-length");
  }
  return headers;
}
