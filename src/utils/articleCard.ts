import { escapeHtml, safePathSegment } from "./escape";
import {
  categoryBadgeVars,
  categoryGradVars,
  categoryNameVars,
  getCategoryColor,
} from "./categoryColors";

/**
 * 共享文章卡片渲染器（taxonomy v2 / issue #81 §7）。
 *
 * 四个列表页（首页、/articles、/tags/:slug、/categories/:slug）统一走这里，
 * 转义复用 escape.ts 单源（#95）。纯函数：不依赖 DOM / i18n 运行时，文案与
 * locale 由调用方传入；行为由 tests/article-card.test.ts 用手写字面量钉住。
 *
 * taxonomy v2 契约：
 * - 卡片标签一律 `<a href="/tags/:slug">`（可点）；
 * - 分类 badge 一律 `<a href="/categories/:slug">`（可点）；
 * - 标签 title 带所属分类（belongsLabel 前缀）；
 * - 标签归属与文章分类不同时输出 `data-cross-category="1"`（CSS 虚线标记）。
 */

export interface CardArticle {
  slug: string;
  title: string;
  summary?: string;
  cover_image?: string;
  category?: { id?: number; name: string; slug: string } | null;
  tags?: Array<{
    name: string;
    slug: string;
    category?: { name: string; slug: string } | null;
  }>;
  view_count?: number;
  published_at?: string | null;
}

export interface ArticleCardOptions {
  /** "cover"（首页大卡，含封面/渐变横幅）或 "list"（列表页卡片）。 */
  variant?: "cover" | "list";
  tagLimit?: number;
  /** 分类 badge 可点（taxonomy v2 后恒为 true，保留开关仅为了测试对照）。 */
  showCategory?: boolean;
  /** list 变体是否渲染封面 / 渐变横幅（/articles 列表页使用，其余列表页不带）。 */
  coverInList?: boolean;
  dateLocale?: string;
  readLabel?: string;
  /** 空列表文案（renderArticleCardList 用）。 */
  noArticlesLabel?: string;
  /** 标签 title 的所属分类前缀（taxonomy.belongs_to_category，默认中文）。 */
  belongsLabel?: string;
}

function renderCardTags(
  article: CardArticle,
  options: ArticleCardOptions
): string {
  const limit = options.tagLimit ?? 3;
  const belongs = options.belongsLabel ?? "分类：";
  return (article.tags || [])
    .slice(0, limit)
    .map((tag) => {
      const title = tag.category
        ? ` title="${escapeHtml(belongs)}${escapeHtml(tag.category.name)}"`
        : "";
      const cross =
        tag.category &&
        article.category &&
        tag.category.slug !== article.category.slug
          ? ' data-cross-category="1"'
          : "";
      return `<a href="/tags/${safePathSegment(tag.slug)}" class="${options.variant === "cover" ? "card-tag" : "list-card-tag"}"${title}${cross}>${escapeHtml(tag.name)}</a>`;
    })
    .join("");
}

function renderCardCategory(
  article: CardArticle,
  options: ArticleCardOptions,
  cssClass: string,
  style = ""
): string {
  const cat = article.category;
  if (!cat || options.showCategory === false) return "";
  return `<a href="/categories/${safePathSegment(cat.slug)}" class="${cssClass}"${style ? ` style="${style}"` : ""}>${escapeHtml(cat.name)}</a>`;
}

function formatCardDate(
  article: CardArticle,
  options: ArticleCardOptions
): string {
  if (!article.published_at) return "";
  return new Date(article.published_at).toLocaleDateString(
    options.dateLocale ?? "zh-CN",
    { year: "numeric", month: "long", day: "numeric" }
  );
}

/** 单张卡片 HTML。variant 决定首页大卡（cover）或列表卡（list）两种既有视觉。 */
export function renderArticleCard(
  article: CardArticle,
  options: ArticleCardOptions = {}
): string {
  const read = options.readLabel ?? "阅读";
  const date = formatCardDate(article, options);
  const tags = `<div class="${options.variant === "cover" ? "card-tags" : "list-card-tags"}">${renderCardTags(article, options)}</div>`;

  const coverHtml =
    options.variant === "cover" || options.coverInList
      ? (() => {
          const cat = article.category;
          const catColor = getCategoryColor(cat?.slug, cat?.name);
          const gradVars = categoryGradVars(catColor);
          const nameVars = categoryNameVars(catColor);
          const isCover = options.variant === "cover";
          if (article.cover_image) {
            const cls = isCover ? "card-cover" : "list-card-cover";
            return `<div class="${cls}"><img src="${escapeHtml(article.cover_image)}" alt="" loading="lazy" /></div>`;
          }
          if (!isCover && !options.coverInList) return "";
          const gradCls = isCover
            ? "card-cover card-cover-grad"
            : "list-card-cover list-card-cover-grad";
          const nameCls = isCover ? "cover-cat-name" : "list-cover-cat-name";
          return `<div class="${gradCls}" style="${gradVars}"><span class="${nameCls}" style="${nameVars}">${escapeHtml(cat?.name || "✦")}</span></div>`;
        })()
      : "";

  if (options.variant === "cover") {
    const cat = article.category;
    const catColor = getCategoryColor(cat?.slug, cat?.name);
    const badgeVars = cat ? categoryBadgeVars(catColor) : "";
    return `
      <article class="article-card" data-reveal="fade-up">
        <a href="/articles/${safePathSegment(article.slug)}" class="card-link">
          ${coverHtml}
          <div class="card-body">
            <div class="card-meta">
              ${renderCardCategory(article, options, "card-category", badgeVars)}
              <span class="card-date">${date}</span>
            </div>
            <h3 class="card-title">${escapeHtml(article.title)}</h3>
            <p class="card-summary">${escapeHtml(article.summary || "")}</p>
            <div class="card-footer">
              ${tags}
              <span class="card-read">${article.view_count || 0} ${escapeHtml(read)}</span>
            </div>
          </div>
        </a>
      </article>`;
  }

  return `
      <article class="list-card"${options.coverInList ? ' data-reveal="fade-up"' : ""}>
        <a href="/articles/${safePathSegment(article.slug)}" class="list-card-link">
          ${coverHtml}
          <div class="list-card-body">
            <div class="list-card-meta">
              ${renderCardCategory(article, options, "list-card-category")}
              <span class="list-card-date">${date}</span>
            </div>
            <h3 class="list-card-title">${escapeHtml(article.title)}</h3>
            ${article.summary ? `<p class="list-card-summary">${escapeHtml(article.summary)}</p>` : ""}
            <div class="list-card-footer">
              ${tags}
              <span class="list-card-stats">${article.view_count || 0} ${escapeHtml(read)}</span>
            </div>
          </div>
        </a>
      </article>
    `;
}

/** 列表渲染：空列表返回空态文案（既有视觉：居中灰字）。 */
export function renderArticleCardList(
  items: CardArticle[],
  options: ArticleCardOptions = {}
): string {
  if (items.length === 0) {
    const empty = options.noArticlesLabel ?? "暂无文章";
    return `<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${escapeHtml(empty)}</p>`;
  }
  return items.map((item) => renderArticleCard(item, options)).join("");
}
