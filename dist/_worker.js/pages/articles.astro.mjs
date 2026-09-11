globalThis.process ??= {}; globalThis.process.env ??= {};
import { f as createComponent, k as renderComponent, l as renderScript, r as renderTemplate, m as maybeRenderHead } from '../chunks/astro/server_Dtj_OyDT.mjs';
import { $ as $$BaseLayout } from '../chunks/BaseLayout_Dstx2w-s.mjs';
/* empty css                                 */
export { r as renderers } from '../chunks/_@astro-renderers_V6C19r4Q.mjs';

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u6587\u7AE0\u5217\u8868", "description": "\u6240\u6709\u6587\u7AE0\u5217\u8868", "data-astro-cid-h5q2y2v6": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="articles-page" data-astro-cid-h5q2y2v6> <div class="page-header" data-astro-cid-h5q2y2v6> <h1 class="page-title" data-i18n="page.articles" data-astro-cid-h5q2y2v6>所有文章</h1> <p class="page-desc" data-i18n="page.articles_desc" data-astro-cid-h5q2y2v6>记录技术与生活的点滴</p> </div> <div id="article-list" data-page="1" data-page-size="10" data-astro-cid-h5q2y2v6> <div class="article-list-inner" data-astro-cid-h5q2y2v6></div> <div id="pagination-mount" data-astro-cid-h5q2y2v6></div> </div> </section> ` })}  ${renderScript($$result, "C:/Users/Lenovo/IDEProjects/Website/src/pages/articles/index.astro?astro&type=script&index=0&lang.ts")} `;
}, "C:/Users/Lenovo/IDEProjects/Website/src/pages/articles/index.astro", void 0);

const $$file = "C:/Users/Lenovo/IDEProjects/Website/src/pages/articles/index.astro";
const $$url = "/articles";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
