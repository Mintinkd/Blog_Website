globalThis.process ??= {}; globalThis.process.env ??= {};
import { f as createComponent, k as renderComponent, l as renderScript, r as renderTemplate, m as maybeRenderHead } from '../chunks/astro/server_Dtj_OyDT.mjs';
import { $ as $$BaseLayout } from '../chunks/BaseLayout_FRegNmSq.mjs';
/* empty css                                 */
export { r as renderers } from '../chunks/_@astro-renderers_V6C19r4Q.mjs';

const prerender = false;
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u6807\u7B7E", "description": "", "data-astro-cid-os4i7owy": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="tags-page" data-astro-cid-os4i7owy> <div class="page-header" data-astro-cid-os4i7owy> <h1 class="page-title" data-i18n="page.tags" data-astro-cid-os4i7owy>标签</h1> </div> <p class="page-desc" data-i18n="page.tags_desc" data-astro-cid-os4i7owy>按标签浏览所有文章</p> <div id="tags-cloud" class="tags-cloud" data-astro-cid-os4i7owy> <div class="tags-loading" data-i18n="common.loading" data-astro-cid-os4i7owy>加载中...</div> </div> </section> ` })}  ${renderScript($$result, "C:/Users/Lenovo/IDEProjects/Website/src/pages/tags/index.astro?astro&type=script&index=0&lang.ts")}`;
}, "C:/Users/Lenovo/IDEProjects/Website/src/pages/tags/index.astro", void 0);

const $$file = "C:/Users/Lenovo/IDEProjects/Website/src/pages/tags/index.astro";
const $$url = "/tags";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
