globalThis.process ??= {}; globalThis.process.env ??= {};
import { e as createAstro, f as createComponent, r as renderTemplate, l as renderScript, k as renderComponent, o as renderSlot, p as renderHead, h as addAttribute } from './astro/server_Dtj_OyDT.mjs';
/* empty css                         */
import { u as useSSRContext, d as defineComponent, o as onMounted, b as ref, s as ssrRenderAttrs, m as mergeProps, f as ssrRenderList, c as ssrRenderAttr, e as ssrInterpolate } from './_@astro-renderers_V6C19r4Q.mjs';

const _export_sfc = (sfc, props) => {
  const target = sfc.__vccOpts || sfc;
  for (const [key, val] of props) {
    target[key] = val;
  }
  return target;
};

const _sfc_main = /* @__PURE__ */ defineComponent({
  __name: "FriendLinkList",
  props: {
    variant: {}
  },
  setup(__props, { expose: __expose }) {
    __expose();
    const props = __props;
    const links = ref([]);
    onMounted(async () => {
      try {
        const response = await fetch("/api/v1/friend-links");
        const data = await response.json();
        if (data.code === 0 && data.data) {
          links.value = data.data;
        }
      } catch (e) {
        console.error("Load friend links failed:", e);
      }
    });
    const __returned__ = { props, links };
    Object.defineProperty(__returned__, "__isScriptSetup", { enumerable: false, value: true });
    return __returned__;
  }
});
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(mergeProps({
    class: ["friend-links", $props.variant === "footer" && "footer-variant"]
  }, _attrs))} data-v-7836eafa><h3 class="links-title" data-v-7836eafa>友情链接</h3>`);
  if ($setup.links.length > 0) {
    _push(`<ul class="links-list" data-v-7836eafa><!--[-->`);
    ssrRenderList($setup.links, (link) => {
      _push(`<li class="link-item" data-v-7836eafa><a${ssrRenderAttr("href", link.url)} target="_blank" rel="noopener noreferrer" class="link-url" data-v-7836eafa>${ssrInterpolate(link.name)}</a></li>`);
    });
    _push(`<!--]--></ul>`);
  } else {
    _push(`<p class="no-links" data-v-7836eafa>暂无友情链接</p>`);
  }
  _push(`</div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("src/islands/FriendLinkList.vue");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const FriendLinkList = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender], ["__scopeId", "data-v-7836eafa"]]);

var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(cooked.slice()) }));
var _a;
const $$Astro = createAstro("https://blog.zenfishlog.dpdns.org");
const $$BaseLayout = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$BaseLayout;
  const {
    title,
    description = "",
    keywords = [],
    ogImage,
    canonicalUrl,
    friendLinks = true
  } = Astro2.props;
  const fullCanonicalUrl = canonicalUrl || new URL(Astro2.url.pathname, Astro2.site).href;
  return renderTemplate(_a || (_a = __template(['<html lang="zh-CN" data-astro-cid-o7hvdbfg> <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="generator"', "><title data-site-title>", '</title><meta name="description"', "", ">", '<link rel="canonical"', '><meta property="og:type" content="website"><meta property="og:title"', ">", '<meta property="og:url"', ">", `<link rel="icon" type="image/x-icon" href="/favicon.ico"><script>
      (function() {
        const t = localStorage.getItem('theme');
        if (t) document.documentElement.setAttribute('data-theme', t);
        else if (window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.setAttribute('data-theme', 'dark');
        else document.documentElement.setAttribute('data-theme', 'light');
        const l = localStorage.getItem('locale');
        if (l) document.documentElement.setAttribute('data-locale', l);
        else document.documentElement.setAttribute('data-locale', navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');
      })();
    <\/script>`, '</head> <body data-astro-cid-o7hvdbfg> <header class="site-header" data-astro-cid-o7hvdbfg> <nav class="header-nav container" data-astro-cid-o7hvdbfg> <a href="/" class="site-logo" data-astro-cid-o7hvdbfg> <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-astro-cid-o7hvdbfg><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" data-astro-cid-o7hvdbfg></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" data-astro-cid-o7hvdbfg></path></svg> <span id="site-logo-text" data-astro-cid-o7hvdbfg>Blog</span> </a> <div class="nav-links" data-astro-cid-o7hvdbfg> <a href="/" data-i18n="nav.home" data-astro-cid-o7hvdbfg>\u9996\u9875</a> <a href="/articles" data-i18n="nav.articles" data-astro-cid-o7hvdbfg>\u6587\u7AE0</a> <a href="/archives" data-i18n="nav.archives" data-astro-cid-o7hvdbfg>\u5F52\u6863</a> <a href="/about" data-i18n="nav.about" data-astro-cid-o7hvdbfg>\u5173\u4E8E</a> </div> <div class="nav-actions" data-astro-cid-o7hvdbfg> <a href="/search" class="nav-icon" aria-label="\u641C\u7D22" data-astro-cid-o7hvdbfg> <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-astro-cid-o7hvdbfg><circle cx="11" cy="11" r="8" data-astro-cid-o7hvdbfg></circle><line x1="21" y1="21" x2="16.65" y2="16.65" data-astro-cid-o7hvdbfg></line></svg> </a> <button class="nav-icon" id="locale-toggle-btn" aria-label="\u5207\u6362\u8BED\u8A00" title="\u4E2D\u6587/English" data-astro-cid-o7hvdbfg> <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-astro-cid-o7hvdbfg><circle cx="12" cy="12" r="10" data-astro-cid-o7hvdbfg></circle><line x1="2" y1="12" x2="22" y2="12" data-astro-cid-o7hvdbfg></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" data-astro-cid-o7hvdbfg></path></svg> </button> <button class="nav-icon" id="theme-toggle-btn" aria-label="\u5207\u6362\u4E3B\u9898" data-astro-cid-o7hvdbfg> <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-astro-cid-o7hvdbfg><circle cx="12" cy="12" r="5" data-astro-cid-o7hvdbfg></circle><line x1="12" y1="1" x2="12" y2="3" data-astro-cid-o7hvdbfg></line><line x1="12" y1="21" x2="12" y2="23" data-astro-cid-o7hvdbfg></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" data-astro-cid-o7hvdbfg></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" data-astro-cid-o7hvdbfg></line><line x1="1" y1="12" x2="3" y2="12" data-astro-cid-o7hvdbfg></line><line x1="21" y1="12" x2="23" y2="12" data-astro-cid-o7hvdbfg></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" data-astro-cid-o7hvdbfg></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" data-astro-cid-o7hvdbfg></line></svg> </button> </div> </nav> </header> <main class="page-layout" data-astro-cid-o7hvdbfg> <div class="main-content" data-astro-cid-o7hvdbfg> ', ' </div> </main> <footer class="site-footer" data-astro-cid-o7hvdbfg> ', ' <div class="container footer-inner" data-astro-cid-o7hvdbfg> <p id="footer-text" data-astro-cid-o7hvdbfg>&copy; ', ' Blog</p> <a href="/rss.xml" data-astro-cid-o7hvdbfg>RSS</a> </div> </footer> ', " </body> </html> "])), addAttribute(Astro2.generator, "content"), title, addAttribute(description, "content"), addAttribute(description ? "true" : "", "data-page-set"), keywords.length > 0 && renderTemplate`<meta name="keywords"${addAttribute(keywords.join(","), "content")}>`, addAttribute(fullCanonicalUrl, "href"), addAttribute(title, "content"), description && renderTemplate`<meta property="og:description"${addAttribute(description, "content")}>`, addAttribute(fullCanonicalUrl, "content"), ogImage && renderTemplate`<meta property="og:image"${addAttribute(ogImage, "content")}>`, renderHead(), renderSlot($$result, $$slots["default"]), friendLinks && renderTemplate`<div class="container footer-friend-links" data-astro-cid-o7hvdbfg> ${renderComponent($$result, "FriendLinkList", FriendLinkList, { "client:load": true, "variant": "footer", "client:component-hydration": "load", "client:component-path": "C:/Users/Lenovo/IDEProjects/Website/src/islands/FriendLinkList.vue", "client:component-export": "default", "data-astro-cid-o7hvdbfg": true })} </div>`, (/* @__PURE__ */ new Date()).getFullYear(), renderScript($$result, "C:/Users/Lenovo/IDEProjects/Website/src/components/layout/BaseLayout.astro?astro&type=script&index=0&lang.ts"));
}, "C:/Users/Lenovo/IDEProjects/Website/src/components/layout/BaseLayout.astro", void 0);

export { $$BaseLayout as $, _export_sfc as _ };
