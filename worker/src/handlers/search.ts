import { Env } from '../index';
import { successResponse, error, ErrorCodes } from '../utils/response';

export async function handleSearch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const page_size = Math.min(20, Math.max(1, parseInt(url.searchParams.get('page_size') || '10', 10)));

  if (!q || q.length < 1 || q.length > 100) {
    return error(ErrorCodes.PARAM_ERROR, 'Search query must be between 1 and 100 characters');
  }

  const escaped_q = q.replace(/"/g, '""');
  const like_q = `%${q}%`;
  const offset = (page - 1) * page_size;

  try {
    const ftsResults = await env.DB.prepare(`
      SELECT a.id, a.title, a.slug, a.summary, a.published_at, a.created_at,
             snippet(articles_fts, 0, '<mark>', '</mark>', '...', 30) as title_highlight,
             snippet(articles_fts, 1, '<mark>', '</mark>', '...', 80) as content_highlight
      FROM articles_fts f
      JOIN articles a ON a.id = f.rowid
      WHERE articles_fts MATCH ?
      AND a.status = 'published'
      ORDER BY rank
      LIMIT ? OFFSET ?
    `).bind(`"${escaped_q}"`, page_size, offset).all();

    const ftsCount = await env.DB.prepare(`
      SELECT COUNT(*) as total
      FROM articles_fts f
      JOIN articles a ON a.id = f.rowid
      WHERE articles_fts MATCH ?
      AND a.status = 'published'
    `).bind(`"${escaped_q}"`).first<{ total: number }>();

    return successResponse({
      items: ftsResults.results,
      total: ftsCount?.total || 0,
      page,
      page_size,
      query: q,
    });
  } catch {
    const results = await env.DB.prepare(`
      SELECT id, title, slug, summary, published_at, created_at
      FROM articles
      WHERE status = 'published'
      AND (title LIKE ? OR content LIKE ? OR summary LIKE ?)
      ORDER BY published_at DESC, created_at DESC
      LIMIT ? OFFSET ?
    `).bind(like_q, like_q, like_q, page_size, offset).all();

    const countResult = await env.DB.prepare(`
      SELECT COUNT(*) as total
      FROM articles
      WHERE status = 'published'
      AND (title LIKE ? OR content LIKE ? OR summary LIKE ?)
    `).bind(like_q, like_q, like_q).first<{ total: number }>();

    const items = results.results.map((row: Record<string, unknown>) => ({
      ...row,
      title_highlight: String(row.title || '').replace(new RegExp(escapeRegExp(q), 'gi'), '<mark>$&</mark>'),
      content_highlight: String(row.summary || '').replace(new RegExp(escapeRegExp(q), 'gi'), '<mark>$&</mark>'),
    }));

    return successResponse({
      items,
      total: countResult?.total || 0,
      page,
      page_size,
      query: q,
    });
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}