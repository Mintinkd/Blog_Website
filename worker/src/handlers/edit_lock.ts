import { Env } from '../index';
import { successResponse, forbidden, notFound, error, ErrorCodes } from '../utils/response';
import type { AuthResult } from '../middleware/auth';

export async function handleAcquireLock(request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>, authResult?: AuthResult): Promise<Response> {
  if (!authResult) return forbidden('Not authenticated');
  const { id } = params;
  const articleId = Number(id);

  const article = await env.DB.prepare('SELECT id FROM articles WHERE id = ?').bind(articleId).first();
  if (!article) return notFound('Article not found');

  const { acquireLock } = await import('../services/edit_lock_service');
  const result = await acquireLock(env, articleId, authResult);

  if (result.success) {
    return successResponse(result.lock, 'Lock acquired');
  }

  if (result.conflict) {
    return error(ErrorCodes.CONFLICT, `文章正在被${result.conflict.holder_name}编辑`, 409);
  }

  return error(ErrorCodes.SERVER_ERROR, 'Failed to acquire lock');
}

export async function handleReleaseLock(request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>, authResult?: AuthResult): Promise<Response> {
  if (!authResult) return forbidden('Not authenticated');
  const { id } = params;

  const { releaseLock } = await import('../services/edit_lock_service');
  const result = await releaseLock(env, Number(id), authResult);

  if (result.forbidden) return forbidden('您没有权限释放此编辑锁');
  return successResponse(null, 'Lock released');
}

export async function handleGetLockStatus(request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>, authResult?: AuthResult): Promise<Response> {
  if (!authResult) return forbidden('Not authenticated');
  const { id } = params;

  const { getLockStatus } = await import('../services/edit_lock_service');
  const status = await getLockStatus(env, Number(id));
  return successResponse(status);
}

export async function handleForceReleaseLock(request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>, authResult?: AuthResult): Promise<Response> {
  if (!authResult || authResult.role !== 'admin') return forbidden('仅管理员可强制释放编辑锁');
  const { id } = params;

  const { forceReleaseLock } = await import('../services/edit_lock_service');
  const result = await forceReleaseLock(env, Number(id), authResult);

  if (result.success) {
    return successResponse({ previous_holder: result.previous_holder || null }, 'Force release successful');
  }

  return error(ErrorCodes.SERVER_ERROR, 'Failed to force release lock');
}