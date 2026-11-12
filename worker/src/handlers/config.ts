import { Env } from "../index";
import { successResponse, error, ErrorCodes } from "../utils/response";
import {
  PROFILE_CARD_KEY,
  parseProfileCardJson,
  serializeProfileCard,
} from "../utils/profile-card";

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
  PROFILE_CARD_KEY,
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
    // 名片是 JSON blob：先解析净化再落库，避免坏数据 / 伪协议 URL 进入公开配置。
    if (key === PROFILE_CARD_KEY) {
      const normalized = parseProfileCardJson(value);
      if (!normalized.ok) {
        return error(ErrorCodes.VALIDATION_FAILED, normalized.message);
      }
      updates.push({ key, value: serializeProfileCard(normalized.value) });
      continue;
    }
    updates.push({ key, value });
  }

  const updatedAt = new Date().toISOString();
  // UPSERT 而非 UPDATE：新增展示型配置键（如 profile_card）无需先在 D1 里 seed，
  // 老库升级后首次保存即可自动建行。ON CONFLICT 分支不触碰 is_public，
  // 既有敏感键（jwt_secret / 密码哈希）仍保持 0，不会被这里改成公开。
  for (const { key, value } of updates) {
    await env.DB.prepare(
      `INSERT INTO site_config (key, value, is_public, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
      .bind(key, value, updatedAt)
      .run();
  }

  return successResponse(null, "Configuration updated");
}
