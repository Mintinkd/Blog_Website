globalThis.process ??= {}; globalThis.process.env ??= {};
import { f as createComponent, k as renderComponent, l as renderScript, r as renderTemplate, m as maybeRenderHead } from '../chunks/astro/server_Dtj_OyDT.mjs';
import { _ as _export_sfc, $ as $$BaseLayout } from '../chunks/BaseLayout_Dstx2w-s.mjs';
import { u as useSSRContext, d as defineComponent, o as onMounted, a as onUnmounted, b as ref, s as ssrRenderAttrs, m as mergeProps, c as ssrRenderAttr, i as includeBooleanAttr, e as ssrInterpolate, f as ssrRenderList } from '../chunks/_@astro-renderers_V6C19r4Q.mjs';
export { r as renderers } from '../chunks/_@astro-renderers_V6C19r4Q.mjs';
/* empty css                                  */

const _sfc_main = /* @__PURE__ */ defineComponent({
  __name: "SearchBox",
  setup(__props, { expose: __expose }) {
    __expose();
    const query = ref("");
    const results = ref([]);
    const total = ref(0);
    const loading = ref(false);
    const searched = ref(false);
    const activeFilter = ref(null);
    async function doSearch() {
      const q = query.value.trim();
      if (!q || q.length > 100) return;
      activeFilter.value = null;
      loading.value = true;
      searched.value = true;
      try {
        const response = await fetch(`/api/v1/search?q=${encodeURIComponent(q)}&page_size=20`);
        const data = await response.json();
        if (data.code === 0 && data.data) {
          results.value = data.data.items || [];
          total.value = data.data.total || 0;
        }
      } catch (e) {
        console.error("Search failed:", e);
      } finally {
        loading.value = false;
      }
    }
    async function filterByTaxonomy(type, slug, name) {
      if (!slug) return;
      activeFilter.value = { type, slug, name };
      query.value = "";
      loading.value = true;
      searched.value = true;
      results.value = [];
      try {
        const param = type === "tag" ? `tag_slug=${encodeURIComponent(slug)}` : `category_slug=${encodeURIComponent(slug)}`;
        const response = await fetch(`/api/v1/articles?page=1&page_size=20&status=published&${param}`);
        const data = await response.json();
        if (data.code === 0 && data.data) {
          results.value = data.data.items || [];
          total.value = data.data.total || 0;
        }
      } catch (e) {
        console.error("Filter failed:", e);
      } finally {
        loading.value = false;
      }
    }
    function clearFilter() {
      activeFilter.value = null;
      results.value = [];
      total.value = 0;
      searched.value = false;
    }
    function handleTaxonomyFilter(e) {
      const detail = e.detail;
      if (!detail) return;
      filterByTaxonomy(detail.type, detail.slug, detail.name);
    }
    onMounted(() => {
      window.addEventListener("taxonomy-filter", handleTaxonomyFilter);
    });
    onUnmounted(() => {
      window.removeEventListener("taxonomy-filter", handleTaxonomyFilter);
    });
    function formatDate(dateStr) {
      if (!dateStr) return "";
      return new Date(dateStr).toLocaleDateString("zh-CN");
    }
    const __returned__ = { query, results, total, loading, searched, activeFilter, doSearch, filterByTaxonomy, clearFilter, handleTaxonomyFilter, formatDate };
    Object.defineProperty(__returned__, "__isScriptSetup", { enumerable: false, value: true });
    return __returned__;
  }
});
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(mergeProps({ class: "search-box" }, _attrs))} data-v-4d06a86a><div class="search-input-wrapper" data-v-4d06a86a><input${ssrRenderAttr("value", $setup.query)} type="text" placeholder="搜索文章..." class="search-input" data-v-4d06a86a><button class="search-btn"${includeBooleanAttr($setup.loading) ? " disabled" : ""} data-v-4d06a86a><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" data-v-4d06a86a><circle cx="11" cy="11" r="8" data-v-4d06a86a></circle><line x1="21" y1="21" x2="16.65" y2="16.65" data-v-4d06a86a></line></svg></button></div>`);
  if ($setup.activeFilter) {
    _push(`<div class="active-filter" data-v-4d06a86a><span class="active-filter-label" data-v-4d06a86a>${ssrInterpolate($setup.activeFilter.type === "tag" ? "标签" : "分类")}：<strong data-v-4d06a86a>${ssrInterpolate($setup.activeFilter.name)}</strong></span><button class="active-filter-clear" aria-label="清除筛选" data-v-4d06a86a>×</button></div>`);
  } else {
    _push(`<!---->`);
  }
  if ($setup.results.length > 0) {
    _push(`<div class="search-results" data-v-4d06a86a><p class="results-info" data-v-4d06a86a>`);
    if ($setup.activeFilter) {
      _push(`<!--[-->共 ${ssrInterpolate($setup.total)} 篇文章<!--]-->`);
    } else {
      _push(`<!--[-->找到 ${ssrInterpolate($setup.total)} 篇相关文章<!--]-->`);
    }
    _push(`</p><div${ssrRenderAttrs({
      name: "result",
      class: "search-results-list"
    })} data-v-4d06a86a>`);
    ssrRenderList($setup.results, (item) => {
      _push(`<div class="search-result-item" data-v-4d06a86a><h3 class="result-title" data-v-4d06a86a><a${ssrRenderAttr("href", `/articles/${item.slug}`)} data-v-4d06a86a>${(item.title_highlight || item.title) ?? ""}</a></h3><p class="result-excerpt" data-v-4d06a86a>${(item.content_highlight || item.summary) ?? ""}</p><span class="result-date" data-v-4d06a86a>${ssrInterpolate($setup.formatDate(item.published_at || item.created_at))}</span></div>`);
    });
    _push(`</div></div>`);
  } else if ($setup.searched && !$setup.loading) {
    _push(`<div class="no-results" data-v-4d06a86a>`);
    if ($setup.activeFilter) {
      _push(`<p data-v-4d06a86a>该${ssrInterpolate($setup.activeFilter.type === "tag" ? "标签" : "分类")}下暂无文章</p>`);
    } else {
      _push(`<p data-v-4d06a86a>未找到相关文章，试试其他关键词？</p>`);
    }
    _push(`</div>`);
  } else {
    _push(`<!---->`);
  }
  if ($setup.loading) {
    _push(`<div class="search-loading" data-v-4d06a86a><p data-v-4d06a86a>搜索中...</p></div>`);
  } else {
    _push(`<!---->`);
  }
  _push(`</div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("src/islands/SearchBox.vue");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const SearchBox = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender], ["__scopeId", "data-v-4d06a86a"]]);

const $$Search = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "BaseLayout", $$BaseLayout, { "title": "\u641C\u7D22", "description": "\u641C\u7D22\u6587\u7AE0", "data-astro-cid-ipsxrsrh": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<section class="search-page" data-astro-cid-ipsxrsrh> <div class="page-header" data-astro-cid-ipsxrsrh> <h1 class="page-title" data-i18n="page.search" data-astro-cid-ipsxrsrh>搜索</h1> <p class="page-desc" data-i18n="page.search_desc" data-astro-cid-ipsxrsrh>搜索你感兴趣的内容</p> </div> <div class="search-container" data-astro-cid-ipsxrsrh> ${renderComponent($$result2, "SearchBox", SearchBox, { "client:load": true, "client:component-hydration": "load", "client:component-path": "C:/Users/Lenovo/IDEProjects/Website/src/islands/SearchBox.vue", "client:component-export": "default", "data-astro-cid-ipsxrsrh": true })} </div> <div class="taxonomy" data-astro-cid-ipsxrsrh> <div class="taxonomy-block" data-astro-cid-ipsxrsrh> <h2 class="taxonomy-title" data-i18n="page.tags" data-astro-cid-ipsxrsrh>标签</h2> <div id="search-tags" class="taxonomy-cloud" data-astro-cid-ipsxrsrh> <div class="taxonomy-loading" data-i18n="common.loading" data-astro-cid-ipsxrsrh>加载中...</div> </div> </div> <div class="taxonomy-block" data-astro-cid-ipsxrsrh> <h2 class="taxonomy-title" data-i18n="page.categories" data-astro-cid-ipsxrsrh>分类</h2> <div id="search-categories" class="taxonomy-cloud" data-astro-cid-ipsxrsrh> <div class="taxonomy-loading" data-i18n="common.loading" data-astro-cid-ipsxrsrh>加载中...</div> </div> </div> </div> </section> ` })}  ${renderScript($$result, "C:/Users/Lenovo/IDEProjects/Website/src/pages/search.astro?astro&type=script&index=0&lang.ts")}`;
}, "C:/Users/Lenovo/IDEProjects/Website/src/pages/search.astro", void 0);

const $$file = "C:/Users/Lenovo/IDEProjects/Website/src/pages/search.astro";
const $$url = "/search";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Search,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
