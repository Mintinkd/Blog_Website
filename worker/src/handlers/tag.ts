import { Env } from "../index";
import {
  successResponse,
  notFound,
  error,
  forbidden,
  ErrorCodes,
} from "../utils/response";
import { validate, isValidSlug } from "../utils/validator";
import type { AuthResult } from "../middleware/auth";
import type { CreateTagRequest } from "../models/tag";
import { TAG_COLUMNS } from "../utils/columns";
import { getUserIdByUsername } from "../services/user_service";

/**
 * 标签行（列表 / 详情共用形状，taxonomy v2 / #78）：
 * category 为归属分类概要（迁移期可为 null），article_count 只计已发布文章
 * （COUNT(a.id)，修复旧口径 COUNT(at.article_id) 把草稿算进去的问题）。
 */
function mapTagListRow(t: Record<string, unknown>): Record<string, unknown> {
  const catId = t.tc_id as number | null | undefined;
  return {
    id: t.id as number,
    name: t.name as string,
    slug: t.slug as string,
    created_by: t.created_by as number | null,
    created_at: t.created_at as string,
    category_id: (t.category_id as number | null) ?? null,
    category:
      catId != null
        ? { id: catId, name: t.tc_name as string, slug: t.tc_slug as string }
        : null,
    article_count: t.article_count as number,
  };
}

const TAG_LIST_SELECT = `
    SELECT t.id, t.name, t.slug, t.created_by, t.created_at, t.category_id,
           c.id as tc_id, c.name as tc_name, c.slug as tc_slug,
           COUNT(a.id) as article_count
    FROM tags t
    LEFT JOIN article_tags at ON t.id = at.tag_id
    LEFT JOIN articles a ON at.article_id = a.id AND a.status = 'published'
    LEFT JOIN categories c ON t.category_id = c.id
  `;

export async function handleListTags(
  request: Request,
  env: Env
): Promise<Response> {
  // taxonomy v2 / #78：?category_slug= 按归属分类过滤（分类页标签筛选、标签页同分类标签）。
  // 过滤落在 tag.category_id 对应的分类上，无归属（NULL）标签不匹配任何 category_slug。
  const url = new URL(request.url);
  const categorySlug = url.searchParams.get("category_slug");

  let sql = TAG_LIST_SELECT;
  const binds: unknown[] = [];
  if (categorySlug) {
    sql += " WHERE c.slug = ?";
    binds.push(categorySlug);
  }
  sql += " GROUP BY t.id ORDER BY t.name";

  const tags = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return successResponse(tags.results.map(mapTagListRow));
}

/** GET /tags/:slug（taxonomy v2 / #78）：标签详情（含归属分类与已发布文章计数）。 */
export async function handleGetTag(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>
): Promise<Response> {
  const row = await env.DB.prepare(
    `${TAG_LIST_SELECT}
     WHERE t.slug = ?
     GROUP BY t.id
  `
  )
    .bind(params.slug)
    .first<Record<string, unknown>>();
  if (!row) return notFound("Tag not found");

  return successResponse(mapTagListRow(row));
}

export async function handleCreateTag(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
  authResult?: AuthResult
): Promise<Response> {
  // #78 / T2：请求体按 CreateTagRequest 接（可选 category_id 由 T3 消费）；旧 {name, slug} 兼容。
  const body = (await request.json()) as CreateTagRequest;

  const result = validate(body as unknown as Record<string, unknown>, [
    {
      field: "name",
      required: true,
      type: "string",
      minLength: 1,
      maxLength: 50,
    },
    {
      field: "slug",
      required: true,
      type: "string",
      minLength: 1,
      maxLength: 50,
    },
  ]);

  if (!result.valid) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      result.errors.map((e) => e.message).join("; ")
    );
  }

  const slug = String(body.slug);
  if (!isValidSlug(slug)) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      "Invalid slug format. Use lowercase letters, numbers, and hyphens."
    );
  }

  const existing = await env.DB.prepare(
    "SELECT id FROM tags WHERE slug = ? OR name = ?"
  )
    .bind(slug, body.name)
    .first();
  if (existing) {
    return error(
      ErrorCodes.CONFLICT,
      "Tag with this name or slug already exists"
    );
  }

  let created_by: number | null = null;
  if (authResult) {
    created_by = await getUserIdByUsername(env, authResult.username);
  }

  // taxonomy v2（#79 / ADR 0008 决策 1、5）：
  // - 可选 category_id：非法值 400、分类不存在 400；
  // - editor（非 admin）只能把新标签归属到自己拥有的分类，其余 403；
  // - 缺省归「未分类」（uncategorized，schema 种子行）。
  let categoryId: number | null;
  const rawCategoryId = body.category_id;
  if (rawCategoryId !== undefined && rawCategoryId !== null) {
    const cid = Number(rawCategoryId);
    if (!Number.isInteger(cid) || cid <= 0) {
      return error(ErrorCodes.PARAM_ERROR, "Invalid category_id");
    }
    const category = await env.DB.prepare(
      "SELECT id, created_by FROM categories WHERE id = ?"
    )
      .bind(cid)
      .first<{ id: number; created_by: number | null }>();
    if (!category) {
      return error(ErrorCodes.VALIDATION_FAILED, "Category not found");
    }
    if (authResult && authResult.role !== "admin") {
      const userId = await getUserIdByUsername(env, authResult.username);
      if (userId === null || category.created_by !== userId) {
        return forbidden("您没有权限把标签归属到该分类");
      }
    }
    categoryId = cid;
  } else {
    const uncategorized = await env.DB.prepare(
      "SELECT id FROM categories WHERE slug = 'uncategorized'"
    ).first<{ id: number }>();
    categoryId = uncategorized?.id ?? null;
  }

  const res = await env.DB.prepare(
    "INSERT INTO tags (name, slug, category_id, created_by) VALUES (?, ?, ?, ?)"
  )
    .bind(body.name, slug, categoryId, created_by)
    .run();
  const tag = await env.DB.prepare(
    `SELECT ${TAG_COLUMNS} FROM tags WHERE id = ?`
  )
    .bind(res.meta.last_row_id)
    .first();

  return successResponse(tag, "Tag created");
}

/**
 * PUT /tags/:id（taxonomy v2 / #79）：仅移动归属。
 * 请求体只消费 `category_id`（必填）；`name` / `slug` 刻意忽略——首批不改名，
 * 避免 FTS external-content 刷新问题（ADR 0008 决策 3）。
 * 权限（ADR 0008 决策 5）：admin 全部；editor 仅「标签创建者」或「目标分类所有者」，其余 403。
 */
export async function handleUpdateTag(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
  authResult?: AuthResult
): Promise<Response> {
  const { id } = params;
  const body = (await request.json()) as Record<string, unknown>;

  const cid = Number(body.category_id);
  if (!Number.isInteger(cid) || cid <= 0) {
    return error(
      ErrorCodes.PARAM_ERROR,
      "category_id is required to move a tag"
    );
  }

  const tag = await env.DB.prepare(
    "SELECT id, created_by FROM tags WHERE id = ?"
  )
    .bind(id)
    .first<{ id: number; created_by: number | null }>();
  if (!tag) return notFound("Tag not found");

  const category = await env.DB.prepare(
    "SELECT id, created_by FROM categories WHERE id = ?"
  )
    .bind(cid)
    .first<{ id: number; created_by: number | null }>();
  if (!category) {
    return error(ErrorCodes.VALIDATION_FAILED, "Category not found");
  }

  if (authResult && authResult.role !== "admin") {
    const userId = await getUserIdByUsername(env, authResult.username);
    if (
      userId === null ||
      (tag.created_by !== userId && category.created_by !== userId)
    ) {
      return forbidden("您没有权限移动此标签");
    }
  }

  await env.DB.prepare("UPDATE tags SET category_id = ? WHERE id = ?")
    .bind(cid, id)
    .run();

  const updated = await env.DB.prepare(
    `SELECT ${TAG_COLUMNS} FROM tags WHERE id = ?`
  )
    .bind(id)
    .first();
  return successResponse(updated, "Tag moved");
}

export async function handleDeleteTag(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  const { id } = params;

  const result = await env.DB.prepare("DELETE FROM tags WHERE id = ?")
    .bind(id)
    .run();
  if (result.meta.changes === 0) return notFound("Tag not found");

  return successResponse(null, "Tag deleted");
}
