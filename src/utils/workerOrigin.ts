/**
 * Worker API origin 单一事实源。
 *
 * 前端在三个服务端入口直连 Worker：SSR 文章页取数、RSS 订阅源、同源 API 代理。
 * 页面 / RSS 不走同源代理（避免 SSR 请求再绕一层自身路由），代理路由仍以同源
 * `/api/v1/*` 暴露给浏览器。三者必须指向同一个 Worker。
 */
export const WORKER_ORIGIN = "https://blog-api.zen-13467.workers.dev";
