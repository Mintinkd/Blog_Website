globalThis.process ??= {}; globalThis.process.env ??= {};
import { r as renderers } from './chunks/_@astro-renderers_V6C19r4Q.mjs';
import { c as createExports, s as serverEntrypointModule } from './chunks/_@astrojs-ssr-adapter_C66LXQ1A.mjs';
import { manifest } from './manifest__6x2_gX4.mjs';

const serverIslandMap = new Map();;

const _page0 = () => import('./pages/_image.astro.mjs');
const _page1 = () => import('./pages/404.astro.mjs');
const _page2 = () => import('./pages/about.astro.mjs');
const _page3 = () => import('./pages/admin.astro.mjs');
const _page4 = () => import('./pages/api/v1/_---path_.astro.mjs');
const _page5 = () => import('./pages/archives.astro.mjs');
const _page6 = () => import('./pages/articles/_slug_.astro.mjs');
const _page7 = () => import('./pages/articles.astro.mjs');
const _page8 = () => import('./pages/categories/_slug_.astro.mjs');
const _page9 = () => import('./pages/categories.astro.mjs');
const _page10 = () => import('./pages/rss.xml.astro.mjs');
const _page11 = () => import('./pages/search.astro.mjs');
const _page12 = () => import('./pages/tags/_slug_.astro.mjs');
const _page13 = () => import('./pages/tags.astro.mjs');
const _page14 = () => import('./pages/index.astro.mjs');
const pageMap = new Map([
    ["node_modules/@astrojs/cloudflare/dist/entrypoints/image-endpoint.js", _page0],
    ["src/pages/404.astro", _page1],
    ["src/pages/about.astro", _page2],
    ["src/pages/admin/index.astro", _page3],
    ["src/pages/api/v1/[...path].ts", _page4],
    ["src/pages/archives.astro", _page5],
    ["src/pages/articles/[slug].astro", _page6],
    ["src/pages/articles/index.astro", _page7],
    ["src/pages/categories/[slug].astro", _page8],
    ["src/pages/categories/index.astro", _page9],
    ["src/pages/rss.xml.ts", _page10],
    ["src/pages/search.astro", _page11],
    ["src/pages/tags/[slug].astro", _page12],
    ["src/pages/tags/index.astro", _page13],
    ["src/pages/index.astro", _page14]
]);

const _manifest = Object.assign(manifest, {
    pageMap,
    serverIslandMap,
    renderers,
    actions: () => import('./noop-entrypoint.mjs'),
    middleware: () => import('./_astro-internal_middleware.mjs')
});
const _args = undefined;
const _exports = createExports(_manifest);
const __astrojsSsrVirtualEntry = _exports.default;
const _start = 'start';
if (Object.prototype.hasOwnProperty.call(serverEntrypointModule, _start)) {
	serverEntrypointModule[_start](_manifest, _args);
}

export { __astrojsSsrVirtualEntry as default, pageMap };
