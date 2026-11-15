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
