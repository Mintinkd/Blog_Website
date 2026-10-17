import { defineMiddleware } from 'astro:middleware';

/**
 * 前端页面安全响应头（渗透报告 002 修复）
 *
 * 与 public/_headers 保持同一策略：
 * - _headers 覆盖 Cloudflare Pages 静态资产与预渲染页面
 * - 本中间件覆盖 SSR 动态路由（如 /articles/[slug]）
 *
 * 说明：script-src/style-src 需要 'unsafe-inline'（主题初始化内联脚本、
 * 动态 settings 内联 <style>、HTML style 属性）；img-src/media-src 放行 https:
 * 以兼容外链封面图与文章内音视频（后续封面图全面本站托管后可收敛）。
 * frame-src 仅放行 B 站/YouTube 播放器域（文章页媒体卡片注入 iframe 所需）。
 */
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; media-src 'self' https:; font-src 'self' data:; " +
    "connect-src 'self'; frame-src https://player.bilibili.com https://www.youtube.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
});
