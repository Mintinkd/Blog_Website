/**
 * 站点配置（站点名 / 副标题 / 描述）：整个 ClientRouter 会话只 fetch 一次并缓存，
 * 每次 astro:page-load 把缓存重新应用到新 DOM（issue #103 / L4）。
 *
 * 导航后 header / footer / hero 会被替换为 SSR 默认文案（"Blog"），
 * 不重应用就会出现 logo / 页脚 / hero 文案丢失。
 */
export function initSiteConfig(): void {
  // 替换为 SSR 默认文案（"Blog"），不重应用就会出现 logo/页脚/hero 文案丢失
  let cachedSiteConfig: any = null;
  async function applySiteConfig() {
    try {
      if (!cachedSiteConfig) {
        const res = await fetch("/api/v1/config");
        const data = await res.json();
        if (data.code !== 0 || !data.data) return;
        cachedSiteConfig = data.data;
      }
      const cfg = cachedSiteConfig;

      const logoText = document.getElementById("site-logo-text");
      if (logoText && cfg.site_title) logoText.textContent = cfg.site_title;

      const footerText = document.getElementById("footer-text");
      if (footerText && cfg.site_title)
        footerText.textContent = `\u00A9 ${new Date().getFullYear()} ${cfg.site_title}`;

      const titleEl = document.querySelector("title[data-site-title]");
      if (titleEl) {
        const current = titleEl.textContent || "";
        // 仅首页 SSR 标题需要替换为站点名；其他页面（含文章页动态设置的 "xxx | Blog"）保持现状
        if (current === "首页" && cfg.site_title) {
          titleEl.textContent = cfg.site_title;
        }
      }

      // 守卫用"内容是否为空"而非 data-page-set：与文章页 loadArticle 填充摘要存在竞态，
      // 谁后完成都不会覆盖对方已写入的有效内容
      const metaDesc = document.querySelector('meta[name="description"]');
      if (
        metaDesc &&
        !metaDesc.getAttribute("content") &&
        cfg.site_description
      ) {
        metaDesc.setAttribute("content", cfg.site_description);
      }

      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc && !ogDesc.getAttribute("content") && cfg.site_description) {
        ogDesc.setAttribute("content", cfg.site_description);
      }

      const heroTitle = document.getElementById("hero-site-title");
      if (heroTitle && cfg.site_title) heroTitle.textContent = cfg.site_title;

      const heroSubtitle = document.getElementById("hero-site-subtitle");
      if (heroSubtitle && cfg.site_subtitle)
        heroSubtitle.textContent = cfg.site_subtitle;

      const heroDesc = document.getElementById("hero-site-desc");
      if (heroDesc && cfg.site_description)
        heroDesc.textContent = cfg.site_description;
    } catch {}
  }
  document.addEventListener("astro:page-load", () => applySiteConfig());
}
