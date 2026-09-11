globalThis.process ??= {}; globalThis.process.env ??= {};
import { f as createComponent, k as renderComponent, r as renderTemplate, m as maybeRenderHead } from '../chunks/astro/server_Dtj_OyDT.mjs';
import { $ as $$BaseLayout } from '../chunks/BaseLayout_Dstx2w-s.mjs';
/* empty css                               */
export { r as renderers } from '../chunks/_@astro-renderers_V6C19r4Q.mjs';

const $$404 = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "404 - \u9875\u9762\u672A\u627E\u5230", "description": "\u9875\u9762\u672A\u627E\u5230", "data-astro-cid-zetdm5md": true }, { "default": ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="not-found-page" data-astro-cid-zetdm5md> <div class="not-found-inner" data-astro-cid-zetdm5md> <span class="error-code" data-astro-cid-zetdm5md>404</span> <h1 class="error-title" data-i18n="page.not_found" data-astro-cid-zetdm5md>页面未找到</h1> <p class="error-message" data-i18n="page.not_found_desc" data-astro-cid-zetdm5md>抱歉，您访问的页面不存在或已被移除</p> <a href="/" class="back-home" data-i18n="article.back_home" data-astro-cid-zetdm5md>返回首页</a> </div> </section> ` })} `;
}, "C:/Users/Lenovo/IDEProjects/Website/src/pages/404.astro", void 0);

const $$file = "C:/Users/Lenovo/IDEProjects/Website/src/pages/404.astro";
const $$url = "/404";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$404,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
