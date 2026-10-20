/**
 * Cloudflare 平台注入护栏（cloudflare-guards）——HTML 文档响应头单源。
 *
 * 背景（2026-10-20 自定义域实测）：Cloudflare 边缘会在站点 HTML 上追加两样东西，
 * 与本站收紧后的 CSP 及路由形态冲突，浏览器控制台持续报错：
 *
 * 1. JavaScript Detections（Bot Fight Mode 附属，无法单独关闭）注入内联 bootstrap
 *    脚本（`/cdn-cgi/challenge-platform/scripts/jsd/main.js` 装载器）。bootstrap
 *    无 hash / nonce，被 `script-src 'self' 'sha256-…'` 拒绝：Refused to execute
 *    inline script…（CSP violation）。Cloudflare 文档口径：origin 响应带
 *    `Cache-Control: no-transform` 即停止注入（代价：该 HTML 不经边缘 gzip/brotli
 *    压缩，且 `cf.bot_management.js_detection.passed` 显示 missing）。
 * 2. Speed Brain 注入 `Speculation-Rules: "/cdn-cgi/speculation"`，浏览器据此对站内
 *    链接发起 `Sec-Purpose: prefetch` 预取；本站路由全部落在 Pages Functions /
 *    Worker 上，边缘一律 503 拒绝（`cf-speculation-refused: prefetch refused:
 *    not eligible / disabled for worker requests`），控制台持续 net::ERR_ABORTED 503。
 *    Cloudflare 文档口径：origin 自带 `Speculation-Rules` 头时「不会覆盖」→ 指向
 *    自有空规则集（SPECULATION_RULES_PATH），浏览器不再发起预取。
 *
 * 两个护栏都只作用于 HTML 文档响应，且静态与 SSR 两条渠道各自必须接线：
 * - 静态 / 预渲染页面：public/_headers 由安全头模块渲染时附加 HTML_ROUTE_PATTERNS
 *   规则块（Pages 的 _headers 不作用于 Functions 响应）；
 * - SSR 动态路由：src/middleware.ts 按 content-type 调用 guardHtmlResponse。
 * 规则集由 src/pages/speculation-rules.ts 端点提供（speculationRulesResponse）。
 *
 * 维护：新增预渲染 HTML 路由需同步 HTML_ROUTE_PATTERNS；完整说明、取舍与已知边界
 * 见 docs/security/cloudflare-guards.md。导出面与同目录 .d.mts 成对维护。
 */

/** 自有空规则集路径（src/pages/speculation-rules.ts 提供） */
export const SPECULATION_RULES_PATH = "/speculation-rules";

/** 规则集 MIME：HTML 规范要求 application/speculationrules+json，否则浏览器忽略 */
export const SPECULATION_RULES_CONTENT_TYPE =
  "application/speculationrules+json";

/**
 * 空规则集：document 规则锚定一个永不存在的同源路径 → 不匹配任何链接 → 不发起
 * 预取。刻意不用空数组 / 空 rules，避免浏览器对空规则集的解析差异；`relative_to`
 * 显式取 document（外链规则集默认相对规则文件解析）。
 */
export const SPECULATION_RULES_BODY = JSON.stringify({
  prefetch: [
    {
      source: "document",
      where: {
        href_matches: "/__speculation_rules_disabled__",
        relative_to: "document",
      },
      eagerness: "conservative",
    },
  ],
});

/** 静态 HTML 护栏的 Cache-Control 基线：Pages 默认值（public, max-age=0, must-revalidate）+ no-transform */
export const NO_TRANSFORM_CACHE_CONTROL =
  "public, max-age=0, must-revalidate, no-transform";

/** Speculation-Rules 头值：URL 按规范加引号（同 Cloudflare 自带头的形态） */
export const SPECULATION_RULES_HEADER_VALUE = `"${SPECULATION_RULES_PATH}"`;

/**
 * HTML 文档护栏头基线（public/_headers 规则块与 middleware 共用）：
 * Cloudflare 文档（Cache-Control / Origin Cache Control、Speed Brain）逐一对应上文。
 */
export const HTML_GUARD_HEADERS = {
  "Cache-Control": NO_TRANSFORM_CACHE_CONTROL,
  "Speculation-Rules": SPECULATION_RULES_HEADER_VALUE,
};

/**
 * 需要护栏的预渲染 HTML 路由（与 dist/_routes.json 的 exclude 清单对齐，取无扩展名
 * 页面路由；SSR 路由由 middleware 运行时覆盖）。新增预渲染页面时同步此清单。
 */
export const HTML_ROUTE_PATTERNS = [
  "/",
  "/404*",
  "/about*",
  "/archives*",
  "/admin*",
  "/articles*",
  "/search*",
];

/** 依 content-type 判定 HTML 文档响应（含 charset 参数，大小写不敏感） */
export function isHtmlDocument(contentType) {
  return (
    typeof contentType === "string" &&
    contentType.trim().toLowerCase().startsWith("text/html")
  );
}

/**
 * Cache-Control 追加 no-transform（Cloudflare 以此豁免 JavaScript Detections 注入）：
 * 已有指令原样保留；已含 no-transform 则幂等；空值只留 no-transform。
 */
export function appendNoTransform(cacheControl) {
  const value = typeof cacheControl === "string" ? cacheControl.trim() : "";
  if (!value) return "no-transform";
  if (/(?:^|,)\s*no-transform\s*(?:,|$)/i.test(value)) return value;
  return `${value}, no-transform`;
}

/**
 * 给 HTML 文档响应追加护栏（就地修改 Headers；调用方传入 content-type，非 HTML
 * 一律不动）：Cache-Control 追加 no-transform + Speculation-Rules 指向自有空规则集。
 */
export function guardHtmlResponse(headers, contentType) {
  if (!isHtmlDocument(contentType)) return;
  headers.set("Cache-Control", appendNoTransform(headers.get("Cache-Control")));
  headers.set("Speculation-Rules", SPECULATION_RULES_HEADER_VALUE);
}

/**
 * 空规则集端点的响应（src/pages/speculation-rules.ts 直接返回）：
 * 正确 MIME + 浏览器长缓存（规则体是部署期常量）。
 */
export function speculationRulesResponse() {
  return new Response(SPECULATION_RULES_BODY, {
    headers: {
      "Content-Type": SPECULATION_RULES_CONTENT_TYPE,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
