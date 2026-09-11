globalThis.process ??= {}; globalThis.process.env ??= {};
import { f as createComponent, k as renderComponent, l as renderScript, r as renderTemplate, m as maybeRenderHead } from '../chunks/astro/server_Dtj_OyDT.mjs';
import { $ as $$BaseLayout } from '../chunks/BaseLayout_Dstx2w-s.mjs';
/* empty css                                 */
export { r as renderers } from '../chunks/_@astro-renderers_V6C19r4Q.mjs';

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u9996\u9875", "data-astro-cid-j7pv25f6": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="hero" data-astro-cid-j7pv25f6> <div class="hero-inner" data-reveal-stagger data-astro-cid-j7pv25f6> <h1 class="hero-title" id="hero-site-title" data-i18n="hero.title" data-reveal="fade-up" data-astro-cid-j7pv25f6>探索 · 记录 · 分享</h1> <p class="hero-subtitle" id="hero-site-subtitle" data-i18n="hero.subtitle" data-reveal="fade-up" data-astro-cid-j7pv25f6>关于技术、生活与思考的个人空间</p> <p class="hero-desc" id="hero-site-desc" data-reveal="fade-up" data-astro-cid-j7pv25f6></p> <div class="hero-actions" data-astro-cid-j7pv25f6> <a href="/articles" class="hero-btn primary" data-i18n="hero.browse" data-hover="magnetic" data-astro-cid-j7pv25f6>浏览文章</a> <a href="/about" class="hero-btn secondary" data-i18n="hero.learn_more" data-hover="magnetic" data-astro-cid-j7pv25f6>了解更多</a> </div> </div> <div class="hero-blade" data-parallax="0.08" aria-hidden="true" data-astro-cid-j7pv25f6></div> </section> <section class="article-section" data-astro-cid-j7pv25f6> <div class="section-header" data-astro-cid-j7pv25f6> <h2 class="section-title" data-i18n="section.latest_articles" data-astro-cid-j7pv25f6>最新文章</h2> <a href="/articles" class="section-link" data-i18n="section.view_all" data-astro-cid-j7pv25f6>查看全部 →</a> </div> <div id="article-list" data-page="1" data-page-size="6" data-astro-cid-j7pv25f6> <div class="article-grid" id="article-grid" data-astro-cid-j7pv25f6></div> </div> </section> ` })}  ${renderScript($$result, "C:/Users/Lenovo/IDEProjects/Website/src/pages/index.astro?astro&type=script&index=0&lang.ts")} `;
}, "C:/Users/Lenovo/IDEProjects/Website/src/pages/index.astro", void 0);

const $$file = "C:/Users/Lenovo/IDEProjects/Website/src/pages/index.astro";
const $$url = "";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
