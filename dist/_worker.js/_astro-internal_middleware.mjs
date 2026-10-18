globalThis.process ??= {}; globalThis.process.env ??= {};
import { e as defineMiddleware, s as sequence } from './chunks/render-context_kOCTozKI.mjs';
import './chunks/astro-designed-error-pages_BrbhWMFr.mjs';
import './chunks/astro/server_Dtj_OyDT.mjs';

/**
 * 安全响应头单一事实源（issue #28 / ADR 0002）。
 *
 * 五个响应头只在此处手工维护，消费方一律 import 本模块或消费其渲染/构造结果：
 * - src/middleware.ts 直接 import（dev 与 SSR 基线；类型见同目录
 *   security-headers.d.mts）；
 * - scripts/generate-headers.mjs 整文件渲染 public/_headers（生成物，prebuild
 *   自动执行，CI 漂移断言守护）；
 * - scripts/patch-csp.mjs 以本模块为源构造收紧后的 CSP（script-src 基线替换为
 *   dist 内联脚本 sha256），并以本模块断言产物无未收紧 script-src 残留。
 *
 * CSP 基线（script-src 含 'unsafe-inline'，#9/#10 指令内容原样）只存在于源码与
 * dev，不进入生产产物：构建期由 patch-csp 收紧，静态/SSR 两份产物逐字符一致。
 * style-src 因动态 settings 内联样式与模板 style 属性保留 'unsafe-inline'；
 * img-src/media-src 放行 https: 以兼容外链封面图与文章内音视频；frame-src 仅
 * 放行 B 站/YouTube 播放器域（文章页媒体卡片注入 iframe 所需）。评估与维护说明
 * 见 docs/security/csp-evaluation.md。
 */

/** CSP 基线：声明态 CSP（script-src 含 'unsafe-inline'），#9/#10 指令内容原样 */
const CSP_BASELINE =
  "default-src 'self'; script-src 'self' 'sha256-QzWFZi+FLIx23tnm9SBU4aEgx4x8DsuASP07mfqol/c=' 'sha256-U7a72oKuFFz8D7GUHLA1NZ0ciymHmDOc9T9aVDg2rWU=' 'sha256-UVStnCjAg3prSDRExecE+IBz0gekyw78JnKQYFIf5Ig='; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https:; font-src 'self' data:; connect-src 'self'; frame-src https://player.bilibili.com https://www.youtube.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/** 全部 5 个响应头的基线值：CSP 基线 + 其余 4 头（middleware 与 _headers 生成物共用） */
const SECURITY_HEADERS = {
  "Content-Security-Policy": CSP_BASELINE,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const onRequest$2 = defineMiddleware(async (_context, next) => {
  const response = await next();
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
});

const onRequest$1 = (context, next) => {
  if (context.isPrerendered) {
    context.locals.runtime ??= {
      env: process.env
    };
  }
  return next();
};

const onRequest = sequence(
	onRequest$1,
	onRequest$2
	
);

export { onRequest };
