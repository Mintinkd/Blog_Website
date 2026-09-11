globalThis.process ??= {}; globalThis.process.env ??= {};
import { f as createComponent, k as renderComponent, l as renderScript, r as renderTemplate, m as maybeRenderHead } from '../chunks/astro/server_Dtj_OyDT.mjs';
import { $ as $$BaseLayout } from '../chunks/BaseLayout_Dstx2w-s.mjs';
/* empty css                                    */
export { r as renderers } from '../chunks/_@astro-renderers_V6C19r4Q.mjs';

const $$Archives = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u5F52\u6863", "description": "\u6309\u65F6\u95F4\u5F52\u6863\u7684\u6240\u6709\u6587\u7AE0", "data-astro-cid-rwvr7nxs": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="archives-page" data-astro-cid-rwvr7nxs> <div class="page-header" data-astro-cid-rwvr7nxs> <h1 class="page-title" data-i18n="page.archives" data-astro-cid-rwvr7nxs>归档</h1> <p class="page-desc" data-i18n="page.archives_desc" data-astro-cid-rwvr7nxs>按时间线浏览所有文章</p> </div> <div id="archives-list" data-astro-cid-rwvr7nxs> <div class="loading-placeholder" data-astro-cid-rwvr7nxs> <div class="loading-spinner" data-astro-cid-rwvr7nxs></div> <p data-i18n="common.loading" data-astro-cid-rwvr7nxs>加载归档中...</p> </div> </div> </section> ` })}  ${renderScript($$result, "C:/Users/Lenovo/IDEProjects/Website/src/pages/archives.astro?astro&type=script&index=0&lang.ts")} `;
}, "C:/Users/Lenovo/IDEProjects/Website/src/pages/archives.astro", void 0);

const $$file = "C:/Users/Lenovo/IDEProjects/Website/src/pages/archives.astro";
const $$url = "/archives";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Archives,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
