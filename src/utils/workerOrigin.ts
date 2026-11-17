import {
  DEFAULT_WORKER_ORIGIN,
  normalizeOrigin,
} from "../../scripts/site-config.mjs";

/**
 * Worker API origin 单一事实源。
 *
 * 前端在三个服务端入口直连 Worker：SSR 文章页取数、RSS 订阅源、同源 API 代理。
 * 页面 / RSS 不走同源代理（避免 SSR 请求再绕一层自身路由），代理路由仍以同源
 * `/api/v1/*` 暴露给浏览器。生产环境三者指向同一个 Worker；dev 下文章页可取数
 * 指向本地 mock（`ARTICLE_API_ORIGIN`），RSS / API 代理仍走 `WORKER_ORIGIN`。
 *
 * 生产 origin 由构建期环境变量 `PUBLIC_WORKER_ORIGIN`（或 `WORKER_ORIGIN`）注入，
 * 默认值集中在 `scripts/site-config.mjs`；未配置时行为与迁移前一致。
 */
export interface WorkerOriginEnv {
  /** Vite / Astro 的开发态标记；生产构建为 false。 */
  DEV?: boolean;
  /** 仅 dev 生效：把文章页服务端取数指向本地 mock（#41 回归脚本）。 */
  ARTICLE_API_ORIGIN?: string;
  /** 构建期注入的 Worker origin（Vite 的 PUBLIC_ 变量）。 */
  PUBLIC_WORKER_ORIGIN?: string;
  /** 构建期注入的 Worker origin（非 PUBLIC_ 别名，便于脚本复用）。 */
  WORKER_ORIGIN?: string;
}

/** 解析 Worker origin：构建期 env → 仓库默认值；非法 URL 直接抛错（fail-closed）。 */
export function resolveWorkerOrigin(
  env: WorkerOriginEnv = import.meta.env
): string {
  return (
    normalizeOrigin(
      env.PUBLIC_WORKER_ORIGIN?.trim() || env.WORKER_ORIGIN?.trim()
    ) || DEFAULT_WORKER_ORIGIN
  );
}

export const WORKER_ORIGIN = resolveWorkerOrigin();

/**
 * 文章页 SSR 的 Worker origin。
 *
 * 正常路径始终返回构建期 origin；只有 dev 且显式设置 `ARTICLE_API_ORIGIN`
 * 时才改用本地 mock，供 Playwright 离线回归使用。生产构建里 `DEV` 为 false，
 * 覆盖值被忽略，线上取数目标不会被同名环境变量劫持。
 */
export function resolveArticleApiOrigin(
  env: WorkerOriginEnv = import.meta.env
): string {
  const override =
    env.DEV && typeof env.ARTICLE_API_ORIGIN === "string"
      ? env.ARTICLE_API_ORIGIN.trim()
      : "";
  return (override || resolveWorkerOrigin(env)).replace(/\/+$/, "");
}
