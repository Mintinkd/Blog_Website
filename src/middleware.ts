import { defineMiddleware } from "astro:middleware";
import { SECURITY_HEADERS } from "../scripts/security-headers.mjs";

/**
 * 前端页面安全响应头（渗透报告 002 修复；单源改造 issue #28 / ADR 0002）
 *
 * 5 个响应头只在 scripts/security-headers.mjs（安全头模块）手工维护：
 * - 本中间件直接 import：覆盖 SSR 动态路由（如 /articles/[slug]）的响应头；
 * - public/_headers 为其生成物：覆盖 Cloudflare Pages 静态资产与预渲染页面。
 *
 * 本文件消费的是 CSP 基线（script-src 含 'unsafe-inline'），不会进入生产产物：
 * 构建完成后 astro:build:done 钩子（scripts/patch-csp.mjs）以模块为源构造收紧后的
 * CSP（dist 内联脚本 sha256），并对静态/SSR 两份产物做逐字符一致性断言；评估与
 * 维护说明见 docs/security/csp-evaluation.md。
 * style-src 保留 'unsafe-inline'（动态 settings 内联 <style> 与模板 style 属性）；
 * img-src/media-src 放行 https: 以兼容外链封面图与文章内音视频；
 * frame-src 仅放行 B 站/YouTube 播放器域（文章页媒体卡片注入 iframe 所需）。
 */
export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
});
