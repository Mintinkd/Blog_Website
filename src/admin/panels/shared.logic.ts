/**
 * 多个后台面板共用的纯函数。不依赖 DOM / Vue 运行时，可在 node 环境单测。
 * 拆分前分别是 `App.vue` 的 `formatDate` 与分类表格里的行内权限判断。
 */

export function formatDate(d: string, locale: "zh" | "en"): string {
  if (!d) return "-";
  return new Date(d).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US");
}

export function canEditCategory(
  role: string,
  createdBy: unknown,
  currentUserId: number
): boolean {
  return role === "admin" || !createdBy || createdBy === currentUserId;
}

/**
 * taxonomy v2（#79 / ADR 0008 决策 5）：标签归属管理权限，与 worker 侧
 * handleCreateTag / handleUpdateTag 同口径。admin 全部；editor 仅
 * 「自己创建的标签」或「目标分类所有者」；两处归属均为空（无主）时从严拒绝。
 */
export function canManageTag(
  role: string,
  tagCreatedBy: unknown,
  categoryCreatedBy: unknown,
  currentUserId: number
): boolean {
  if (role === "admin") return true;
  if (tagCreatedBy === currentUserId) return true;
  return categoryCreatedBy === currentUserId;
}
