import { defineMiddleware } from "astro:middleware";
import { SECURITY_HEADERS } from "../scripts/security-headers.mjs";
import { guardHtmlResponse } from "../scripts/cloudflare-guards.mjs";

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
 *
 * HTML 文档响应（SSR 动态路由）另经 cloudflare-guards 追加两个护栏头：
 * Cache-Control: no-transform 停 Cloudflare JavaScript Detections 注入（否则内联
 * bootstrap 被收紧后的 script-src 拒绝，控制台持续 CSP violation）；
 * Speculation-Rules 指向自有空规则集，覆盖 Speed Brain 预取（Worker 路由预取 503）。
 * 静态/预渲染页面由 public/_headers 的护栏规则块覆盖（Pages 的 _headers 不作用于
 * 本中间件产物）；口径与验证见 docs/security/cloudflare-guards.md。
 */
export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  guardHtmlResponse(response.headers, response.headers.get("content-type"));
  return response;
});
