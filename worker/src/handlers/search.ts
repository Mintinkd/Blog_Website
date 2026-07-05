import { Env } from '../index';
import { successResponse, error, ErrorCodes } from '../utils/response';

function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const chineseRegex = /[\u4e00-\u9fff\u3400-\u4dbf]+/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = chineseRegex.exec(query)) !== null) {
    if (match.index > lastIndex) {
      const englishPart = query.slice(lastIndex, match.index).trim();
      if (englishPart) tokens.push(...englishPart.split(/\s+/).filter(w => w.length > 0));
    }
    for (const char of match[0]) {
      tokens.push(char);
    }
    lastIndex = chineseRegex.lastIndex;
  }

  if (lastIndex < query.length) {
    const remaining = query.slice(lastIndex).trim();
    if (remaining) tokens.push(...remaining.split(/\s+/).filter(w => w.length > 0));
  }

  return tokens;
}

function buildLikeClause(tokens: string[], fields: string[]): { clause: string; params: string[] } {
  const fieldConditions = fields.map(field => {
    const tokenConditions = tokens.map(() => `${field} LIKE ?`);
    return `(${tokenConditions.join(' AND ')})`;
  });
  const clause = `(${fieldConditions.join(' OR ')})`;
  const params: string[] = [];
  for (const field of fields) {
    if (field === 'content') continue;
    for (const token of tokens) {
      params.push(`%${token}%`);
    }
  }
  for (const token of tokens) {
    params.push(`%${token}%`);
  }
  for (const token of tokens) {
    params.push(`%${token}%`);
  }
  return { clause, params };
}

function highlightText(text: string, tokens: string[]): string {
  if (!text) return '';
  let result = text;
  for (const token of tokens) {
    result = result.replace(new RegExp(escapeRegExp(token), 'gi'), '<mark>$&</mark>');
  }
  return result;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function handleSearch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const page_size = Math.min(20, Math.max(1, parseInt(url.searchParams.get('page_size') || '10', 10)));

  if (!q || q.length < 1 || q.length > 100) {
    return error(ErrorCodes.PARAM_ERROR, 'Search query must be between 1 and 100 characters');
  }

  const offset = (page - 1) * page_size;
  const tokens = tokenize(q);

  try {
    const escaped_q = q.replace(/"/g, '""');
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

    if ((ftsCount?.total || 0) > 0) {
      return successResponse({
        items: ftsResults.results,
        total: ftsCount?.total || 0,
        page,
        page_size,
        query: q,
      });
    }
  } catch {}

  if (tokens.length === 0) {
    return successResponse({ items: [], total: 0, page, page_size, query: q });
  }

  const titleLikeParts = tokens.map(() => 'title LIKE ?');
  const contentLikeParts = tokens.map(() => 'content LIKE ?');
  const summaryLikeParts = tokens.map(() => 'summary LIKE ?');

  const whereClause = `((${titleLikeParts.join(' AND ')}) OR (${contentLikeParts.join(' AND ')}) OR (${summaryLikeParts.join(' AND ')}))`;

  const bindParams: string[] = [];
  for (const token of tokens) bindParams.push(`%${token}%`);
  for (const token of tokens) bindParams.push(`%${token}%`);
  for (const token of tokens) bindParams.push(`%${token}%`);

  const results = await env.DB.prepare(`
    SELECT id, title, slug, summary, published_at, created_at
    FROM articles
    WHERE status = 'published'
    AND ${whereClause}
    ORDER BY published_at DESC, created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...bindParams, page_size, offset).all();

  const countResult = await env.DB.prepare(`
    SELECT COUNT(*) as total
    FROM articles
    WHERE status = 'published'
    AND ${whereClause}
  `).bind(...bindParams).first<{ total: number }>();

  const items = results.results.map((row: Record<string, unknown>) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    published_at: row.published_at,
    created_at: row.created_at,
    title_highlight: highlightText(String(row.title || ''), tokens),
    content_highlight: highlightText(String(row.summary || ''), tokens),
  }));

  return successResponse({
    items,
    total: countResult?.total || 0,
    page,
    page_size,
    query: q,
  });
}
