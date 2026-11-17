import { Env } from "../index";
import {
  successResponse,
  notFound,
  error,
  forbidden,
  ErrorCodes,
} from "../utils/response";
import { validate, isValidSlug } from "../utils/validator";
import { getUserIdByUsername } from "../services/user_service";
import type { AuthResult } from "../middleware/auth";
import { CATEGORY_COLUMNS, CATEGORY_OWNER_COLUMNS } from "../utils/columns";

/**
 * 分类列表（taxonomy v2 / #78）：tag_count 为名下标签数，不受文章状态影响
 * （COUNT(DISTINCT t.id) 对全量 tags 计数；相关子查询避免与文章 join 的行数交叉）。
 */
const CATEGORY_LIST_SELECT = `
    SELECT c.id, c.name, c.slug, c.description, c.created_by, c.created_at, c.updated_at,
           COUNT(a.id) as article_count,
           (SELECT COUNT(DISTINCT t.id) FROM tags t WHERE t.category_id = c.id) as tag_count
    FROM categories c
    LEFT JOIN articles a ON c.id = a.category_id AND a.status = 'published'
  `;

export async function handleListCategories(
  request: Request,
  env: Env
): Promise<Response> {
  const categories = await env.DB.prepare(
    `${CATEGORY_LIST_SELECT}
     GROUP BY c.id
     ORDER BY c.name
  `
  ).all();

  return successResponse(categories.results);
}

/** GET /categories/:slug（taxonomy v2 / #78）：分类详情（article_count 只算已发布，tag_count 同上）。 */
export async function handleGetCategory(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>
): Promise<Response> {
  const category = await env.DB.prepare(
    `${CATEGORY_LIST_SELECT}
     WHERE c.slug = ?
     GROUP BY c.id
  `
  )
    .bind(params.slug)
    .first();
  if (!category) return notFound("Category not found");

  return successResponse(category);
}

export async function handleCreateCategory(
  request: Request,
  env: Env,
  params: Record<string, string>,
  authResult?: AuthResult
): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>;

  const result = validate(body, [
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
    "SELECT id FROM categories WHERE slug = ? OR name = ?"
  )
    .bind(slug, body.name)
    .first();
  if (existing) {
    return error(
      ErrorCodes.CONFLICT,
      "Category with this name or slug already exists"
    );
  }

  let created_by: number | null = null;
  if (authResult) {
    created_by = await getUserIdByUsername(env, authResult.username);
  }

  const res = await env.DB.prepare(
    "INSERT INTO categories (name, slug, description, created_by) VALUES (?, ?, ?, ?)"
  )
    .bind(body.name, slug, body.description || "", created_by)
    .run();

  const category = await env.DB.prepare(
    `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE id = ?`
  )
    .bind(res.meta.last_row_id)
    .first();
  return successResponse(category, "Category created");
}

export async function handleUpdateCategory(
  request: Request,
  env: Env,
  params: Record<string, string>,
  authResult?: AuthResult
): Promise<Response> {
  const { id } = params;

  const existing = await env.DB.prepare(
    `SELECT ${CATEGORY_OWNER_COLUMNS} FROM categories WHERE id = ?`
  )
    .bind(id)
    .first<{ id: number; created_by: number | null }>();
  if (!existing) return notFound("Category not found");

  if (authResult && authResult.role !== "admin") {
    const userId = await getUserIdByUsername(env, authResult.username);
    if (userId === null || existing.created_by !== userId) {
      return forbidden("您没有权限编辑此分类");
    }
  }

  const body = (await request.json()) as Record<string, unknown>;

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    sets.push("name = ?");
    values.push(String(body.name));
  }
  if (body.slug !== undefined) {
    if (!isValidSlug(String(body.slug))) {
      return error(ErrorCodes.VALIDATION_FAILED, "Invalid slug format");
    }
    sets.push("slug = ?");
    values.push(String(body.slug));
  }
  if (body.description !== undefined) {
    sets.push("description = ?");
    values.push(String(body.description));
  }

  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);

  await env.DB.prepare(`UPDATE categories SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  const category = await env.DB.prepare(
    `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE id = ?`
  )
    .bind(id)
    .first();
  return successResponse(category, "Category updated");
}

export async function handleDeleteCategory(
  request: Request,
  env: Env,
  params: Record<string, string>
): Promise<Response> {
  const { id } = params;

  // taxonomy v2（#79 / ADR 0008 决策 1）：分类名下仍有标签时拒绝删除——
  // 标签不能悬空，先在后台把标签移走或批量移到未分类。
  const tagCount = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM tags WHERE category_id = ?"
  )
    .bind(id)
    .first<{ count: number }>();
  if (tagCount && tagCount.count > 0) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      `Cannot delete category. ${tagCount.count} tags are assigned to it. Move them or batch-move to uncategorized first.`
    );
  }

  const articleCount = await env.DB.prepare(
    "SELECT COUNT(*) as count FROM articles WHERE category_id = ?"
  )
    .bind(id)
    .first<{ count: number }>();
  if (articleCount && articleCount.count > 0) {
    return error(
      ErrorCodes.VALIDATION_FAILED,
      `Cannot delete category. ${articleCount.count} articles are using it.`
    );
  }

  const result = await env.DB.prepare("DELETE FROM categories WHERE id = ?")
    .bind(id)
    .run();
  if (result.meta.changes === 0) return notFound("Category not found");

  return successResponse(null, "Category deleted");
}
