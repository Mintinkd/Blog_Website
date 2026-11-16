/**
 * 回到顶部按钮：ClientRouter 导航后按钮是新 DOM 元素（issue #103 / L4）。
 *
 * scroll 监听只在 window 挂一次，回调内实时查找按钮；点击走 document 事件委托，
 * 跨页始终有效。
 */
export function initBackToTop(): void {
  // 幂等：ClientRouter 的 astro:page-load 会反复触发初始化，
  // 监听器只能挂一次（否则每次导航多一层 scroll 回调）。
  const w = window as typeof window & { __backToTopBound?: boolean };
  if (w.__backToTopBound) return;
  w.__backToTopBound = true;
  const toggleBackToTop = () => {
    const btn = document.getElementById("back-to-top");
    if (btn) btn.classList.toggle("show", window.scrollY > 600);
  };
  toggleBackToTop();
  window.addEventListener("scroll", toggleBackToTop, { passive: true });
  document.addEventListener("astro:page-load", toggleBackToTop);
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest && t.closest("#back-to-top")) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
}
