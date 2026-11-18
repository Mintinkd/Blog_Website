/**
 * 分类详情页 ?tag= 筛选参数的纯函数层（taxonomy v2 / issue #81 §5）。
 *
 * URL 契约：`/categories/:slug?tag=<tag-slug>`；「全部」= 清掉参数。
 * 行为由 tests/taxonomy-filter.test.ts 用手写字面量钉住；非法值一律忽略
 * （回到「全部」，调用方用 replaceState 清参），不把脏输入放进请求。
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
  const selected =
    activeTagSlug && tags.some((tag) => tag.slug === activeTagSlug)
      ? activeTagSlug
      : null;
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
