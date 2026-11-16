/**
 * 媒体 KV key 的命名空间与形态约束（issue #105 / L6）。
 *
 * MEDIA 这一个 KV 命名空间里混放了四类对象：
 * - `media/<年>/<月>/<文件名>` —— 公开媒体（本文约束的对象）
 * - `imgproxy/<sha1>`、`textproxy/<sha1>` —— 代理缓存
 * - `backup:<ISO>.<rand>` —— 导入前的**全库快照**（#86 / H5）
 *
 * serve 端点只允许 `media/` 前缀且每段字符安全（无空段 / `.` / `..` / `:` / 控制字符），
 * 从而保证备份与缓存对象不能被匿名读取。文件名本身是 `crypto.randomUUID()`，
 * 因此保留匿名访问也不会让草稿图片变得可枚举。
 */

const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/** 是否是可经 `/media/serve/*` 公开读取的 key */
export function isServableMediaKey(key: string | null | undefined): boolean {
  if (!key) return false;
  if (!key.startsWith("media/")) return false;
  const segments = key.split("/");
  // 至少 media/<file>；每段非空、非点段、只含 URL 安全字符
  if (segments.length < 2) return false;
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      SAFE_SEGMENT.test(segment)
  );
}
