import rss from '@astrojs/rss';
import type { APIContext } from 'astro';

export const prerender = false;

const WORKER_ORIGIN = 'https://blog_website.zen-13467.workers.dev';

export async function GET(context: APIContext) {
  const siteUrl = context.site?.toString() || 'https://blog-website.pages.dev';
  const res = await fetch(`${WORKER_ORIGIN}/api/v1/articles?page_size=50&status=published`);
  const data = await res.json();
  const articles = data.code === 0 && data.data ? data.data.items : [];

  return rss({
    title: 'Blog',
    description: 'A personal blog',
    site: context.site!,
    items: articles.map((article: any) => ({
      title: article.title,
      pubDate: new Date(article.published_at || article.created_at),
      description: article.summary || '',
      link: `/articles/${article.slug}`,
    })),
    customData: `<language>zh-cn</language>`,
  });
}