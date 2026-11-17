import { renderArticleCardList } from "./articleCard";
import type { TaxonomyArticle } from "./taxonomyServer";

/**
 * 分类 / 标签详情页的文章卡片 HTML 渲染（issue #97 / M17 引入）。
 *
 * taxonomy v2（#81 §7）起实现委托给共享渲染器 `articleCard.ts`：
 * 四个列表页统一「标签 / 分类 badge 均可点、标签 title 带所属分类、
 * 跨分类标签 data-cross-category 标记」的契约。本文件保留函数签名
 * （SSR 与两页客户端调用方不动），`tagAsLink` 参数已废弃——标签恒为链接。
 */

export interface ArticleCardLabels {
  read: string;
  noArticles: string;
  /** 标签 title 的所属分类前缀（taxonomy.belongs_to_category；缺省中文「分类：」）。 */
  belongsLabel?: string;
}

export function renderArticleCards(
  items: TaxonomyArticle[],
  labels: ArticleCardLabels,
  dateLocale = "zh-CN",
  /**
   * @deprecated taxonomy v2 起标签恒为 `<a>` 链接（可点），本参数不再生效。
   */
  _tagAsLink = true
): string {
  return renderArticleCardList(items, {
    variant: "list",
    readLabel: labels.read,
    noArticlesLabel: labels.noArticles,
    dateLocale,
    belongsLabel: labels.belongsLabel,
  });
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
