/**
 * 站点 / 部署环境配置单源（issue：硬编码配置迁移）。
 *
 * 背景：站点域名、Worker origin、API 前缀、sitemap 分页等值此前散落在
 * `astro.config.mjs` / `src/utils/workerOrigin.ts` / `public/robots.txt` 等文件里。
 * 现在统一由环境变量驱动，默认值只保留在本模块一处；未配置时行为与迁移前一致。
 *
 * 约定：
 * - 环境变量既接受 `SITE_URL` / `WORKER_ORIGIN`（构建 / 部署脚本），也接受
 *   `PUBLIC_SITE_URL` / `PUBLIC_WORKER_ORIGIN`（Vite 暴露给前端源码的别名）。
 * - origin 必须是 http(s) 且不含路径 / 查询 / 片段；非法值直接抛错（fail-closed），
 *   避免构建出一个指向错误域名的产物。
 * - 本模块零依赖，Node 22 与 Astro 配置、前端源码共用；类型声明见
 *   `site-config.d.mts`（与实现成对维护）。
 */

/** 生产站点 origin 默认值（未配置 SITE_URL / PUBLIC_SITE_URL 时使用） */
export const DEFAULT_SITE_URL = "https://blog.zenfishlog.dpdns.org";

/** API Worker origin 默认值（未配置 WORKER_ORIGIN / PUBLIC_WORKER_ORIGIN 时使用） */
export const DEFAULT_WORKER_ORIGIN = "https://blog-api.zen-13467.workers.dev";

/** API 路由前缀默认值（与 Worker `API_PREFIX` 保持一致） */
export const DEFAULT_API_PREFIX = "/api/v1";

/** sitemap 构建期拉取文章列表时每页条数默认值 */
export const DEFAULT_SITEMAP_PAGE_SIZE = 50;

/** 从多个候选键里取第一个非空字符串（支持 PUBLIC_ 别名与普通变量） */
function firstNonEmpty(env, keys) {
  for (const key of keys) {
    const value = env?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * 规范化 origin：去掉尾部斜杠；必须是 http(s) 且不含路径 / 查询 / 片段。
 * 空值返回空串（调用方决定回落默认值），非法值抛错。
 */
export function normalizeOrigin(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`站点 origin 不是合法 URL：${JSON.stringify(raw)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`站点 origin 必须是 http(s)：${JSON.stringify(raw)}`);
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(
      `站点 origin 不得包含路径 / 查询 / 片段：${JSON.stringify(raw)}`
    );
  }
  return parsed.origin;
}

/** 站点 origin：SITE_URL / PUBLIC_SITE_URL → 默认值 */
export function resolveSiteUrl(env = process.env) {
  return (
    normalizeOrigin(firstNonEmpty(env, ["PUBLIC_SITE_URL", "SITE_URL"])) ||
    DEFAULT_SITE_URL
  );
}

/** Worker origin：WORKER_ORIGIN / PUBLIC_WORKER_ORIGIN → 默认值 */
export function resolveWorkerOrigin(env = process.env) {
  return (
    normalizeOrigin(
      firstNonEmpty(env, ["PUBLIC_WORKER_ORIGIN", "WORKER_ORIGIN"])
    ) || DEFAULT_WORKER_ORIGIN
  );
}

/** API 前缀：保证以 / 开头且不带尾斜杠（空值回落默认值） */
export function resolveApiPrefix(env = process.env) {
  const raw = firstNonEmpty(env, ["API_PREFIX"]);
  if (!raw) return DEFAULT_API_PREFIX;
  const normalized = `/${raw.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  return normalized === "/" ? DEFAULT_API_PREFIX : normalized;
}

/**
 * sitemap 构建期拉取已发布文章列表的 base URL：
 * SITEMAP_API_BASE（显式覆盖）→ `SITE_URL + API_PREFIX + /articles`。
 * 默认走站点同源而不是 workers.dev：后者在国内网络下常被阻断，构建期拉不到
 * 文章 slug 会让 sitemap 静默缺文章。显式覆盖同样去尾斜杠；非法 URL 由 fetch
 * 报错并走 sitemap 的降级分支。
 */
export function resolveSitemapApiBase(env = process.env) {
  const explicit = firstNonEmpty(env, ["SITEMAP_API_BASE"]);
  if (explicit) return explicit.replace(/\/+$/, "");
  return `${resolveSiteUrl(env)}${resolveApiPrefix(env)}/articles`;
}

/** 正整数环境变量：未配置 / 空值回落默认；非法值抛错（fail-closed） */
export function resolvePositiveInt(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${name} must be a positive integer, got ${JSON.stringify(value)}`
    );
  }
  return parsed;
}
