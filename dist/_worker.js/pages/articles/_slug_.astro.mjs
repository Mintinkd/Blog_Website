globalThis.process ??= {}; globalThis.process.env ??= {};
import { e as createAstro, f as createComponent, k as renderComponent, l as renderScript, r as renderTemplate, m as maybeRenderHead, h as addAttribute } from '../../chunks/astro/server_Dtj_OyDT.mjs';
import { $ as $$BaseLayout } from '../../chunks/BaseLayout_FRegNmSq.mjs';
/* empty css                                     */
export { r as renderers } from '../../chunks/_@astro-renderers_V6C19r4Q.mjs';

const $$Astro = createAstro("https://blog.zenfishlog.dpdns.org");
const prerender = false;
const $$slug = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$slug;
  const { slug } = Astro2.params;
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u6587\u7AE0\u8BE6\u60C5", "description": "", "data-astro-cid-xw3clhsd": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<article class="article-detail" id="article-detail"${addAttribute(slug, "data-slug")} data-astro-cid-xw3clhsd> <div class="article-loading" data-astro-cid-xw3clhsd> <div class="loading-spinner" data-astro-cid-xw3clhsd></div> <p data-i18n="article.loading" data-astro-cid-xw3clhsd>加载文章中...</p> </div> </article> ` })}  ${renderScript($$result, "C:/Users/Lenovo/IDEProjects/Website/src/pages/articles/[slug].astro?astro&type=script&index=0&lang.ts")} `;
}, "C:/Users/Lenovo/IDEProjects/Website/src/pages/articles/[slug].astro", void 0);

const $$file = "C:/Users/Lenovo/IDEProjects/Website/src/pages/articles/[slug].astro";
const $$url = "/articles/[slug]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$slug,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
