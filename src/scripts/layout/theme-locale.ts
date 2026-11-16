/**
 * 主题与语言：解析、应用到 <html>、事件委托、ClientRouter 跨页恢复（issue #103 / L4）。
 *
 * 从 BaseLayout 内联脚本原样抽出。主题初始化仍必须在文档头部的 `is:inline` 脚本里
 * 尽早设置 `data-theme`（避免首屏闪烁），本模块只负责之后的状态同步与交互。
 *
 * 纯函数 `resolveTheme` / `resolveLocale` 的入参可注入，便于单测（不依赖真实
 * localStorage / navigator）。
 */

export type Theme = "light" | "dark";
export type Locale = "zh" | "en";

const THEME_KEY = "theme";
const LOCALE_KEY = "locale";

/** 解析主题：存储值优先，其次系统偏好 */
export function resolveTheme(
  stored: string | null = localStorage.getItem(THEME_KEY),
  prefersDark: boolean = window.matchMedia("(prefers-color-scheme: dark)")
    .matches
): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return prefersDark ? "dark" : "light";
}

/** 解析语言：存储值优先，其次浏览器语言 */
export function resolveLocale(
  stored: string | null = localStorage.getItem(LOCALE_KEY),
  navLang: string = navigator.language
): Locale {
  if (stored === "zh" || stored === "en") return stored;
  return navLang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

const SUN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
const MOON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

/** 主题图标跟随当前主题：亮色显示月亮（点击进入暗色），暗色显示太阳 */
function updateThemeIcon(): void {
  const btn = document.getElementById("theme-toggle-btn");
  if (!btn) return;
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  btn.innerHTML = dark ? SUN_SVG : MOON_SVG;
}

/** 从 localStorage 恢复 html 属性 —— ClientRouter 导航会清空 data-theme / data-locale */
function syncThemeLocale(): void {
  document.documentElement.setAttribute("data-theme", resolveTheme());
  document.documentElement.setAttribute("data-locale", resolveLocale());
  updateThemeIcon();
}

async function setLocaleAndRefresh(locale: string): Promise<void> {
  try {
    const { setLocale, refreshDomTranslations } =
      await import("../../utils/i18n");
    setLocale(locale as Locale);
    refreshDomTranslations();
  } catch {
    /* i18n chunk 加载失败时保持当前语言，不阻塞页面 */
  }
}

/** 已绑定标记：重复调用不重复挂监听（单测与将来多次调用都安全） */
let bound = false;

/** 挂上首屏同步、跨页恢复与主题/语言按钮的事件委托 */
export function initThemeLocale(): void {
  if (bound) return;
  bound = true;

  // 事件委托：绑定在 document 上，页面切换（DOM 替换）后依然有效
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const btn = t.closest
      ? t.closest("#theme-toggle-btn, #locale-toggle-btn")
      : null;
    if (!btn) return;
    if (btn.id === "theme-toggle-btn") {
      const next = resolveTheme() === "dark" ? "light" : "dark";
      localStorage.setItem(THEME_KEY, next);
      document.documentElement.setAttribute("data-theme", next);
      updateThemeIcon();
    } else if (btn.id === "locale-toggle-btn") {
      const next = resolveLocale() === "zh" ? "en" : "zh";
      void setLocaleAndRefresh(next);
    }
  });

  // 首屏：应用存储的主题 / 语言 + 刷新静态翻译
  syncThemeLocale();
  void (async () => {
    try {
      const { initLocale, refreshDomTranslations } =
        await import("../../utils/i18n");
      initLocale();
      refreshDomTranslations();
    } catch {
      /* 同上：首屏翻译失败不影响渲染 */
    }
  })();

  // ClientRouter 导航后：html 属性被新文档同步清空，这里恢复（after-swap 尽早恢复，page-load 兜底）
  document.addEventListener("astro:after-swap", () => syncThemeLocale());
  document.addEventListener("astro:page-load", () => {
    syncThemeLocale();
    void (async () => {
      try {
        const { refreshDomTranslations } = await import("../../utils/i18n");
        refreshDomTranslations();
      } catch {
        /* 导航后翻译刷新失败时保留 SSR 文案 */
      }
    })();
  });
}
