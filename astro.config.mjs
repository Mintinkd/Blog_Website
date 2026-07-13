import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

// 构建时从线上 Worker API 拉取「已发布」文章的 slug，显式补进 sitemap。
// 文章详情页是 SSR 动态路由（prerender=false），Astro 静态构建无法自动发现，
// 所以必须在这里提供完整 URL，否则文章页不会出现在 sitemap 中（SEO 缺口）。
async function getPublishedArticleUrls() {
  const urls = [];
  // 用真实站点域名（同源）拉取，避免 workers.dev 在国内被屏蔽导致构建时拉不到；
  // 也可用环境变量 SITEMAP_API_BASE 覆盖（如切换部署环境时）。
  const apiBase = process.env.SITEMAP_API_BASE || 'https://blog.zenfishlog.dpdns.org/api/v1/articles';
  try {
    let page = 1;
    while (true) {
      const res = await fetch(`${apiBase}?page=${page}&status=published&page_size=50`);
      if (!res.ok) break;
      const data = await res.json();
      const items = data?.data?.items || [];
      for (const a of items) {
        // slug 可能含中文，必须编码进 URL（sitemap 协议要求合法 URL）
        if (a?.slug) urls.push(`https://blog.zenfishlog.dpdns.org/articles/${encodeURIComponent(a.slug)}`);
      }
      const totalPages = data?.data?.total_pages || 1;
      if (page >= totalPages || items.length === 0) break;
      page++;
    }
  } catch (e) {
    console.warn('[sitemap] 拉取文章列表失败，sitemap 将仅包含静态页：', e);
  }
  return urls;
}

const articleUrls = await getPublishedArticleUrls();

export default defineConfig({
  site: 'https://blog.zenfishlog.dpdns.org',
  output: 'static',
  adapter: cloudflare(),
  integrations: [
    vue(),
    sitemap({
      // 后台管理页需登录、对搜索引擎无意义，从 sitemap 剔除
      filter: (page) => !page.includes('/admin/'),
      customPages: articleUrls,
    }),
  ],
  build: {
    assets: '_assets',
  },
  vite: {
    ssr: {
      noExternal: ['element-plus'],
    },
  },
});
