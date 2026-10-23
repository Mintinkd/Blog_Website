/**
 * 友链 URL 渲染兜底（C1 / issue #43 防线三）。
 *
 * 与 worker 侧 isValidUrl 的 scheme 白名单同语义：解析后协议非 http/https
 * 一律返回空串，由调用方降级为非可点击文本。用于拦截修复前入库的存量脏数据
 * （javascript:/data: 等），协议相对 URL 已在 API 写入侧拒绝，无需在此重复。
 *
 * 仅在浏览器环境调用（组件 client:load 挂载），base 取当前页面地址。
 */
export function safeFriendLinkUrl(raw: unknown): string {
  try {
    const url = String(raw ?? "");
    const protocol = new URL(url, location.href).protocol;
    return protocol === "http:" || protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}
