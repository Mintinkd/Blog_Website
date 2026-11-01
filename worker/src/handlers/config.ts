import { Env } from "../index";
import { successResponse, error, ErrorCodes } from "../utils/response";

/**
 * #51：配置写入键白名单——与 schema.sql 的种子 INSERT 键集合一致。
 * 任意键可写会把 jwt_secret 置空导致全站鉴权接口 500（admin 自己也登不进来）。
 */
const CONFIG_KEY_WHITELIST = new Set([
  "site_title",
  "site_subtitle",
  "site_description",
  "site_keywords",
  "posts_per_page",
  "about_content",
  "admin_username",
  "admin_password_hash",
  "jwt_secret",
]);

/** 敏感键置空会让鉴权/登录链路直接崩，一律拒绝 */
const NO_EMPTY_KEYS = new Set(["jwt_secret", "admin_password_hash"]);

export async function handleGetPublicConfig(
  request: Request,
  env: Env
): Promise<Response> {
  const configs = await env.DB.prepare(
    "SELECT key, value FROM site_config WHERE is_public = 1"
  ).all();

  const public_config: Record<string, string> = {};
  for (const row of configs.results) {
    public_config[row.key as string] = row.value as string;
  }

  return successResponse(public_config);
}

export async function handleGetAllConfig(
  request: Request,
  env: Env
): Promise<Response> {
  const configs = await env.DB.prepare(
    "SELECT key, value, is_public, updated_at FROM site_config"
  ).all();

  const configMap: Record<string, string> = {};
  for (const row of configs.results) {
    configMap[row.key as string] = row.value as string;
  }

  return successResponse(configMap);
}

export async function handleUpdateConfig(
  request: Request,
  env: Env
): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>;

  // 先整体校验、再统一写入：旧实现边校验边 UPDATE，任一后续键非法时
  // 前面的键已经落库，前端却只会看到一条失败提示（部分成功）。
  const updates: Array<{ key: string; value: string }> = [];
  for (const [key, value] of Object.entries(body)) {
    if (!CONFIG_KEY_WHITELIST.has(key)) {
      return error(
        ErrorCodes.VALIDATION_FAILED,
        `非法配置键：${key}（不在可写白名单内）`
      );
    }
    if (typeof value !== "string") {
      return error(
        ErrorCodes.VALIDATION_FAILED,
        `配置键 ${key} 的值必须是字符串`
      );
    }
    if (NO_EMPTY_KEYS.has(key) && value === "") {
      return error(ErrorCodes.VALIDATION_FAILED, `配置键 ${key} 不得为空`);
    }
    updates.push({ key, value });
  }

  const updatedAt = new Date().toISOString();
  for (const { key, value } of updates) {
    await env.DB.prepare(
      "UPDATE site_config SET value = ?, updated_at = ? WHERE key = ?"
    )
      .bind(value, updatedAt, key)
      .run();
  }

  return successResponse(null, "Configuration updated");
}
