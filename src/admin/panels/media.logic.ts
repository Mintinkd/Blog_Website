/**
 * MediaPanel 的纯逻辑：从 App.vue `copyMediaUrl` 抽出的 URL 解析。
 * 只使用全局 URL，不触碰 window，可在 node 环境单测。
 */
export function resolveMediaUrl(url: string, origin: string): string {
  return new URL(url, origin).href;
}
