import { Env } from '../index';
import { successResponse, error, ErrorCodes } from '../utils/response';
import { validate } from '../utils/validator';

export async function handleSearch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const page_size = Math.min(20, Math.max(1, parseInt(url.searchParams.get('page_size') || '10', 10)));

  if (!q || q.length < 1 || q.length > 100) {
    return error(ErrorCodes.PARAM_ERROR, 'Search query must be between 1 and 100 characters');
  }

  const escaped_q = q.replace(/"/g, '""');

  try {
    const results = await env.DB.prepare(`
      SELECT a.id, a.title, a.slug, a.summary, a.published_at, a.created_at,
             snippet(articles_fts, 0, '<mark>', '</mark>', '...', 30) as title_highlight,
             snippet(articles_fts, 1, '<mark>', '</mark>', '...', 80) as content_highlight
      FROM articles_fts f
      JOIN articles a ON a.id = f.rowid
      WHERE articles_fts MATCH ?
      AND a.status = 'published'
      ORDER BY rank
      LIMIT ? OFFSET ?
    `).bind(`"${escaped_q}"`, page_size, (page - 1) * page_size).all();

    const countResult = await env.DB.prepare(`
      SELECT COUNT(*) as total
      FROM articles_fts f
      JOIN articles a ON a.id = f.rowid
      WHERE articles_fts MATCH ?
      AND a.status = 'published'
    `).bind(`"${escaped_q}"`).first<{ total: number }>();

    return successResponse({
      items: results.results,
      total: countResult?.total || 0,
      page,
      page_size,
      query: q,
    });
  } catch (e) {
    return error(ErrorCodes.PARAM_ERROR, 'Invalid search query. Please try different keywords.');
  }
}