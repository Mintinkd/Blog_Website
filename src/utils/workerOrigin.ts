/**
 * Worker API origin 单一事实源。
 *
 * 前端在三个服务端入口直连 Worker：SSR 文章页取数、RSS 订阅源、同源 API 代理。
 * 页面 / RSS 不走同源代理（避免 SSR 请求再绕一层自身路由），代理路由仍以同源
 * `/api/v1/*` 暴露给浏览器。三者必须指向同一个 Worker。
 */
export const WORKER_ORIGIN = "https://blog-api.zen-13467.workers.dev";

export interface WorkerOriginEnv {
  /** Vite / Astro 的开发态标记；生产构建为 false。 */
  DEV?: boolean;
  /** 仅 dev 生效：把文章页服务端取数指向本地 mock（#41 回归脚本）。 */
  ARTICLE_API_ORIGIN?: string;
}

/**
 * 文章页 SSR 的 Worker origin。
 *
 * 正常路径始终返回 `WORKER_ORIGIN`；只有 dev 且显式设置 `ARTICLE_API_ORIGIN`
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
  return (override || WORKER_ORIGIN).replace(/\/+$/, "");
}
