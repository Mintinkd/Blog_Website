/**
 * 分类详情页 `?tag=` 筛选的纯函数层（taxonomy v2 / #81 §5，#117 扩展）。
 *
 * 三个共享面，SSR 与客户端共用同一份实现，避免标记 / URL 漂移：
 * - URL 契约：`/categories/:slug?tag=<tag-slug>`；「全部」= 清掉参数（`parseTagParam` /
 *   `buildTagFilterUrl`），非法值一律忽略（回到「全部」，调用方用 replaceState 清参）；
 * - 筛选条 HTML（`renderFilterChips`）与筛选空态（`renderFilteredEmpty`）：chip 恒为
 *   `<a>`，选中态 `aria-current="page"`，无 JS 可用；
 * - 筛选列表请求 query（`buildCategoryArticlesQuery`）：服务端直连 Worker 与客户端
 *   局部刷新拼同一份 `category_slug` / `tag_slug`。
 *
 * 行为由 tests/taxonomy-filter.test.ts 用手写字面量钉住。
 */

import { escapeAttr, escapeHtml } from "./escape";

/**
 * 合法性口径（对**解码后**的 slug 值）：Unicode 字母 / 数字（含中文 slug）+
 * URL-safe 标点 `._~-`；拒绝空格、斜杠、引号、尖括号、百分号等注入载体。
 * 与 worker 路由 `:slug` 分型的差异：worker 在 URL 层匹配编码形态，这里在
 * URLSearchParams 已解码的值上校验——中文 slug（worker 侧合法）在此同样放行。
 */
export function isValidTagSlug(slug: string): boolean {
  if (!slug) return false;
  return /^[\p{L}\p{N}._~-]+$/u.test(slug);
}

/**
 * 从 location.search 解析 tag 筛选。缺失 / 非法 / 解析失败 → null（=「全部」）。
 */
export function parseTagParam(search: string): string | null {
  if (!search) return null;
  let raw: string;
  try {
    raw =
      new URLSearchParams(
        search.startsWith("?") ? search.slice(1) : search
      ).get("tag") ?? "";
  } catch {
    return null;
  }
  if (!raw) return null;
  if (!isValidTagSlug(raw)) return null;
  return raw;
}

/** 构造筛选 URL：tagSlug 为 null = 「全部」= 无参 basePath。 */
export function buildTagFilterUrl(
  basePath: string,
  tagSlug: string | null
): string {
  if (!tagSlug || !isValidTagSlug(tagSlug)) return basePath;
  return `${basePath}?tag=${encodeURIComponent(tagSlug)}`;
}

/** 筛选条 chip 的数据（SSR 取本分类标签，客户端取 /tags?category_slug= 的结果）。 */
export interface FilterChipTag {
  slug: string;
  name: string;
  article_count?: number;
}

/**
 * 校验筛选值是否属于给定标签集；不属于 / 缺失 → null（=「全部」）。
 * SSR 取数前与客户端 URL 清洗共用，避免各写一份归属判断。
 */
export function resolveActiveTagSlug(
  tags: FilterChipTag[],
  requested: string | null
): string | null {
  if (!requested) return null;
  return tags.some((tag) => tag.slug === requested) ? requested : null;
}

/**
 * 筛选条 HTML（issue #117）：SSR 与客户端共用，避免两套标记漂移。
 *
 * chip 一律是 `<a>`：无 JS 时点击即整页导航到 `?tag=`，可用；
 * 客户端拦截点击后走 pushState + 局部刷新。选中态用 `aria-current="page"`——
 * 链接不使用 `aria-pressed`。选中值不在本分类标签内（非法 / 越界）时回退「全部」，
 * 保证任何输入下恰有一个选中项。
 */
export function renderFilterChips(
  basePath: string,
  tags: FilterChipTag[],
  activeTagSlug: string | null,
  allLabel: string
): string {
  const selected = resolveActiveTagSlug(tags, activeTagSlug);
  const allChip =
    `<a class="filter-chip" href="${escapeAttr(buildTagFilterUrl(basePath, null))}" data-tag=""` +
    `${selected === null ? ' aria-current="page"' : ""}>${escapeHtml(allLabel)}</a>`;
  const tagChips = tags
    .map((tag) => {
      const count = Number.isFinite(tag.article_count)
        ? Number(tag.article_count)
        : 0;
      const current = tag.slug === selected ? ' aria-current="page"' : "";
      return (
        `<a class="filter-chip" href="${escapeAttr(buildTagFilterUrl(basePath, tag.slug))}"` +
        ` data-tag="${escapeAttr(tag.slug)}"${current}>${escapeHtml(tag.name)}` +
        `<span class="tag-count">${count}</span></a>`
      );
    })
    .join("");
  return allChip + tagChips;
}

/**
 * 筛选后空结果（#117）：SSR 与客户端共用；清除筛选是 `<a>`，无 JS 也能回「全部」。
 */
export function renderFilteredEmpty(
  basePath: string,
  message: string,
  clearLabel: string
): string {
  return (
    `<div class="filtered-empty"><p>${escapeHtml(message)}</p>` +
    `<a href="${escapeAttr(buildTagFilterUrl(basePath, null))}" id="clear-tag-filter">` +
    `${escapeHtml(clearLabel)}</a></div>`
  );
}

/**
 * `GET /articles` 的分类筛选 query（不含 origin / 前缀）：服务端 SSR 与客户端
 * 局部刷新共用，新增筛选参数只需改这里。
 */
export function buildCategoryArticlesQuery(options: {
  categorySlug: string;
  tagSlug?: string | null;
  page?: number;
}): string {
  const params = new URLSearchParams();
  params.set("status", "published");
  params.set("page", String(options.page ?? 1));
  params.set("page_size", "10");
  params.set("category_slug", options.categorySlug);
  if (options.tagSlug) params.set("tag_slug", options.tagSlug);
  return params.toString();
}
