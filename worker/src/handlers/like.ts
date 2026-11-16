import { Env } from "../index";
import {
  successResponse,
  error,
  notFound,
  serverError,
  ErrorCodes,
} from "../utils/response";
import { getClientIpString } from "../utils/client_ip";
import {
  hashIp,
  MissingIpHashSecretError,
  type IpHashScope,
} from "../utils/ip_hash";

/**
 * 解析请求 IP 并计算 `ip_hash`（#104 / L5）。
 * secret 未配置时返回 `Response`（500 fail-closed），调用方直接透出。
 */
async function resolveIpHash(
  request: Request,
  env: Env,
  scope: IpHashScope
): Promise<string | Response> {
  const ip = await getClientIpString(request, env.VISITOR_IP_SIGNING_SECRET);
  try {
    return await hashIp(ip, scope, env.IP_HASH_SECRET);
  } catch (err) {
    if (err instanceof MissingIpHashSecretError) {
      return serverError("Like service temporarily unavailable");
    }
    throw err;
  }
}

/**
 * issue #107 / L9：id 契约与 `article.ts` 的 `^[1-9]\d*$` 同口径。
 * 非数字 id 在路由层就匹配不上（#100 / M20 把 `:id` 编译为 `\d+` → 404），
 * 这里只拦「纯数字但违契约」的情形（0 / 前导零 / 超安全整数）→ 400。
 */
function isValidArticleId(id: string | undefined): boolean {
  if (!id) return false;
  return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));
}

function invalidArticleId(): Response {
  return error(ErrorCodes.PARAM_ERROR, "Invalid article id");
}

export async function handleToggleLike(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>
): Promise<Response> {
  const { article_id } = params;
  if (!isValidArticleId(article_id)) return invalidArticleId();
  const ip_hash = await resolveIpHash(request, env, "like");
  if (ip_hash instanceof Response) return ip_hash;

  const article = await env.DB.prepare("SELECT id FROM articles WHERE id = ?")
    .bind(article_id)
    .first();
  // issue #107 / L9：资源不存在统一 404（此前误用 `error()` 的默认 400）。
  if (!article) return notFound("Article not found");

  const existing = await env.DB.prepare(
    "SELECT id FROM article_likes WHERE article_id = ? AND ip_hash = ?"
  )
    .bind(article_id, ip_hash)
    .first();

  // #72 / M9：记录写入与计数更新必须同一批原子执行，避免中途失败留下计数漂移。
  try {
    if (existing) {
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM article_likes WHERE article_id = ? AND ip_hash = ?"
        ).bind(article_id, ip_hash),
        env.DB.prepare(
          "UPDATE articles SET like_count = like_count - 1 WHERE id = ?"
        ).bind(article_id),
      ]);
      return successResponse({ liked: false }, "Like removed");
    } else {
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO article_likes (article_id, ip_hash) VALUES (?, ?)"
        ).bind(article_id, ip_hash),
        env.DB.prepare(
          "UPDATE articles SET like_count = like_count + 1 WHERE id = ?"
        ).bind(article_id),
      ]);
      return successResponse({ liked: true }, "Like added");
    }
  } catch {
    // 不回显内部异常原文 / SQL 表名（#72 验收：异常出口口径）。
    return serverError("Failed to update like");
  }
}

export async function handleLikeStatus(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  const { article_id } = params;
  if (!isValidArticleId(article_id)) return invalidArticleId();
  const ip_hash = await resolveIpHash(request, env, "like");
  if (ip_hash instanceof Response) return ip_hash;

  const existing = await env.DB.prepare(
    "SELECT id FROM article_likes WHERE article_id = ? AND ip_hash = ?"
  )
    .bind(article_id, ip_hash)
    .first();

  return successResponse({ liked: !!existing });
}
