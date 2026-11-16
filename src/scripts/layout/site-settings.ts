/**
 * 后台可视化配置（配色 / 布局 / 背景 / 功能开关 / 文案覆盖）的客户端套用
 * （issue #103 / L4）。
 *
 * 动态 import：settings 计算较重，不阻塞首屏；失败时保持 SSR 内联的默认值。
 */
export async function initSiteSettings(): Promise<void> {
  try {
    const { initSettings } = await import("../../utils/settings");
    initSettings();
  } catch {
    /* 配置 chunk 加载失败时静默回退 SSR 默认值 */
  }
}
