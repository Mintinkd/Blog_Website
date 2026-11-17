import { escapeHtml, safePathSegment } from "./escape";

/**
 * 标签按归属分类分组（taxonomy v2 / issue #81 / ADR 0008）。
 *
 * 纯函数层：不依赖 DOM / i18n 运行时，分组行为由 tests/taxonomy-groups.test.ts
 * 用手写字面量钉住；渲染函数的 i18n 文案由调用方传入（服务端中文默认值，
 * 客户端用 t()），与 taxonomyRender / articleCard 同一模式。
 */

export interface GroupableTag {
  name: string;
  slug: string;
  article_count?: number;
  category_id?: number | null;
  category?: { id: number; name: string; slug: string } | null;
}

export interface TagGroup {
  /** null = 「未分类」组（不渲染分类链接）。 */
  category: { id: number; name: string; slug: string } | null;
  tags: GroupableTag[];
}

/**
 * 分组规则（#81 §2）：
 * - 有归属的分类组按「组内标签数」降序，平票保持输入顺序（稳定排序）；
 * - 「未分类」（category 为 null）固定排在最后；
 * - 组内标签按 article_count 降序，平票按名称（localeCompare，zh 语义近似）。
 */
export function groupTagsByCategory(tags: GroupableTag[]): TagGroup[] {
  const byCategory = new Map<
    string,
    {
      category: { id: number; name: string; slug: string } | null;
      tags: GroupableTag[];
    }
  >();
  for (const tag of tags) {
    const key = tag.category ? String(tag.category.id) : "uncategorized";
    let bucket = byCategory.get(key);
    if (!bucket) {
      bucket = { category: tag.category ?? null, tags: [] };
      byCategory.set(key, bucket);
    }
    bucket.tags.push(tag);
  }

  const groups = [...byCategory.values()].map((group) => ({
    ...group,
    tags: [...group.tags].sort((a, b) => {
      const diff = (b.article_count || 0) - (a.article_count || 0);
      if (diff !== 0) return diff;
      return a.name.localeCompare(b.name, "zh");
    }),
  }));

  const categorized = groups.filter((g) => g.category !== null);
  const uncategorized = groups.filter((g) => g.category === null);
  categorized.sort((a, b) => b.tags.length - a.tags.length);
  return [...categorized, ...uncategorized];
}

export interface TagGroupRenderLabels {
  /** 未分类组头文案（taxonomy.uncategorized）。 */
  uncategorized: string;
  /** 标签数单位 / 计数后缀（taxonomy.tag_count，可传空串只显数字）。 */
  tagCount: string;
}

/**
 * 渲染分组标签云 HTML。mode:
 * - "link"（/tags 目录页）：chip 是 `<a href="/tags/:slug">`；
 * - "button"（搜索页）：chip 是 `<button>`，携带 data-type/slug/name，
 *   由页面既有的 taxonomy-filter 点击委托消费（保留 SearchBox 内过滤行为）。
 * 组头：分类名（链接 /categories/:slug）+ 标签数；未分类组头无链接。
 * 选择器契约：保留 `#tags-cloud` 容器、`.tag-item` 与 `.tag-group`（回归脚本断言）。
 */
export function renderTagGroups(
  groups: TagGroup[],
  labels: TagGroupRenderLabels,
  mode: "link" | "button" = "link"
): string {
  if (groups.length === 0) return "";
  return groups
    .map((group) => {
      const isUncategorized = group.category === null;
      const headName = isUncategorized
        ? escapeHtml(labels.uncategorized)
        : `<a href="/categories/${safePathSegment(group.category!.slug)}" class="tag-group-name">${escapeHtml(group.category!.name)}</a>`;
      const chips = group.tags
        .map((tag) => {
          const inner = `<span>${escapeHtml(tag.name)}</span><span class="tag-count">${tag.article_count || 0}</span>`;
          if (mode === "button") {
            return `<button type="button" class="tag-item taxonomy-item" data-type="tag" data-slug="${escapeHtml(tag.slug)}" data-name="${escapeHtml(tag.name)}" data-category-name="${escapeHtml(group.category?.name ?? "")}">${inner}</button>`;
          }
          return `<a href="/tags/${safePathSegment(tag.slug)}" class="tag-item">${inner}</a>`;
        })
        .join("");
      const count = group.tags.length;
      const countLabel = labels.tagCount
        ? ` <span class="tag-group-count">${count} ${escapeHtml(labels.tagCount)}</span>`
        : `<span class="tag-group-count">${count}</span>`;
      return `<div class="tag-group"><div class="tag-group-head">${headName}${countLabel}</div><div class="tag-group-items">${chips}</div></div>`;
    })
    .join("");
}

export interface CategoryCardCategory {
  id: number;
  name: string;
  slug: string;
  description?: string;
  article_count?: number;
  tag_count?: number;
}

export interface CategoryCardRenderLabels {
  articlesSuffix: string;
  tagCountLabel: string;
  uncategorized: string;
}

/**
 * /categories 目录页卡片渲染（#81 §4）：
 * `<article>` 卡片 + 独立链接（分类名可点、标签 chip 可点），**禁止**整卡
 * `<a>` 内再嵌标签链接的嵌套交互元素；卡片显示 article_count / tag_count
 * （tag_count 缺省用分组数兜底）与前 3 个标签 chip；未分类固定最后，其余按文章数降序。
 */
export function renderCategoryCards(
  categories: CategoryCardCategory[],
  tags: GroupableTag[],
  labels: CategoryCardRenderLabels
): string {
  const tagsByCategory = new Map<number, GroupableTag[]>();
  for (const tag of tags) {
    if (tag.category_id == null) continue;
    let bucket = tagsByCategory.get(tag.category_id);
    if (!bucket) {
      bucket = [];
      tagsByCategory.set(tag.category_id, bucket);
    }
    bucket.push(tag);
  }

  const uncategorizedSlug = "uncategorized";
  const sorted = [...categories].sort((a, b) => {
    const aUnc = a.slug === uncategorizedSlug;
    const bUnc = b.slug === uncategorizedSlug;
    if (aUnc !== bUnc) return aUnc ? 1 : -1;
    return (b.article_count || 0) - (a.article_count || 0);
  });

  return sorted
    .map((cat) => {
      const catTags = tagsByCategory.get(cat.id) ?? [];
      const tagCount = cat.tag_count ?? catTags.length;
      const chips = catTags
        .slice(0, 3)
        .map(
          (tag) =>
            `<a href="/tags/${safePathSegment(tag.slug)}" class="category-tag-chip">${escapeHtml(tag.name)}</a>`
        )
        .join("");
      return `
        <article class="category-item">
          <div class="category-head">
            <a href="/categories/${safePathSegment(cat.slug)}" class="category-name">${escapeHtml(cat.name)}</a>
            <span class="category-count">${cat.article_count || 0} ${escapeHtml(labels.articlesSuffix)} · ${tagCount} ${escapeHtml(labels.tagCountLabel)}</span>
          </div>
          ${chips ? `<div class="category-tags">${chips}</div>` : ""}
          ${cat.description ? `<span class="category-desc">${escapeHtml(cat.description)}</span>` : ""}
        </article>`;
    })
    .join("");
}
