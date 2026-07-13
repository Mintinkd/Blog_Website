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
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": `\u6807\u7B7E: ${slug}`, "description": "", "data-astro-cid-ytpo4vtr": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="tag-page" data-astro-cid-ytpo4vtr> <div class="page-header" data-astro-cid-ytpo4vtr> <h1 class="page-title" data-i18n="page.tag" data-i18n-params="{&quot;name&quot;:&quot;&quot;}" data-astro-cid-ytpo4vtr>标签: ${slug}</h1> <a href="/articles" class="page-back" data-i18n="page.all_articles" data-astro-cid-ytpo4vtr>← 所有文章</a> </div> <div id="article-list"${addAttribute(slug, "data-tag-slug")} data-page="1" data-page-size="10" data-astro-cid-ytpo4vtr> <div class="article-list-inner" data-astro-cid-ytpo4vtr></div> <div id="pagination-mount" data-astro-cid-ytpo4vtr></div> </div> </section> ` })}  ${renderScript($$result, "C:/Users/Lenovo/IDEProjects/Website/src/pages/tags/[slug].astro?astro&type=script&index=0&lang.ts")} `;
}, "C:/Users/Lenovo/IDEProjects/Website/src/pages/tags/[slug].astro", void 0);

const $$file = "C:/Users/Lenovo/IDEProjects/Website/src/pages/tags/[slug].astro";
const $$url = "/tags/[slug]";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$slug,
  file: $$file,
  prerender,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
