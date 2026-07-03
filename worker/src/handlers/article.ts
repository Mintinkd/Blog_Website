import { Env } from '../index';
import { successResponse, paginatedResponse, notFound, error, ErrorCodes } from '../utils/response';
import { validate, isValidSlug } from '../utils/validator';
import { sanitizeHtml } from '../utils/sanitizer';
import { generateSlug } from '../services/article_service';

export async function handleListArticles(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const page_size = Math.min(50, Math.max(1, parseInt(url.searchParams.get('page_size') || '10', 10)));
  const category_slug = url.searchParams.get('category_slug') || '';
  const tag_slug = url.searchParams.get('tag_slug') || '';
  const status = url.searchParams.get('status') || '';

  const { listArticles } = await import('../services/article_service');
  const result = await listArticles(env, { page, page_size, category_slug, tag_slug, status });
  return paginatedResponse(result.items, result.total, page, page_size);
}

export async function handleGetArticle(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const { slug } = params;
  const { getArticleBySlug, incrementViewCount } = await import('../services/article_service');

  const article = await getArticleBySlug(env, slug);
  if (!article) {
    return notFound('Article not found');
  }

  ctx_waitUntil(env, incrementViewCount(env, article.id));

  return successResponse(article);
}

export async function handleCreateArticle(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;

  const result = validate(body, [
    { field: 'title', required: true, type: 'string', minLength: 1, maxLength: 200 },
    { field: 'content', required: true, type: 'string', minLength: 1 },

  ]);

  if (!result.valid) {
    return error(ErrorCodes.VALIDATION_FAILED, result.errors.map(e => e.message).join('; '));
  }

  const { createArticle } = await import('../services/article_service');
  const article = await createArticle(env, {
    title: String(body.title),
    content: String(body.content),
    category_id: body.category_id ? Number(body.category_id) : null,
    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    status: (body.status === 'published' ? 'published' : 'draft') as 'draft' | 'published',
    summary: body.summary ? String(body.summary) : '',
    cover_image: body.cover_image ? String(body.cover_image) : '',
  });

  return successResponse(article, 'Article created');
}

export async function handleUpdateArticle(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const { id } = params;
  const body = await request.json() as Record<string, unknown>;

  const { updateArticle } = await import('../services/article_service');
  const article = await updateArticle(env, Number(id), {
    title: body.title ? String(body.title) : undefined,
    content: body.content ? String(body.content) : undefined,
    category_id: body.category_id ? Number(body.category_id) : (body.category_id === '' || body.category_id === null ? null : undefined),
    tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
    status: body.status ? (body.status as 'draft' | 'published') : undefined,
    summary: body.summary ? String(body.summary) : undefined,
    cover_image: body.cover_image ? String(body.cover_image) : undefined,
  });

  if (!article) {
    return notFound('Article not found');
  }

  return successResponse(article, 'Article updated');
}

export async function handleDeleteArticle(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const { id } = params;

  const { deleteArticle } = await import('../services/article_service');
  const deleted = await deleteArticle(env, Number(id));

  if (!deleted) {
    return notFound('Article not found');
  }

  return successResponse(null, 'Article deleted');
}

function ctx_waitUntil(env: Env, promise: Promise<unknown>): void {
  void promise;
}