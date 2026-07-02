import { Env } from '../index';
import { successResponse, notFound, error, ErrorCodes } from '../utils/response';
import { validate, isValidSlug } from '../utils/validator';

export async function handleListTags(request: Request, env: Env): Promise<Response> {
  const tags = await env.DB.prepare(`
    SELECT t.*, COUNT(at.article_id) as article_count
    FROM tags t
    LEFT JOIN article_tags at ON t.id = at.tag_id
    LEFT JOIN articles a ON at.article_id = a.id AND a.status = 'published'
    GROUP BY t.id
    ORDER BY t.name
  `).all();

  return successResponse(tags.results);
}

export async function handleCreateTag(request: Request, env: Env): Promise<Response> {
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

  const existing = await env.DB.prepare('SELECT id FROM tags WHERE slug = ? OR name = ?').bind(slug, body.name).first();
  if (existing) {
    return error(ErrorCodes.CONFLICT, 'Tag with this name or slug already exists');
  }

  const res = await env.DB.prepare('INSERT INTO tags (name, slug) VALUES (?, ?)').bind(body.name, slug).run();
  const tag = await env.DB.prepare('SELECT * FROM tags WHERE id = ?').bind(res.meta.last_row_id).first();

  return successResponse(tag, 'Tag created');
}

export async function handleDeleteTag(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const { id } = params;

  const result = await env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) return notFound('Tag not found');

  return successResponse(null, 'Tag deleted');
}