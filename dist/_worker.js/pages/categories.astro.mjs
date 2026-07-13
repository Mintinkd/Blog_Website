globalThis.process ??= {}; globalThis.process.env ??= {};
import { f as createComponent, k as renderComponent, l as renderScript, r as renderTemplate, m as maybeRenderHead } from '../chunks/astro/server_Dtj_OyDT.mjs';
import { $ as $$BaseLayout } from '../chunks/BaseLayout_FRegNmSq.mjs';
/* empty css                                 */
export { r as renderers } from '../chunks/_@astro-renderers_V6C19r4Q.mjs';

const prerender = false;
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u5206\u7C7B", "description": "", "data-astro-cid-dzaffv5d": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="categories-page" data-astro-cid-dzaffv5d> <div class="page-header" data-astro-cid-dzaffv5d> <h1 class="page-title" data-i18n="page.categories" data-astro-cid-dzaffv5d>分类</h1> </div> <p class="page-desc" data-i18n="page.categories_desc" data-astro-cid-dzaffv5d>按分类浏览所有文章</p> <div id="categories-cloud" class="categories-cloud" data-astro-cid-dzaffv5d> <div class="categories-loading" data-i18n="common.loading" data-astro-cid-dzaffv5d>加载中...</div> </div> </section> ` })}  ${renderScript($$result, "C:/Users/Lenovo/IDEProjects/Website/src/pages/categories/index.astro?astro&type=script&index=0&lang.ts")}`;
}, "C:/Users/Lenovo/IDEProjects/Website/src/pages/categories/index.astro", void 0);

const $$file = "C:/Users/Lenovo/IDEProjects/Website/src/pages/categories/index.astro";
const $$url = "/categories";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
