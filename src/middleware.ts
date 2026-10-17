import { defineMiddleware } from 'astro:middleware';

/**
 * 前端页面安全响应头（渗透报告 002 修复）
 *
 * 与 public/_headers 保持同一策略：
 * - _headers 覆盖 Cloudflare Pages 静态资产与预渲染页面
 * - 本中间件覆盖 SSR 动态路由（如 /articles/[slug]）
 *
 * 说明：本文件为开发态基线 CSP——script-src 的 'unsafe-inline' 不会进入生产产物：
 * 构建完成后 astro:build:done 钩子（scripts/patch-csp.mjs）会将其替换为 dist 内联
 * 脚本（主题初始化、Astro 运行时 shim）的 sha256 列表，并对静态/SSR 两份产物做
 * 逐字符一致性断言；评估与维护说明见 docs/security/csp-evaluation.md。
 * style-src 保留 'unsafe-inline'（动态 settings 内联 <style> 与模板 style 属性）；
 * img-src/media-src 放行 https: 以兼容外链封面图与文章内音视频；
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
