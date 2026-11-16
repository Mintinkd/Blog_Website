import { Env } from "../index";

/**
 * 按 username 查 user id —— 全 Worker 唯一入口（issue #101 / M21）。
 *
 * 背景：此前 11 处 handler/service 各自内联同一条
 * `SELECT id FROM users WHERE username = ?`，口径易漂移。收敛到本单点后，
 * 调用方只需关心「有 id / 无 id」，不再重复 SQL。
 *
 * 返回 null 表示用户不存在；调用方据此决定 401 / 403 / created_by 置空等语义。
 */
export async function getUserIdByUsername(
  env: Env,
  username: string
): Promise<number | null> {
  const row = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
    .bind(username)
    .first<{ id: number }>();
  return row?.id ?? null;
}
