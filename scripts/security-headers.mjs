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
export const CSP_BASELINE =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https:; font-src 'self' data:; connect-src 'self'; frame-src https://player.bilibili.com https://www.youtube.com; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/** 全部 5 个响应头的基线值：CSP 基线 + 其余 4 头（middleware 与 _headers 生成物共用） */
export const SECURITY_HEADERS = {
  "Content-Security-Policy": CSP_BASELINE,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * 以 CSP 基线为源构造收紧后的 CSP（构建期消费，hash 由调用方从 dist 内联脚本
 * 实时计算）：script-src 指令移除基线中的 'unsafe-inline'，追加给定 sha256
 * 列表；列表内部按字典序排序，保证产物字节稳定。基线形状异常时抛错
 * （fail-loud，构建失败即报错）。
 */
export function tightenCsp(hashes) {
  const segments = CSP_BASELINE.split("; ");
  const scriptSrcIndex = segments.findIndex((segment) =>
    segment.startsWith("script-src ")
  );
  if (scriptSrcIndex < 0) {
    throw new Error(
      "[security-headers] CSP 基线缺少 script-src 指令，拒绝收紧"
    );
  }
  const sources = segments[scriptSrcIndex]
    .slice("script-src ".length)
    .split(" ");
  const keptSources = sources.filter((source) => source !== "'unsafe-inline'");
  if (keptSources.length === sources.length) {
    throw new Error(
      "[security-headers] CSP 基线的 script-src 不含 'unsafe-inline'，拒绝重复收紧"
    );
  }
  segments[scriptSrcIndex] = [
    "script-src",
    ...keptSources,
    ...[...hashes].sort(),
  ].join(" ");
  return segments.join("; ");
}

/**
 * 收紧残留断言（patch-csp 产物扫描用）：script-src 指令内是否仍放行
 * 'unsafe-inline'；其它指令（如 style-src）的 'unsafe-inline' 是预期保留，
 * 不计入。
 */
export function scriptSrcAllowsUnsafeInline(csp) {
  return /script-src[^;]*'unsafe-inline'/.test(csp);
}

/**
 * 整文件渲染 public/_headers 生成物（prebuild 与 CI 漂移断言消费）：
 * 生成标记注释 + Cloudflare Pages 规则块（星号通配 + 5 头全量）。
 */
export function renderHeadersFile() {
  const lines = [
    "# 生成物 —— 禁止手工编辑（issue #28 / ADR 0002）",
    "# 单一事实源：scripts/security-headers.mjs（安全头模块）；生成命令：npm run gen:headers（prebuild 自动执行）",
    "# CI 漂移断言：重新生成后 git diff 非空即红（.github/workflows/deploy.yml）",
    "# 覆盖：Cloudflare Pages 静态资产与预渲染页面；SSR 动态路由由 src/middleware.ts 应用同一策略",
    "# CSP 基线（script-src 含 'unsafe-inline'）仅服务 dev；生产产物由 astro:build:done 钩子（scripts/patch-csp.mjs）收紧为 dist 内联脚本 sha256",
    "/*",
    ...Object.entries(SECURITY_HEADERS).map(
      ([name, value]) => `  ${name}: ${value}`
    ),
  ];
  return lines.join("\n") + "\n";
}
