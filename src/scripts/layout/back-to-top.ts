/**
 * 回到顶部按钮：ClientRouter 导航后按钮是新 DOM 元素（issue #103 / L4）。
 *
 * scroll 监听只在 window 挂一次，回调内实时查找按钮；点击走 document 事件委托，
 * 跨页始终有效。
 */
export function initBackToTop(): void {
  (window as any).__backToTopBound = true;
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
