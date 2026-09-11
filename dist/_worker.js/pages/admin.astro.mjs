globalThis.process ??= {}; globalThis.process.env ??= {};
import { f as createComponent, k as renderComponent, l as renderScript, r as renderTemplate, m as maybeRenderHead } from '../chunks/astro/server_Dtj_OyDT.mjs';
import { $ as $$BaseLayout } from '../chunks/BaseLayout_Dstx2w-s.mjs';
export { r as renderers } from '../chunks/_@astro-renderers_V6C19r4Q.mjs';

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u540E\u53F0\u7BA1\u7406", "description": "\u535A\u5BA2\u7BA1\u7406\u540E\u53F0", "friendLinks": false }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div id="admin-app-mount"></div> ` })} ${renderScript($$result, "C:/Users/Lenovo/IDEProjects/Website/src/pages/admin/index.astro?astro&type=script&index=0&lang.ts")}`;
}, "C:/Users/Lenovo/IDEProjects/Website/src/pages/admin/index.astro", void 0);

const $$file = "C:/Users/Lenovo/IDEProjects/Website/src/pages/admin/index.astro";
const $$url = "/admin";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
