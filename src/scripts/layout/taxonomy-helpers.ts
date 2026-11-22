/**
 * 分类 / 标签页共用 helper（#112 item 12：收敛重复实现）。
 *
 * `ssrLocaleIsZh`：SSR 首屏默认中文判定（issue #97）。
 * `bindPagination`：分页按钮绑定，接受页面特有的 loadArticles 回调。
 * `currentArticleList`：当前文档的文章列表根节点（ClientRouter 下不得缓存）。
 * `setTaxonomyHeading`：回填真实名称并摘掉 i18n 标记，避免被 slug 覆盖。
 *
 * 之前在 `categories/[slug].astro` 与 `tags/[slug].astro` 各有一份逐字重复，
 * 与 `theme-locale.ts` 的 `resolveLocale` 单源主张相悖；现收敛到此模块。
 */

/**
 * 当前文档的 `#article-list`（分类 / 标签详情页共用根节点）。
 *
 * ClientRouter 客户端导航时页面脚本只执行一次，模块作用域缓存的节点会一直指向
 * 第一次进入的页面。之后切到别的分类 / 标签页，面包屑、筛选 chip 与标题回填的
 * 都是旧页面的数据（例如「新闻」分类页显示「转载」的分类信息）。因此每次用时
 * 重新取，调用方不得把它存进模块作用域。
 */
export function currentArticleList(): HTMLElement | null {
  return document.getElementById("article-list");
}

/**
 * 分类 / 标签页 H1 回填真实名称。
 *
 * 名称是数据不是文案：同时摘掉 `data-i18n` / `data-i18n-params`，否则后续
 * `refreshDomTranslations()`（settings 初始化、语言切换）会拿 URL 里的 slug
 * 把标题覆盖回「分类: news」。
 */
export function setTaxonomyHeading(el: Element | null, name: string): void {
  if (!el) return;
  el.textContent = name;
  el.removeAttribute("data-i18n");
  el.removeAttribute("data-i18n-params");
}

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
