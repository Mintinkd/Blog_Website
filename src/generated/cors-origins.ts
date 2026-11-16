/**
 * 生成物 —— 双端 CORS Origin 白名单（issue #85 / H4）。禁止手工编辑。
 *
 * 单一事实源：仓库根 cors.origins.json。
 * 本文件由 npm run gen:cors（scripts/generate-cors-origins.mjs）生成：
 * 根包 src/generated/cors-origins.ts 与 worker/src/generated/cors-origins.ts
 * 内容字节一致，两端 CORS 逻辑只消费本模块，不得在任何一处手抄列表。
 * 漂移修复流程：改 cors.origins.json → npm run gen:cors → 一并提交；
 * CI 漂移断言：重新生成 → git diff 必须为空（.github/workflows/deploy.yml）。
 */

/** 允许跨域回显 ACAO 的 Origin 精确列表（精确匹配，无后缀通配） */
export const ALLOWED_ORIGINS: readonly string[] = Object.freeze([
  "https://blog.zenfishlog.dpdns.org",
  "https://blog-website-page.pages.dev",
  "http://localhost:4321",
  "http://127.0.0.1:4321",
]);

/** Origin 是否在白名单；无 Origin（同源请求）返回 false */
export function isAllowedOrigin(origin: string | null | undefined): origin is string {
  return !!origin && ALLOWED_ORIGINS.includes(origin);
}
