import { safePathSegment } from "./escape";

/**
 * 标签 chip 的目标 URL（#116），全站单一事实源。
 *
 * - 有归属分类 → 分类筛选页 `/categories/:categorySlug?tag=:tagSlug`（主路径，
 *   让「标签是分类子类」在交互上闭环）；
 * - 无归属分类（迁移期）→ 兼容入口 `/tags/:tagSlug`。
 *
 * 文章卡片、文章详情、首页热门标签、分类卡片预览、标签页同分类 chip 与
 * `/tags` 目录 chip 共用，避免 URL 形态漂移。
 * 行为由 tests/tag-links.test.ts 用手写字面量钉住。
 */
export interface TagLink {
  slug: string;
  category?: { slug: string } | null;
}

export function tagChipHref(tag: TagLink): string {
  const categorySlug = tag.category?.slug;
  if (categorySlug) {
    return `/categories/${safePathSegment(categorySlug)}?tag=${encodeURIComponent(tag.slug)}`;
  }
  return `/tags/${safePathSegment(tag.slug)}`;
}
