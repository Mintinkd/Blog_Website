import type { APIRoute } from "astro";

/**
 * robots.txt 由构建期站点 origin 生成（不再手写 public/robots.txt）。
 *
 * 站点域名可通过 SITE_URL / PUBLIC_SITE_URL 切换，sitemap 的绝对地址必须跟着
 * 变；写死在 public/ 下的静态文件无法随环境切换，故改为 Astro 端点。
 */
export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const sitemapUrl = site
    ? new URL("sitemap-index.xml", site).href
    : "/sitemap-index.xml";
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin/",
    "Disallow: /api/",
    "",
    `Sitemap: ${sitemapUrl}`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
