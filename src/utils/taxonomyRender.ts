import { escapeHtml, safePathSegment } from "./escape";
import type { TaxonomyArticle } from "./taxonomyServer";

/**
 * 分类 / 标签详情页的文章卡片 HTML 渲染（issue #97 / M17）。
 *
 * SSR 首屏（frontmatter）与客户端刷新脚本共用本函数，保证两端 DOM 结构一致、
 * 转义口径一致（escapeHtml / safePathSegment 单源，#95）。i18n 文案由调用方传入
 * （服务端用默认中文，客户端用 t()），因此函数本身不依赖 DOM / i18n 运行时。
 */

export interface ArticleCardLabels {
  read: string;
  noArticles: string;
}

export function renderArticleCards(
  items: TaxonomyArticle[],
  labels: ArticleCardLabels,
  dateLocale = "zh-CN",
  tagAsLink = false
): string {
  if (items.length === 0) {
    return `<p style="text-align:center;color:var(--color-text-tertiary);padding:3rem 0;">${labels.noArticles}</p>`;
  }
  return items
    .map((article) => {
      const date = article.published_at
        ? new Date(article.published_at).toLocaleDateString(dateLocale, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : "";
      const tags = article.tags
        .slice(0, 3)
        .map((tag) =>
          tagAsLink
            ? `<a href="/tags/${safePathSegment(tag.slug)}" class="list-card-tag">${escapeHtml(tag.name)}</a>`
            : `<span class="list-card-tag">${escapeHtml(tag.name)}</span>`
        )
        .join("");
      return `
          <article class="list-card">
            <a href="/articles/${safePathSegment(article.slug)}" class="list-card-link">
              <div class="list-card-body">
                <div class="list-card-meta">
                  ${article.category ? `<span class="list-card-category">${escapeHtml(article.category.name)}</span>` : ""}
                  <span class="list-card-date">${date}</span>
                </div>
                <h3 class="list-card-title">${escapeHtml(article.title)}</h3>
                ${article.summary ? `<p class="list-card-summary">${escapeHtml(article.summary)}</p>` : ""}
                <div class="list-card-footer">
                  <div class="list-card-tags">${tags}</div>
                  <span class="list-card-stats">${article.view_count || 0} ${labels.read}</span>
                </div>
              </div>
            </a>
          </article>
        `;
    })
    .join("");
}

export function renderPagination(
  page: number,
  totalPages: number,
  labels: { prev: string; next: string }
): string {
  if (totalPages <= 1) return "";
  let html = '<div class="pagination">';
  if (page > 1)
    html += `<button class="pag-btn" data-page="${page - 1}">${labels.prev}</button>`;
  html += `<span class="pag-info">${page} / ${totalPages}</span>`;
  if (page < totalPages)
    html += `<button class="pag-btn" data-page="${page + 1}">${labels.next}</button>`;
  return html + "</div>";
}
