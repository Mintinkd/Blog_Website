import { Env } from '../index';
import { successResponse, paginatedResponse, notFound, error, forbidden, ErrorCodes } from '../utils/response';
import { validate, isValidSlug } from '../utils/validator';
import { sanitizeHtml } from '../utils/sanitizer';
import { generateSlug } from '../services/article_service';
import type { AuthResult } from '../middleware/auth';

export async function handleListArticles(request: Request, env: Env, params: Record<string, string>, authResult?: AuthResult): Promise<Response> {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const page_size_param = url.searchParams.get('page_size');
  let page_size: number;
  if (page_size_param) {
    page_size = Math.min(50, Math.max(1, parseInt(page_size_param, 10)));
  } else {
    // 未显式指定 page_size 时，回落到站点配置中的「每页文章数」
    const cfgRow = await env.DB.prepare("SELECT value FROM site_config WHERE key = 'posts_per_page'").first<{ value: string }>();
    const cfgVal = cfgRow && cfgRow.value ? parseInt(cfgRow.value, 10) : NaN;
    page_size = Number.isFinite(cfgVal) && cfgVal > 0 ? Math.min(50, cfgVal) : 10;
  }
  const category_slug = url.searchParams.get('category_slug') || '';
  const tag_slug = url.searchParams.get('tag_slug') || '';
  const status = url.searchParams.get('status') || '';
  const author_id_param = url.searchParams.get('author_id');
  const author_id = author_id_param ? Number(author_id_param) : undefined;

  const { listArticles } = await import('../services/article_service');
  const result = await listArticles(env, { page, page_size, category_slug, tag_slug, status, auth_result: authResult, author_id });
  return paginatedResponse(result.items, result.total, page, page_size);
}

export async function handleGetArticle(request: Request, env: Env, params: Record<string, string>, authResult?: AuthResult): Promise<Response> {
  const { slug } = params;
  const { getArticleBySlug, incrementViewCount } = await import('../services/article_service');

  const article = await getArticleBySlug(env, slug);
  if (!article) {
    return notFound('Article not found');
  }

  // 未发布文章：仅管理员或作者本人可访问（后台编辑拉取/草稿预览），其余一律 404
  if (article.status !== 'published') {
    let allowed = false;
    if (authResult) {
      if (authResult.role === 'admin') {
        allowed = true;
      } else if (article.author_id != null) {
        const row = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(authResult.username).first<{ id: number }>();
        allowed = !!row && row.id === article.author_id;
      }
    }
    if (!allowed) {
      return notFound('Article not found');
    }
  }

  const cookieHeader = request.headers.get('cookie') || undefined;
  const viewed = await incrementViewCount(env, article.id, cookieHeader);

  const response = successResponse(article);
  if (viewed) {
    const headers = new Headers(response.headers);
    headers.append('Set-Cookie', `view_${article.id}=1; Path=/; Max-Age=86400; SameSite=Lax`);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  return response;
}

export async function handleCreateArticle(request: Request, env: Env, params: Record<string, string>, authResult?: AuthResult): Promise<Response> {
  const body = await request.json() as Record<string, unknown>;

  const result = validate(body, [
    { field: 'title', required: true, type: 'string', minLength: 1, maxLength: 200 },
    { field: 'content', required: true, type: 'string', minLength: 1 },
  ]);

  if (!result.valid) {
    return error(ErrorCodes.VALIDATION_FAILED, result.errors.map(e => e.message).join('; '));
  }

  let slug: string | undefined;
  if (body.slug !== undefined && String(body.slug).trim() !== '') {
    slug = String(body.slug).trim();
    if (!isValidSlug(slug)) {
      return error(ErrorCodes.VALIDATION_FAILED, '链接标识格式无效：仅支持小写字母、数字、中文与连字符');
    }
    const dup = await env.DB.prepare('SELECT id FROM articles WHERE slug = ?').bind(slug).first();
    if (dup) {
      return error(ErrorCodes.CONFLICT, '链接标识已被占用，请更换');
    }
  }

  const { createArticle } = await import('../services/article_service');
  const article = await createArticle(env, {
    title: String(body.title),
    content: String(body.content),
    slug,
    category_id: body.category_id ? Number(body.category_id) : null,
    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    status: (body.status === 'published' ? 'published' : 'draft') as 'draft' | 'published',
    summary: body.summary ? String(body.summary) : '',
    cover_image: body.cover_image ? String(body.cover_image) : '',
  }, authResult);

  return successResponse(article, 'Article created');
}

export async function handleUpdateArticle(request: Request, env: Env, params: Record<string, string>, authResult?: AuthResult): Promise<Response> {
  const { id } = params;

  if (authResult && authResult.role !== 'admin') {
    const { checkArticleOwnership } = await import('../services/article_service');
    const owned = await checkArticleOwnership(env, Number(id), authResult);
    if (!owned) {
      return forbidden('您没有权限编辑此文章');
    }
  }

  const body = await request.json() as Record<string, unknown>;

  let slug: string | undefined;
  if (body.slug !== undefined && String(body.slug).trim() !== '') {
    slug = String(body.slug).trim();
    if (!isValidSlug(slug)) {
      return error(ErrorCodes.VALIDATION_FAILED, '链接标识格式无效：仅支持小写字母、数字、中文与连字符');
    }
    const dup = await env.DB.prepare('SELECT id FROM articles WHERE slug = ? AND id <> ?').bind(slug, Number(id)).first();
    if (dup) {
      return error(ErrorCodes.CONFLICT, '链接标识已被占用，请更换');
    }
  }

  const { updateArticle } = await import('../services/article_service');
  const article = await updateArticle(env, Number(id), {
    title: body.title ? String(body.title) : undefined,
    content: body.content ? String(body.content) : undefined,
    slug,
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

export async function handleDeleteArticle(request: Request, env: Env, params: Record<string, string>, authResult?: AuthResult): Promise<Response> {
  const { id } = params;

  if (authResult && authResult.role !== 'admin') {
    const { checkArticleOwnership } = await import('../services/article_service');
    const owned = await checkArticleOwnership(env, Number(id), authResult);
    if (!owned) {
      return forbidden('您没有权限删除此文章');
    }
  }

  const { deleteArticle } = await import('../services/article_service');
  const deleted = await deleteArticle(env, Number(id));

  if (!deleted) {
    return notFound('Article not found');
  }

  return successResponse(null, 'Article deleted');
}
