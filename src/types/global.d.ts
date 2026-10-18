/**
 * 运行时注入的全局能力类型声明（前端类型门禁，issue #26）。
 *
 * 实现由 src/components/layout/BaseLayout.astro 的内联脚本在页面运行时挂载，
 * 本文件只登记类型；新增「运行时挂到 window 的能力」在此补声明，
 * 消费方/挂载方一律类型化使用，不再 (window as any) 逃逸检查。
 */
declare global {
  interface Window {
    /**
     * 外链文字/接口代理入口（README「外链内容智能代理」）：
     * 直连失败/受限自动兜底 /api/v1/text-proxy；签名须与 BaseLayout.astro 的挂载实现一致
     */
    fetchWithProxy: (
      input: RequestInfo | URL,
      init?: RequestInit,
      opts?: { forceProxy?: boolean }
    ) => Promise<Response>;
  }
}

export {};
