/**
 * 标签灯泡：用户在页面（可见且聚焦）→ 亮灯；切走 / 失焦 → 熄灯（issue #103 / L4）。
 */
export function initFaviconLight(): void {
  const LIGHT = "/favicon.svg";
  const DARK = "/favicon-off.svg";
  function setFavicon(href: string) {
    document
      .querySelectorAll('link[rel="icon"][type="image/svg+xml"]')
      .forEach((l) => {
        (l as HTMLLinkElement).href = href;
      });
  }
  function updateFavicon() {
    const on = document.visibilityState === "visible" && document.hasFocus();
    setFavicon(on ? LIGHT : DARK);
  }
  document.addEventListener("visibilitychange", updateFavicon);
  window.addEventListener("focus", updateFavicon);
  window.addEventListener("blur", updateFavicon);
  document.addEventListener("astro:after-swap", updateFavicon);
  document.addEventListener("astro:page-load", updateFavicon);
  updateFavicon();
}
