import { Env } from "../index";
import {
  successResponse,
  notFound,
  error,
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

  const res = await env.DB.prepare(
    "INSERT INTO tags (name, slug, created_by) VALUES (?, ?, ?)"
  )
    .bind(body.name, slug, created_by)
    .run();
  const tag = await env.DB.prepare(
    `SELECT ${TAG_COLUMNS} FROM tags WHERE id = ?`
  )
    .bind(res.meta.last_row_id)
    .first();

  return successResponse(tag, "Tag created");
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
