import { Env } from '../index';
import { successResponse, error, ErrorCodes } from '../utils/response';

async function hashIp(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip + '-salt-like-2024');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function handleToggleLike(request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const { article_id } = params;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ip_hash = await hashIp(ip);

  const article = await env.DB.prepare('SELECT id FROM articles WHERE id = ?').bind(article_id).first();
  if (!article) return error(ErrorCodes.NOT_FOUND, 'Article not found');

  const existing = await env.DB.prepare('SELECT id FROM article_likes WHERE article_id = ? AND ip_hash = ?').bind(article_id, ip_hash).first();

  if (existing) {
    await env.DB.prepare('DELETE FROM article_likes WHERE article_id = ? AND ip_hash = ?').bind(article_id, ip_hash).run();
    await env.DB.prepare('UPDATE articles SET like_count = like_count - 1 WHERE id = ?').bind(article_id).run();
    return successResponse({ liked: false }, 'Like removed');
  } else {
    await env.DB.prepare('INSERT INTO article_likes (article_id, ip_hash) VALUES (?, ?)').bind(article_id, ip_hash).run();
    await env.DB.prepare('UPDATE articles SET like_count = like_count + 1 WHERE id = ?').bind(article_id).run();
    return successResponse({ liked: true }, 'Like added');
  }
}

export async function handleLikeStatus(request: Request, env: Env, params: Record<string, string>): Promise<Response> {
  const { article_id } = params;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ip_hash = await hashIp(ip);

  const existing = await env.DB.prepare('SELECT id FROM article_likes WHERE article_id = ? AND ip_hash = ?').bind(article_id, ip_hash).first();

  return successResponse({ liked: !!existing });
}