globalThis.process ??= {}; globalThis.process.env ??= {};
import { f as createComponent, k as renderComponent, l as renderScript, r as renderTemplate, m as maybeRenderHead } from '../chunks/astro/server_Dtj_OyDT.mjs';
import { $ as $$BaseLayout } from '../chunks/BaseLayout_Dstx2w-s.mjs';
/* empty css                                 */
export { r as renderers } from '../chunks/_@astro-renderers_V6C19r4Q.mjs';

const $$About = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u5173\u4E8E", "description": "\u5173\u4E8E\u535A\u4E3B", "data-astro-cid-kh7btl4r": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="about-page" data-astro-cid-kh7btl4r> <div class="page-header" data-astro-cid-kh7btl4r> <h1 class="page-title" data-i18n="page.about" data-astro-cid-kh7btl4r>关于</h1> <p class="page-desc" data-i18n="page.about_desc" data-astro-cid-kh7btl4r>了解这个博客和它的作者</p> </div> <div id="about-content" data-astro-cid-kh7btl4r> <div class="loading-placeholder" data-astro-cid-kh7btl4r> <div class="loading-spinner" data-astro-cid-kh7btl4r></div> <p data-i18n="common.loading" data-astro-cid-kh7btl4r>加载中...</p> </div> </div> </section> ` })}  ${renderScript($$result, "C:/Users/Lenovo/IDEProjects/Website/src/pages/about.astro?astro&type=script&index=0&lang.ts")} `;
}, "C:/Users/Lenovo/IDEProjects/Website/src/pages/about.astro", void 0);

const $$file = "C:/Users/Lenovo/IDEProjects/Website/src/pages/about.astro";
const $$url = "/about";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$About,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
