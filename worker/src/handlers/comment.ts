import { Env } from '../index';
import { successResponse, error, ErrorCodes, forbidden } from '../utils/response';
import { validate } from '../utils/validator';
import { sanitizeHtml, escapeHtml } from '../utils/sanitizer';
import { SubmitCommentRequest } from '../models/comment';
import type { AuthResult } from '../middleware/auth';

export async function handleListComments(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const { article_id } = params;
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const page_size = Math.min(50, Math.max(1, parseInt(url.searchParams.get('page_size') || '20', 10)));

  const comments = await env.DB.prepare(`
    SELECT id, article_id, nickname, content, created_at
    FROM comments
    WHERE article_id = ? AND status = 'approved'
    ORDER BY created_at ASC
    LIMIT ? OFFSET ?
  `).bind(article_id, page_size, (page - 1) * page_size).all();

  const countResult = await env.DB.prepare('SELECT COUNT(*) as total FROM comments WHERE article_id = ? AND status = ?').bind(article_id, 'approved').first<{ total: number }>();

  return successResponse({
    items: comments.results,
    total: countResult?.total || 0,
    page,
    page_size,
  });
}

export async function handleSubmitComment(request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const { article_id } = params;
  const body = await request.json() as Record<string, unknown>;

  const result = validate(body, [
    { field: 'nickname', required: true, type: 'string', minLength: 1, maxLength: 100 },
    { field: 'content', required: true, type: 'string', minLength: 1, maxLength: 1000 },
  ]);

  if (!result.valid) {
    return error(ErrorCodes.VALIDATION_FAILED, result.errors.map(e => e.message).join('; '));
  }

  const nickname = escapeHtml(String(body.nickname).trim());
  const content = sanitizeHtml(String(body.content).trim());

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ip_hash = await hashIp(ip);

  const articleExists = await env.DB.prepare('SELECT id FROM articles WHERE id = ?').bind(article_id).first();
  if (!articleExists) {
    return error(ErrorCodes.NOT_FOUND, 'Article not found');
  }

  await env.DB.prepare(`
    INSERT INTO comments (article_id, nickname, content, status, ip_hash)
    VALUES (?, ?, ?, 'pending', ?)
  `).bind(article_id, nickname, content, ip_hash).run();

  return successResponse(null, 'Comment submitted and awaiting review');
}

export async function handleListAllComments(request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>, authResult?: AuthResult): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const page_size = Math.min(50, Math.max(1, parseInt(url.searchParams.get('page_size') || '20', 10)));

  let whereClause = '';
  const bindParams: unknown[] = [];

  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    whereClause = 'WHERE c.status = ?';
    bindParams.push(status);
  }

  if (authResult && authResult.role === 'editor') {
    const user = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(authResult.username).first<{ id: number }>();
    if (user) {
      whereClause += whereClause ? ' AND a.author_id = ?' : 'WHERE a.author_id = ?';
      bindParams.push(user.id);
    }
  }

  const comments = await env.DB.prepare(`
    SELECT c.id, c.article_id, c.nickname, c.content, c.status, c.created_at, a.title as article_title
    FROM comments c
    JOIN articles a ON c.article_id = a.id
    ${whereClause}
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...bindParams, page_size, (page - 1) * page_size).all();

  return successResponse(comments.results);
}

export async function handleApproveComment(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const { id } = params;
  const result = await env.DB.prepare("UPDATE comments SET status = 'approved' WHERE id = ?").bind(id).run();
  if (result.meta.changes === 0) return error(ErrorCodes.NOT_FOUND, 'Comment not found');

  await env.DB.prepare('UPDATE articles SET comment_count = (SELECT COUNT(*) FROM comments WHERE article_id = (SELECT article_id FROM comments WHERE id = ?) AND status = ?) WHERE id = (SELECT article_id FROM comments WHERE id = ?)').bind(id, 'approved', id).run();

  return successResponse(null, 'Comment approved');
}

export async function handleRejectComment(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const { id } = params;
  const result = await env.DB.prepare("UPDATE comments SET status = 'rejected' WHERE id = ?").bind(id).run();
  if (result.meta.changes === 0) return error(ErrorCodes.NOT_FOUND, 'Comment not found');

  return successResponse(null, 'Comment rejected');
}

export async function handleDeleteComment(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const { id } = params;
  const result = await env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) return error(ErrorCodes.NOT_FOUND, 'Comment not found');

  return successResponse(null, 'Comment deleted');
}

async function hashIp(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip + '-salt-blog-2024');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}