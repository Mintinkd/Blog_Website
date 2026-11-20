/**
 * 分类 / 标签页共用 helper（#112 item 12：收敛重复实现）。
 *
 * `ssrLocaleIsZh`：SSR 首屏默认中文判定（issue #97）。
 * `bindPagination`：分页按钮绑定，接受页面特有的 loadArticles 回调。
 *
 * 之前在 `categories/[slug].astro` 与 `tags/[slug].astro` 各有一份逐字重复，
 * 与 `theme-locale.ts` 的 `resolveLocale` 单源主张相悖；现收敛到此模块。
 */

/** issue #97：SSR 首屏默认中文；非中文用户必须主动刷新一次套用正确文案。 */
export function ssrLocaleIsZh(): boolean {
  const stored = localStorage.getItem("locale");
  return stored
    ? stored === "zh"
    : navigator.language.toLowerCase().startsWith("zh");
}

/**
 * issue #97：分页绑定独立成函数——SSR 首屏也带 .pag-btn，跳过首次 fetch 时仍需绑定。
 * @param loadArticles 页面特有的文章加载函数（分类页 / 标签页各不同）
 */
export function bindPagination(loadArticles: (page?: number) => void): void {
  const paginationMount = document.getElementById("pagination-mount");
  if (!paginationMount) return;
  paginationMount.querySelectorAll(".pag-btn").forEach((btn) => {
    if ((btn as HTMLElement).dataset.bound === "1") return;
    (btn as HTMLElement).dataset.bound = "1";
    btn.addEventListener("click", () => {
      const p = parseInt((btn as HTMLElement).dataset.page || "1", 10);
      loadArticles(p);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
}
