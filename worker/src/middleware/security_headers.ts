/**
 * 安全响应头中间件
 *
 * 修复渗透报告 002「安全响应头缺失（CSP / X-Frame-Options）」——API 侧。
 * API 只返回 JSON/媒体流，CSP 收敛为 default-src 'none'。
 * 前端 HTML 页面的 CSP 由 Astro 中间件 src/middleware.ts 与 public/_headers 负责。
 */

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // API 不需要加载任何资源；frame-ancestors 防 JSON 被 iframe 嵌套点击劫持
  headers.set(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
