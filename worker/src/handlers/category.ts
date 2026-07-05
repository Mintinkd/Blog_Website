import { Env } from '../index';
import { successResponse, notFound, error, forbidden, ErrorCodes } from '../utils/response';
import { validate, isValidSlug } from '../utils/validator';
import { Category, CreateCategoryRequest, UpdateCategoryRequest } from '../models/category';
import type { AuthResult } from '../middleware/auth';

export async function handleListCategories(request: Request, env: Env): Promise<Response> {
  const categories = await env.DB.prepare(`
    SELECT c.*, COUNT(a.id) as article_count
    FROM categories c
    LEFT JOIN articles a ON c.id = a.category_id AND a.status = 'published'
    GROUP BY c.id
    ORDER BY c.name
  `).all();

  return successResponse(categories.results);
}

export async function handleCreateCategory(request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>, authResult?: AuthResult): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;

  const result = validate(body, [
    { field: 'name', required: true, type: 'string', minLength: 1, maxLength: 50 },
    { field: 'slug', required: true, type: 'string', minLength: 1, maxLength: 50 },
  ]);

  if (!result.valid) {
    return error(ErrorCodes.VALIDATION_FAILED, result.errors.map(e => e.message).join('; '));
  }

  const slug = String(body.slug);
  if (!isValidSlug(slug)) {
    return error(ErrorCodes.VALIDATION_FAILED, 'Invalid slug format. Use lowercase letters, numbers, and hyphens.');
  }

  const existing = await env.DB.prepare('SELECT id FROM categories WHERE slug = ? OR name = ?').bind(slug, body.name).first();
  if (existing) {
    return error(ErrorCodes.CONFLICT, 'Category with this name or slug already exists');
  }

  let created_by: number | null = null;
  if (authResult) {
    const user = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(authResult.username).first<{ id: number }>();
    created_by = user?.id || null;
  }

  const res = await env.DB.prepare('INSERT INTO categories (name, slug, description, created_by) VALUES (?, ?, ?, ?)').bind(
    body.name, slug, body.description || '', created_by
  ).run();

  const category = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(res.meta.last_row_id).first();
  return successResponse(category, 'Category created');
}

export async function handleUpdateCategory(request: Request, env: Env, params: Record<string, string>, authResult?: AuthResult): Promise<Response> {
  const { id } = params;

  const existing = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first<{ id: number; created_by: number | null }>();
  if (!existing) return notFound('Category not found');

  if (authResult && authResult.role !== 'admin') {
    const user = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(authResult.username).first<{ id: number }>();
    if (user && existing.created_by !== user.id) {
      return forbidden('您没有权限编辑此分类');
    }
  }

  const body = await request.json() as Record<string, unknown>;

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) { sets.push('name = ?'); values.push(String(body.name)); }
  if (body.slug !== undefined) {
    if (!isValidSlug(String(body.slug))) {
      return error(ErrorCodes.VALIDATION_FAILED, 'Invalid slug format');
    }
    sets.push('slug = ?'); values.push(String(body.slug));
  }
  if (body.description !== undefined) { sets.push('description = ?'); values.push(String(body.description)); }

  sets.push('updated_at = ?'); values.push(new Date().toISOString()); values.push(id);

  await env.DB.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();

  const category = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
  return successResponse(category, 'Category updated');
}

export async function handleDeleteCategory(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const { id } = params;

  const articleCount = await env.DB.prepare('SELECT COUNT(*) as count FROM articles WHERE category_id = ?').bind(id).first<{ count: number }>();
  if (articleCount && articleCount.count > 0) {
    return error(ErrorCodes.VALIDATION_FAILED, `Cannot delete category. ${articleCount.count} articles are using it.`);
  }

  const result = await env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) return notFound('Category not found');

  return successResponse(null, 'Category deleted');
}
