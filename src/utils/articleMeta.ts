import type { ArticleDetail, ArticleLoadResult } from "./articleServer";
import { renderMarkdownPlainText } from "./markdownServer";

/**
 * 文章详情页的 head 元信息。
 *
 * 纯函数：给定文章与站点根 URL，产出 BaseLayout 需要的 title / description /
 * canonical / OG 字段。服务端首屏直接输出，抓取器无需执行 JS 即可拿到每篇
 * 文章自己的分享卡片；不生成 JSON-LD。
 */

/** SSR 兜底站名：与 BaseLayout / RSS 的默认站名一致；配置化站名由页面先读 `/api/v1/config`。 */
const DEFAULT_SITE_TITLE = "Blog";

/** description 回退到正文时的最大字符数（按 Unicode 码点计）。 */
const DESCRIPTION_FALLBACK_LENGTH = 160;

export interface ArticleMetaOptions {
  /** 站点绝对根 URL（`Astro.site`），用于 canonical 与封面绝对化。 */
  siteUrl: string | URL;
  /** 覆盖站点标题（默认 `Blog`）。 */
  siteTitle?: string;
}

export interface ArticleMeta {
  title: string;
  description: string;
  /** 绝对 canonical；错误页省略，由 BaseLayout 回退到当前请求 URL。 */
  canonicalUrl?: string;
  /** 绝对 URL；无封面 / 非 http(s) 封面时省略。 */
  ogImage?: string;
  /** ISO 8601 发布时间；缺失时省略。 */
  publishedTime?: string;
}

export interface ArticlePageMeta extends ArticleMeta {
  ogType: "article" | "website";
}

export function buildArticleMeta(
  article: ArticleDetail,
  options: ArticleMetaOptions
): ArticleMeta {
  return {
    title: titled(article.title, options),
    description:
      article.summary.trim() ||
      excerptFromMarkdown(article.content) ||
      article.title.trim(),
    canonicalUrl: articleCanonicalUrl(article.slug, options.siteUrl),
    ogImage: absoluteHttpUrl(article.cover_image, options.siteUrl),
    publishedTime: article.published_at?.trim() || undefined,
  };
}

/**
 * 页面级 head 元信息：成功取到文章时标记 `og:type=article`；
 * 404 / 502 使用独立文案，避免所有页面共用「文章详情」。
 */
export function buildArticlePageMeta(
  result: ArticleLoadResult,
  options: ArticleMetaOptions
): ArticlePageMeta {
  if (result.status === "ok") {
    return { ...buildArticleMeta(result.article, options), ogType: "article" };
  }

  const [title, description] =
    result.status === "not-found"
      ? ["文章未找到", "文章不存在或尚未发布，请检查链接是否正确。"]
      : ["文章加载失败", "服务暂时不可用，请稍后刷新重试。"];

  return { title: titled(title, options), description, ogType: "website" };
}

function titled(text: string, options: ArticleMetaOptions): string {
  return `${text.trim()} | ${siteTitleOf(options)}`;
}

function siteTitleOf(options: ArticleMetaOptions): string {
  return options.siteTitle?.trim() || DEFAULT_SITE_TITLE;
}

function excerptFromMarkdown(content: string): string {
  return Array.from(renderMarkdownPlainText(content))
    .slice(0, DESCRIPTION_FALLBACK_LENGTH)
    .join("");
}

function articleCanonicalUrl(slug: string, siteUrl: string | URL): string {
  return new URL(`/articles/${encodeURIComponent(slug)}`, siteUrl).href;
}

/** 相对路径按站点根绝对化；空值 / 非 http(s) 返回 undefined（省略 og:image）。 */
function absoluteHttpUrl(
  value: string,
  siteUrl: string | URL
): string | undefined {
  const raw = value.trim();
  if (!raw) return undefined;

  try {
    const url = new URL(raw, siteUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
