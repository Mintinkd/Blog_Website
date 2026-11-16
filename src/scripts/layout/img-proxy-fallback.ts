/**
 * 外链图片自动降级代理：直连失败（防盗链 / 失效）→ 本站 `/api/v1/img-proxy` 兜底
 * （issue #103 / L4）。
 */
export function initImgProxyFallback(): void {
  const PROXY_PREFIX = "/api/v1/img-proxy?url=";
  document.addEventListener(
    "error",
    (e) => {
      const t = e.target as HTMLImageElement | null;
      if (!t || !(t instanceof HTMLImageElement)) return;
      // 用 t.src（绝对 URL）判断：currentSrc 可能在失败时被清空，getAttribute 会读到相对路径
      const src = t.currentSrc || t.src || "";
      if (!src || !/^https?:\/\//i.test(src)) return;
      if (src.includes("/api/v1/img-proxy")) {
        // 代理也失败：隐藏图片占位，避免破图破坏布局
        if (!t.dataset.proxyFailed) {
          t.dataset.proxyFailed = "1";
          t.style.visibility = "hidden";
        }
        return;
      }
      if (t.dataset.proxyDone) return;
      let u: URL;
      try {
        u = new URL(src, location.href);
      } catch {
        return;
      }
      if (u.origin === location.origin) return; // 本站资源无需代理
      t.dataset.proxyDone = "1";
      t.src = PROXY_PREFIX + encodeURIComponent(src);
    },
    true
  );
}
