/**
 * 跨模块共享的类型守卫（issue #25：admin/settings 两手各有一份同形状谓词，收敛为单一定义。
 * 新的守卫按「形状」放这里，不再在各 handler 内各自定义同名/异名同义谓词）。
 */

/** 判定为普通对象（非 null、非数组）：admin 导入入参校验与 settings 深度合并共用 */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
