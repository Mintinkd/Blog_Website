import { Env } from '../index';
import { Article, ArticleListItem, ArticleDetail, CreateArticleRequest, UpdateArticleRequest } from '../models/article';

function generateSlug(title: string): string {
  return title
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .slice(0, 120);
}

interface ListArticlesOptions {
  page: number;
  page_size: number;
  category_slug?: string;
  tag_slug?: string;
  status?: string;
}

export async function listArticles(env: Env, options: ListArticlesOptions): Promise<{ items: ArticleListItem[]; total: number }> {
  const { page, page_size, category_slug, tag_slug, status = 'published' } = options;
  const offset = (page - 1) * page_size;

  let whereClause = '';
  const params: unknown[] = [];

  if (status && status !== 'all') {
    whereClause = 'WHERE a.status = ?';
    params.push(status);
  }

  if (category_slug) {
    whereClause += whereClause ? ' AND c.slug = ?' : 'WHERE c.slug = ?';
    params.push(category_slug);
  }

  if (tag_slug) {
    whereClause += whereClause ? ' AND EXISTS (SELECT 1 FROM article_tags at2 JOIN tags t2 ON at2.tag_id = t2.id WHERE at2.article_id = a.id AND t2.slug = ?)' : 'WHERE EXISTS (SELECT 1 FROM article_tags at2 JOIN tags t2 ON at2.tag_id = t2.id WHERE at2.article_id = a.id AND t2.slug = ?)';
    params.push(tag_slug);
  }

  const countResult = await env.DB.prepare(`SELECT COUNT(*) as total FROM articles a JOIN categories c ON a.category_id = c.id ${whereClause}`).bind(...params).first<{ total: number }>();
  const total = countResult?.total || 0;

  const articles = await env.DB.prepare(`
    SELECT a.id, a.title, a.slug, a.summary, a.cover_image, a.status,
           a.view_count, a.like_count, a.comment_count, a.published_at, a.created_at,
           c.id as category_id, c.name as category_name, c.slug as category_slug
    FROM articles a
    JOIN categories c ON a.category_id = c.id
    ${whereClause}
    ORDER BY a.published_at DESC, a.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...params, page_size, offset).all();

  const items: ArticleListItem[] = [];

  for (const row of articles.results) {
    const tags = await env.DB.prepare(`
      SELECT t.id, t.name, t.slug FROM tags t
      JOIN article_tags at ON t.id = at.tag_id
      WHERE at.article_id = ?
    `).bind(row.id).all();

    items.push({
      id: row.id as number,
      title: row.title as string,
      slug: row.slug as string,
      summary: row.summary as string,
      cover_image: row.cover_image as string,
      category: { id: row.category_id as number, name: row.category_name as string, slug: row.category_slug as string },
      tags: tags.results.map((t: Record<string, unknown>) => ({ id: t.id as number, name: t.name as string, slug: t.slug as string })),
      status: row.status as 'draft' | 'published',
      view_count: row.view_count as number,
      like_count: row.like_count as number,
      comment_count: row.comment_count as number,
      published_at: row.published_at as string | null,
      created_at: row.created_at as string,
    });
  }

  return { items, total };
}

export async function getArticleBySlug(env: Env, slug: string): Promise<ArticleDetail | null> {
  const row = await env.DB.prepare(`
    SELECT a.*, c.id as category_id, c.name as category_name, c.slug as category_slug
    FROM articles a
    JOIN categories c ON a.category_id = c.id
    WHERE a.slug = ?
  `).bind(slug).first();

  if (!row) return null;

  const tags = await env.DB.prepare(`
    SELECT t.id, t.name, t.slug FROM tags t
    JOIN article_tags at ON t.id = at.tag_id
    WHERE at.article_id = ?
  `).bind(row.id).all();

  return {
    id: row.id as number,
    title: row.title as string,
    slug: row.slug as string,
    content: row.content as string,
    content_html: row.content_html as string,
    summary: row.summary as string,
    cover_image: row.cover_image as string,
    category: { id: row.category_id as number, name: row.category_name as string, slug: row.category_slug as string },
    tags: tags.results.map((t: Record<string, unknown>) => ({ id: t.id as number, name: t.name as string, slug: t.slug as string })),
    status: row.status as 'draft' | 'published',
    view_count: row.view_count as number,
    like_count: row.like_count as number,
    comment_count: row.comment_count as number,
    published_at: row.published_at as string | null,
    created_at: row.created_at as string,
  };
}

export async function createArticle(env: Env, data: CreateArticleRequest): Promise<Article> {
  const slug = generateSlug(data.title);
  const now = new Date().toISOString();
  const published_at = data.status === 'published' ? now : null;

  const result = await env.DB.prepare(`
    INSERT INTO articles (title, slug, content, content_html, summary, cover_image, category_id, status, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.title, slug, data.content, '', data.summary || '', data.cover_image || '',
    data.category_id, data.status || 'draft', published_at
  ).run();

  const article_id = result.meta.last_row_id;

  if (data.tags && data.tags.length > 0) {
    for (const tag_name of data.tags) {
      const tag = await env.DB.prepare('SELECT id FROM tags WHERE name = ?').bind(tag_name).first<{ id: number }>();
      if (tag) {
        await env.DB.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)').bind(article_id, tag.id).run();
      }
    }
  }

  const article = await getArticleBySlug(env, slug);
  return article!;
}

export async function updateArticle(env: Env, id: number, data: UpdateArticleRequest): Promise<ArticleDetail | null> {
  const existing = await env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(id).first();
  if (!existing) return null;

  const sets: string[] = [];
  const values: unknown[] = [];

  if (data.title !== undefined) { sets.push('title = ?'); values.push(data.title); }
  if (data.content !== undefined) { sets.push('content = ?'); values.push(data.content); }
  if (data.summary !== undefined) { sets.push('summary = ?'); values.push(data.summary); }
  if (data.cover_image !== undefined) { sets.push('cover_image = ?'); values.push(data.cover_image); }
  if (data.category_id !== undefined) { sets.push('category_id = ?'); values.push(data.category_id); }
  if (data.status !== undefined) {
    sets.push('status = ?');
    values.push(data.status);
    if (data.status === 'published' && !existing.published_at) {
      sets.push('published_at = ?');
      values.push(new Date().toISOString());
    }
  }

  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  await env.DB.prepare(`UPDATE articles SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();

  if (data.tags !== undefined) {
    await env.DB.prepare('DELETE FROM article_tags WHERE article_id = ?').bind(id).run();
    for (const tag_name of data.tags) {
      const tag = await env.DB.prepare('SELECT id FROM tags WHERE name = ?').bind(tag_name).first<{ id: number }>();
      if (tag) {
        await env.DB.prepare('INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)').bind(id, tag.id).run();
      }
    }
  }

  const article = await env.DB.prepare('SELECT slug FROM articles WHERE id = ?').bind(id).first<{ slug: string }>();
  return article ? getArticleBySlug(env, article.slug) : null;
}

export async function deleteArticle(env: Env, id: number): Promise<boolean> {
  const result = await env.DB.prepare('DELETE FROM articles WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

export async function incrementViewCount(env: Env, id: number): Promise<void> {
  await env.DB.prepare('UPDATE articles SET view_count = view_count + 1 WHERE id = ?').bind(id).run();
}

export { generateSlug };