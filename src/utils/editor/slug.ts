/**
 * 标题 → slug 建议与合法性校验。
 *
 * 生成规则与 worker/src/services/article_service.ts 的 generateSlug 逐步对齐
 * （trim → 空白转 `-` → 连续 `-` 合并 → 去除非 \p{L}\p{N}\s- → 截 120 字符），
 * 避免后台「根据标题生成」的展示值与列表接口落库值不一致。对齐样例与期望值
 * 由 tests/editor-slug.test.ts 手写字面量钉住，不跨包 import Worker 实现。
 */
export const SLUG_MAX_LENGTH = 120;

export function generateSlug(title: string): string {
  return title
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .slice(0, SLUG_MAX_LENGTH);
}

/**
 * 手改 slug 的合法性：仅 Unicode 字母 / 数字 / `-`，长度 ≤ 120，且非空。
 * 不禁止首尾 `-` 与连续 `-` —— 服务端生成规则本身可能产生这类结果，
 * 若在此拒绝会出现「生成按钮产出的值自己校验不过」的矛盾。
 */
export function isValidSlug(slug: string): boolean {
  return (
    slug.length > 0 &&
    slug.length <= SLUG_MAX_LENGTH &&
    /^[\p{L}\p{N}-]+$/u.test(slug)
  );
}
