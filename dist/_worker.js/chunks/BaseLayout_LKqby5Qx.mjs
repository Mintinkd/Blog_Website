globalThis.process ??= {}; globalThis.process.env ??= {};
import { e as createAstro, f as createComponent, h as addAttribute, l as renderScript, r as renderTemplate, m as maybeRenderHead, k as renderComponent, o as renderSlot, p as renderHead, u as unescapeHTML } from './astro/server_Dtj_OyDT.mjs';
/* empty css                         */
import { u as useSSRContext, d as defineComponent, o as onMounted, b as ref, s as ssrRenderAttrs, m as mergeProps, f as ssrRenderList, c as ssrRenderAttr, e as ssrInterpolate } from './_@astro-renderers_V6C19r4Q.mjs';

const $$Astro$1 = createAstro("https://blog.zenfishlog.dpdns.org");
const $$ClientRouter = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro$1, $$props, $$slots);
  Astro2.self = $$ClientRouter;
  const { fallback = "animate" } = Astro2.props;
  return renderTemplate`<meta name="astro-view-transitions-enabled" content="true"><meta name="astro-view-transitions-fallback"${addAttribute(fallback, "content")}>${renderScript($$result, "C:/Users/Lenovo/IDEProjects/Website/node_modules/astro/components/ClientRouter.astro?astro&type=script&index=0&lang.ts")}`;
}, "C:/Users/Lenovo/IDEProjects/Website/node_modules/astro/components/ClientRouter.astro", void 0);

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

const $$ScrollProgress = createComponent(($$result, $$props, $$slots) => {
  return renderTemplate`${maybeRenderHead()}<div class="scroll-progress" role="progressbar" aria-label="阅读进度" aria-hidden="true"></div>`;
}, "C:/Users/Lenovo/IDEProjects/Website/src/components/common/ScrollProgress.astro", void 0);

function getDefaultSettings() {
  return {
    theme: {
      light: {
        accent: "#6366f1",
        accentHover: "#4f46e5",
        bgPrimary: "#fafafa",
        bgSecondary: "#ffffff",
        bgTertiary: "#f5f5f5",
        textPrimary: "#1d1d1f",
        textSecondary: "#6e6e73",
        textTertiary: "#a1a1a6",
        border: "#e8e8ed",
        borderLight: "#f0f0f5"
      },
      dark: {
        accent: "#818cf8",
        accentHover: "#a5b4fc",
        bgPrimary: "#0a0a0a",
        bgSecondary: "#1c1c1e",
        bgTertiary: "#2c2c2e",
        textPrimary: "#f5f5f7",
        textSecondary: "#a1a1a6",
        textTertiary: "#6e6e73",
        border: "#38383a",
        borderLight: "#15151a"
      }
    },
    layout: {
      contentMaxWidth: "1200px",
      headerHeight: "64px",
      radiusSm: "6px",
      radiusMd: "10px",
      radiusLg: "16px"
    },
    background: {
      bgImage: "/bg-placeholder.svg",
      bgOpacity: 0.55
    },
    features: {
      comments: true,
      likes: true,
      friendLinks: true,
      search: true,
      rss: true,
      darkMode: true,
      i18n: true
    },
    copy: { zh: {}, en: {} },
    motion: {
      intensity: "normal",
      parallax: true,
      parallaxSpeed: 0.04
    }
  };
}
function kebab(k) {
  return k.replace(/([A-Z])/g, (m) => "-" + m.toLowerCase());
}
function hexToRgb(hex) {
  let h = (hex || "").trim().replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt((h + "000000").slice(0, 6), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
function buildOverlay(bg, opacity) {
  const [r, g, b] = hexToRgb(bg);
  const o = Math.max(0, Math.min(1, Number(opacity) || 0));
  const mask = Math.max(0, Math.min(1, (1 - o) * 0.55));
  const a1 = Math.max(0, mask - 0.05);
  const a2 = Math.min(1, mask + 0.05);
  return `linear-gradient(180deg, rgba(${r}, ${g}, ${b}, ${a1}) 0%, rgba(${r}, ${g}, ${b}, ${a2}) 100%)`;
}
function buildCss(s) {
  const L = s.theme.light;
  const D = s.theme.dark;
  const ly = s.layout;
  const bg = s.background;
  const lines = [];
  lines.push(":root {");
  lines.push(`  --content-max-width: ${ly.contentMaxWidth} !important;`);
  lines.push(`  --header-height: ${ly.headerHeight} !important;`);
  lines.push(`  --radius-sm: ${ly.radiusSm} !important;`);
  lines.push(`  --radius-md: ${ly.radiusMd} !important;`);
  lines.push(`  --radius-lg: ${ly.radiusLg} !important;`);
  lines.push(`  --bg-image: url("${bg.bgImage}") !important;`);
  lines.push("}");
  lines.push('[data-theme="light"] {');
  for (const [k, v] of Object.entries(L)) lines.push(`  --color-${kebab(k)}: ${v} !important;`);
  lines.push(`  --bg-overlay: ${buildOverlay(L.bgPrimary, bg.bgOpacity)} !important;`);
  lines.push("}");
  lines.push('[data-theme="dark"] {');
  for (const [k, v] of Object.entries(D)) lines.push(`  --color-${kebab(k)}: ${v} !important;`);
  lines.push(`  --bg-overlay: ${buildOverlay(D.bgPrimary, bg.bgOpacity)} !important;`);
  lines.push("}");
  for (const [k, on] of Object.entries(s.features)) {
    if (!on) {
      lines.push(`html[data-feature-${k}="off"] [data-feature="${k}"] { display: none !important; }`);
    }
  }
  return lines.join("\n");
}

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
  const host = Astro2.url.hostname;
  const isProdOrigin = host && host !== "localhost" && host !== "127.0.0.1" && !host.endsWith(".local");
  let initialSettings = getDefaultSettings();
  if (isProdOrigin) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 800);
      const res = await fetch(`${Astro2.url.origin}/api/v1/settings`, { signal: ctrl.signal });
      clearTimeout(t);
      const data = await res.json();
      if (data?.code === 0 && data.data) initialSettings = data.data;
    } catch {
    }
  }
  const initialCss = buildCss(initialSettings);
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
    <\/script>`, '<style id="dynamic-settings">', "</style>", '</head> <body data-astro-cid-o7hvdbfg> <div class="site-bg" data-parallax-fixed aria-hidden="true" data-astro-cid-o7hvdbfg></div> ', ' <header class="site-header" data-astro-cid-o7hvdbfg> <nav class="header-nav container" data-astro-cid-o7hvdbfg> <a href="/" class="site-logo" data-astro-cid-o7hvdbfg> <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-astro-cid-o7hvdbfg><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" data-astro-cid-o7hvdbfg></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" data-astro-cid-o7hvdbfg></path></svg> <span id="site-logo-text" data-astro-cid-o7hvdbfg>Blog</span> </a> <div class="nav-links" data-astro-cid-o7hvdbfg> <a href="/" data-i18n="nav.home" data-astro-cid-o7hvdbfg>\u9996\u9875</a> <a href="/articles" data-i18n="nav.articles" data-astro-cid-o7hvdbfg>\u6587\u7AE0</a> <a href="/archives" data-i18n="nav.archives" data-astro-cid-o7hvdbfg>\u5F52\u6863</a> <a href="/about" data-i18n="nav.about" data-astro-cid-o7hvdbfg>\u5173\u4E8E</a> </div> <div class="nav-actions" data-astro-cid-o7hvdbfg> <a href="/search" class="nav-icon" aria-label="\u641C\u7D22" data-feature="search" data-astro-cid-o7hvdbfg> <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-astro-cid-o7hvdbfg><circle cx="11" cy="11" r="8" data-astro-cid-o7hvdbfg></circle><line x1="21" y1="21" x2="16.65" y2="16.65" data-astro-cid-o7hvdbfg></line></svg> </a> <button class="nav-icon" id="locale-toggle-btn" aria-label="\u5207\u6362\u8BED\u8A00" title="\u4E2D\u6587/English" data-feature="i18n" data-astro-cid-o7hvdbfg> <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-astro-cid-o7hvdbfg><circle cx="12" cy="12" r="10" data-astro-cid-o7hvdbfg></circle><line x1="2" y1="12" x2="22" y2="12" data-astro-cid-o7hvdbfg></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" data-astro-cid-o7hvdbfg></path></svg> </button> <button class="nav-icon" id="theme-toggle-btn" aria-label="\u5207\u6362\u4E3B\u9898" data-feature="darkMode" data-astro-cid-o7hvdbfg> <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-astro-cid-o7hvdbfg><circle cx="12" cy="12" r="5" data-astro-cid-o7hvdbfg></circle><line x1="12" y1="1" x2="12" y2="3" data-astro-cid-o7hvdbfg></line><line x1="12" y1="21" x2="12" y2="23" data-astro-cid-o7hvdbfg></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" data-astro-cid-o7hvdbfg></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" data-astro-cid-o7hvdbfg></line><line x1="1" y1="12" x2="3" y2="12" data-astro-cid-o7hvdbfg></line><line x1="21" y1="12" x2="23" y2="12" data-astro-cid-o7hvdbfg></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" data-astro-cid-o7hvdbfg></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" data-astro-cid-o7hvdbfg></line></svg> </button> </div> </nav> </header> <main class="page-layout" data-astro-cid-o7hvdbfg> <div class="main-content" data-astro-cid-o7hvdbfg> ', ' </div> </main> <footer class="site-footer" data-astro-cid-o7hvdbfg> ', ' <div class="container footer-inner" data-astro-cid-o7hvdbfg> <p id="footer-text" data-astro-cid-o7hvdbfg>&copy; ', ' Blog</p> <a href="/rss.xml" data-feature="rss" data-astro-cid-o7hvdbfg>RSS</a> </div> </footer> ', " </body> </html> "])), addAttribute(Astro2.generator, "content"), title, addAttribute(description, "content"), addAttribute(description ? "true" : "", "data-page-set"), keywords.length > 0 && renderTemplate`<meta name="keywords"${addAttribute(keywords.join(","), "content")}>`, addAttribute(fullCanonicalUrl, "href"), addAttribute(title, "content"), description && renderTemplate`<meta property="og:description"${addAttribute(description, "content")}>`, addAttribute(fullCanonicalUrl, "content"), ogImage && renderTemplate`<meta property="og:image"${addAttribute(ogImage, "content")}>`, renderComponent($$result, "ClientRouter", $$ClientRouter, { "data-astro-cid-o7hvdbfg": true }), unescapeHTML(initialCss), renderHead(), renderComponent($$result, "ScrollProgress", $$ScrollProgress, { "data-astro-cid-o7hvdbfg": true }), renderSlot($$result, $$slots["default"]), friendLinks && renderTemplate`<div class="container footer-friend-links" data-feature="friendLinks" data-astro-cid-o7hvdbfg> ${renderComponent($$result, "FriendLinkList", FriendLinkList, { "client:load": true, "variant": "footer", "client:component-hydration": "load", "client:component-path": "C:/Users/Lenovo/IDEProjects/Website/src/islands/FriendLinkList.vue", "client:component-export": "default", "data-astro-cid-o7hvdbfg": true })} </div>`, (/* @__PURE__ */ new Date()).getFullYear(), renderScript($$result, "C:/Users/Lenovo/IDEProjects/Website/src/components/layout/BaseLayout.astro?astro&type=script&index=0&lang.ts"));
}, "C:/Users/Lenovo/IDEProjects/Website/src/components/layout/BaseLayout.astro", void 0);

export { $$BaseLayout as $, _export_sfc as _ };
