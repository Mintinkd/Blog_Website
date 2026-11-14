import { Env } from "../index";
import {
  successResponse,
  paginatedResponse,
  notFound,
  error,
  forbidden,
  unauthorized,
  ErrorCodes,
} from "../utils/response";
import { validate, isValidSlug } from "../utils/validator";
import { generateSlug } from "../services/article_service";
import type { AuthResult } from "../middleware/auth";

/**
 * 局部更新的可选文本字段（issue #70）：字段「存在」即写入，`""` 表示清空正文 /
 * 摘要 / 封面；`undefined` / `null` 视为未提供、保持原值（沿用旧行为，避免把
 * 字面量 "null" 写进正文）。仅用于 content / summary / cover_image；
 * title 等字段的既有校验与语义不变。
 */
function optionalTextField(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

export async function handleListArticles(
  request: Request,
  env: Env,
  params: Record<string, string>,
  authResult?: AuthResult
): Promise<Response> {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const page_size_param = url.searchParams.get("page_size");
  let page_size: number;
  if (page_size_param) {
    page_size = Math.min(50, Math.max(1, parseInt(page_size_param, 10)));
  } else {
    // 未显式指定 page_size 时，回落到站点配置中的「每页文章数」
    const cfgRow = await env.DB.prepare(
      "SELECT value FROM site_config WHERE key = 'posts_per_page'"
    ).first<{ value: string }>();
    const cfgVal = cfgRow && cfgRow.value ? parseInt(cfgRow.value, 10) : NaN;
    page_size =
      Number.isFinite(cfgVal) && cfgVal > 0 ? Math.min(50, cfgVal) : 10;
  }
  const category_slug = url.searchParams.get("category_slug") || "";
  const tag_slug = url.searchParams.get("tag_slug") || "";
  const author_id_param = url.searchParams.get("author_id");
  const author_id = author_id_param ? Number(author_id_param) : undefined;

  // 审查报告 H1 修复：status 枚举校验 + 非 published 一律要求登录（匿名只可见已发布）
  const statusParam = url.searchParams.get("status");
  if (
    statusParam !== null &&
    !["published", "draft", "all"].includes(statusParam)
  ) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      "无效的 status 参数（仅支持 published / draft / all）"
    );
  }
  const status = (statusParam ?? "published") as "published" | "draft" | "all";
  if (status !== "published" && !authResult) {
    return unauthorized("查看非已发布文章需要登录");
  }

  const { listArticles } = await import("../services/article_service");
  const result = await listArticles(env, {
    page,
    page_size,
    category_slug,
    tag_slug,
    status,
    auth_result: authResult,
    author_id,
  });
  return paginatedResponse(result.items, result.total, page, page_size);
}

export async function handleGetArticle(
  request: Request,
  env: Env,
  params: Record<string, string>,
  authResult?: AuthResult
): Promise<Response> {
  const { slug } = params;
  const { getArticleBySlug } = await import("../services/article_service");

  const article = await getArticleBySlug(env, slug);
  if (!article) {
    return notFound("Article not found");
  }

  // 未发布文章：仅管理员或作者本人可访问（后台编辑拉取/草稿预览），其余一律 404
  if (article.status !== "published") {
    let allowed = false;
    if (authResult) {
      if (authResult.role === "admin") {
        allowed = true;
      } else if (article.author_id != null) {
        const row = await env.DB.prepare(
          "SELECT id FROM users WHERE username = ?"
        )
          .bind(authResult.username)
          .first<{ id: number }>();
        allowed = !!row && row.id === article.author_id;
      }
    }
    if (!allowed) {
      return notFound("Article not found");
    }
    // 后台编辑拉取 / 草稿预览不计数、不下发去重 Cookie（§2 / §11 决策 7）
    return successResponse(article);
  }

  // 仅已发布文章 200 进入 Tier 0 计数：过滤、24h 去重、日聚合（§4）
  // 计数是旁路能力：D1 迁移缺失 / 抖动不得拖挂文章正文响应（2026-11-11 生产故障）
  let setCookie = false;
  try {
    const { recordArticleView } = await import("../services/analytics_service");
    const result = await recordArticleView(env, request, article.id);
    setCookie = result.setCookie;
  } catch (error) {
    console.error("analytics: recordArticleView failed", error);
  }

  const response = successResponse(article);
  if (setCookie) {
    const headers = new Headers(response.headers);
    headers.append(
      "Set-Cookie",
      `view_${article.id}=1; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly`
    );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return response;
}

/**
 * issue #63 / ADR 0006 取数接缝：编辑器按稳定 id 取完整正文。
 *
 * 与公开 `GET /articles/:slug` 完全分开：需 Bearer 鉴权（路由 requireAuth）、
 * admin 可读全部 / editor 仅可读自己的文章；不进入阅读统计、不下发
 * `view_<id>` Cookie、不写 `requests`；响应为 ArticleEditDetail，不含
 * `content_html`。`PUT /articles/:id` 的写入语义不受影响（空字符串清空由 #70 处理）。
 */
export async function handleGetArticleForEdit(
  _request: Request,
  env: Env,
  params: Record<string, string>,
  authResult?: AuthResult
): Promise<Response> {
  // handler 级兜底：即使被绕过 requireAuth 直接调用，也不向匿名请求暴露正文
  if (!authResult) return unauthorized("需要登录才能读取文章编辑详情");

  const { id } = params;
  // 只接受十进制正整数，且必须落在安全整数范围内；拒绝 0 / 负数 / 小数 /
  // 前导零 / 非数字 / 溢出值，避免 Number() 把脏 id 静默转成 NaN 或 0
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    return error(ErrorCodes.PARAM_ERROR, "无效的文章 id", 400);
  }
  const articleId = Number(id);

  const { getArticleForEdit } = await import("../services/article_service");
  const article = await getArticleForEdit(env, articleId);
  if (!article) return notFound("Article not found");

  // 先取详情确认文章存在 → 404；再判所有权 → 403，两者语义不混淆
  if (authResult.role !== "admin") {
    const { checkArticleOwnership } =
      await import("../services/article_service");
    const owned = await checkArticleOwnership(env, articleId, authResult);
    if (!owned) return forbidden("您没有权限编辑此文章");
  }

  return successResponse(article);
}

export async function handleCreateArticle(
  request: Request,
  env: Env,
  params: Record<string, string>,
  authResult?: AuthResult
): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>;

  const result = validate(body, [
    {
      field: "title",
      required: true,
      type: "string",
      minLength: 1,
      maxLength: 200,
    },
    { field: "content", required: true, type: "string", minLength: 1 },
  ]);

  if (!result.valid) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      result.errors.map((e) => e.message).join("; ")
    );
  }

  let slug: string | undefined;
  if (body.slug !== undefined && String(body.slug).trim() !== "") {
    slug = String(body.slug).trim();
    if (!isValidSlug(slug)) {
      return error(
        ErrorCodes.VALIDATION_FAILED,
        "链接标识格式无效：仅支持小写字母、数字、中文与连字符"
      );
    }
    const dup = await env.DB.prepare("SELECT id FROM articles WHERE slug = ?")
      .bind(slug)
      .first();
    if (dup) {
      return error(ErrorCodes.CONFLICT, "链接标识已被占用，请更换");
    }
  }

  const { createArticle } = await import("../services/article_service");
  const article = await createArticle(
    env,
    {
      title: String(body.title),
      content: String(body.content),
      slug,
      category_id: body.category_id ? Number(body.category_id) : null,
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      status: (body.status === "published" ? "published" : "draft") as
        "draft" | "published",
      summary: body.summary ? String(body.summary) : "",
      cover_image: body.cover_image ? String(body.cover_image) : "",
    },
    authResult
  );

  return successResponse(article, "Article created");
}

export async function handleUpdateArticle(
  request: Request,
  env: Env,
  params: Record<string, string>,
  authResult?: AuthResult
): Promise<Response> {
  const { id } = params;

  if (authResult && authResult.role !== "admin") {
    const { checkArticleOwnership } =
      await import("../services/article_service");
    const owned = await checkArticleOwnership(env, Number(id), authResult);
    if (!owned) {
      return forbidden("您没有权限编辑此文章");
    }
  }

  const body = (await request.json()) as Record<string, unknown>;

  let slug: string | undefined;
  if (body.slug !== undefined && String(body.slug).trim() !== "") {
    slug = String(body.slug).trim();
    if (!isValidSlug(slug)) {
      return error(
        ErrorCodes.VALIDATION_FAILED,
        "链接标识格式无效：仅支持小写字母、数字、中文与连字符"
      );
    }
    const dup = await env.DB.prepare(
      "SELECT id FROM articles WHERE slug = ? AND id <> ?"
    )
      .bind(slug, Number(id))
      .first();
    if (dup) {
      return error(ErrorCodes.CONFLICT, "链接标识已被占用，请更换");
    }
  }

  const { updateArticle } = await import("../services/article_service");
  const article = await updateArticle(env, Number(id), {
    title: body.title ? String(body.title) : undefined,
    content: optionalTextField(body.content),
    slug,
    category_id: body.category_id
      ? Number(body.category_id)
      : body.category_id === "" || body.category_id === null
        ? null
        : undefined,
    tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
    status: body.status ? (body.status as "draft" | "published") : undefined,
    summary: optionalTextField(body.summary),
    cover_image: optionalTextField(body.cover_image),
  });

  if (!article) {
    return notFound("Article not found");
  }

  return successResponse(article, "Article updated");
}

export async function handleDeleteArticle(
  request: Request,
  env: Env,
  params: Record<string, string>,
  authResult?: AuthResult
): Promise<Response> {
  const { id } = params;

  if (authResult && authResult.role !== "admin") {
    const { checkArticleOwnership } =
      await import("../services/article_service");
    const owned = await checkArticleOwnership(env, Number(id), authResult);
    if (!owned) {
      return forbidden("您没有权限删除此文章");
    }
  }

  const { deleteArticle } = await import("../services/article_service");
  const deleted = await deleteArticle(env, Number(id));

  if (!deleted) {
    return notFound("Article not found");
  }

  return successResponse(null, "Article deleted");
}
