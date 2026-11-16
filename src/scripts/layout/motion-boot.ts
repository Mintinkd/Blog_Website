/**
 * 动效初始化（reveal / 磁吸 / 进度条 / 视差），ClientRouter 跨页后重挂（issue #103 / L4）。
 *
 * initMotion 无清理回调（返回 void）；motion chunk 失败或挂起时 `<noscript>` 不生效，
 * `[data-reveal]` 会永远停在 opacity:0，故用 3s 兜底标记让 CSS 直接显示首屏。
 */
export async function initMotionBoot(): Promise<void> {
  const root = document.documentElement;
  // motion chunk 失败或挂起时，<noscript> 不生效（JS 仍开着），
  // [data-reveal] 会永远停在 opacity:0。兜底标记让 CSS 直接显示首屏。
  const MOTION_FALLBACK_TIMEOUT_MS = 3000;
  const markMotionFailed = () => root.setAttribute("data-motion-failed", "");
  const motionFallback = window.setTimeout(
    markMotionFailed,
    MOTION_FALLBACK_TIMEOUT_MS
  );
  try {
    const { initMotion } = await import("../../utils/motion");
    window.clearTimeout(motionFallback);
    const startMotion = () => {
      initMotion();
    };
    startMotion();
    document.addEventListener("astro:page-load", startMotion);
  } catch {
    window.clearTimeout(motionFallback);
    markMotionFailed();
  }
}
