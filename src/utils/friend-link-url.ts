/**
 * 友链 URL 渲染兜底（C1 / issue #43 防线三）。
 *
 * 与 worker 侧 isValidUrl 保持同一接受集合：仅放行 http/https 绝对 URL，
 * javascript:/data:/vbscript: 等危险 scheme、协议相对 URL、相对路径、
 * 无 scheme 主机名一律返回空串，由调用方降级为非可点击文本。
 * 用于拦截修复前入库的存量脏数据（含 bulk import 等写入侧漏网场景）。
 *
 * 仅在浏览器环境调用（组件 client:load / 后台挂载），不依赖页面地址。
 */
export function safeFriendLinkUrl(raw: unknown): string {
  try {
    const url = String(raw ?? "");
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}
