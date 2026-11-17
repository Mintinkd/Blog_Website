/**
 * 分类详情页 ?tag= 筛选参数的纯函数层（taxonomy v2 / issue #81 §5）。
 *
 * URL 契约：`/categories/:slug?tag=<tag-slug>`；「全部」= 清掉参数。
 * 行为由 tests/taxonomy-filter.test.ts 用手写字面量钉住；非法值一律忽略
 * （回到「全部」，调用方用 replaceState 清参），不把脏输入放进请求。
 */

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
