import { corsMiddleware } from './middleware/cors';
import { rateLimitMiddleware } from './middleware/rate_limit';
import { authMiddleware } from './middleware/auth';
import type { AuthResult } from './middleware/auth';
import { forbidden } from './utils/response';
import { handleLogin, handleRefresh, handleListUsers, handleCreateUser, handleUpdateUser, handleDeleteUser } from './handlers/auth_handler';
import { handleListArticles, handleGetArticle, handleCreateArticle, handleUpdateArticle, handleDeleteArticle } from './handlers/article';
import { handleListCategories, handleCreateCategory, handleUpdateCategory, handleDeleteCategory } from './handlers/category';
import { handleListTags, handleCreateTag, handleDeleteTag } from './handlers/tag';
import { handleListComments, handleSubmitComment, handleListAllComments, handleApproveComment, handleRejectComment, handleDeleteComment } from './handlers/comment';
import { handleSearch } from './handlers/search';
import { handleToggleLike, handleLikeStatus } from './handlers/like';
import { handleUploadMedia, handleListMedia, handleDeleteMedia, handleServeMedia } from './handlers/media';
import { handleGetPublicConfig, handleGetAllConfig, handleUpdateConfig } from './handlers/config';
import { handleListFriendLinks, handleListAllFriendLinks, handleCreateFriendLink, handleUpdateFriendLink, handleDeleteFriendLink } from './handlers/friend_link';
import { handleExport, handleImport } from './handlers/admin';
import { handleAcquireLock, handleReleaseLock, handleGetLockStatus, handleForceReleaseLock } from './handlers/edit_lock';
import { Env } from './index';

type Handler = (request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>, authResult?: AuthResult) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
  requireAuth: boolean;
  requireAdmin: boolean;
}

const routes: Route[] = [];

function addRoute(method: string, path: string, handler: Handler, requireAuth = false, requireAdmin = false): void {
  const paramNames: string[] = [];
  const patternStr = path.replace(/:([^/]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  }).replace(/\*/g, () => {
    paramNames.push('0');
    return '(.+)';
  });
  routes.push({
    method,
    pattern: new RegExp(`^${patternStr}$`),
    paramNames,
    handler,
    requireAuth,
    requireAdmin,
  });
}

function matchRoute(method: string, pathname: string): { handler: Handler; params: Record<string, string>; requireAuth: boolean; requireAdmin: boolean } | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = pathname.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });
      return { handler: route.handler, params, requireAuth: route.requireAuth, requireAdmin: route.requireAdmin };
    }
  }
  return null;
}

addRoute('GET', '/health', async (_req, env) => {
  try {
    const dbTest = await env.DB.prepare('SELECT COUNT(*) as count FROM site_config').first();
    return Response.json({ status: 'ok', db: dbTest ? 'connected' : 'error', kv: 'connected' });
  } catch (e) {
    return Response.json({ status: 'error', message: String(e) });
  }
});

addRoute('POST', '/auth/login', async (req, env) => handleLogin(req, env));
addRoute('POST', '/auth/refresh', async (req, env, ctx, params) => handleRefresh(req, env), true);
addRoute('GET', '/users', async (req, env) => handleListUsers(req, env), true, true);
addRoute('POST', '/users', async (req, env) => handleCreateUser(req, env), true, true);
addRoute('PUT', '/users/:id', async (req, env, _ctx, params) => handleUpdateUser(req, env, params), true, true);
addRoute('DELETE', '/users/:id', async (req, env, _ctx, params) => handleDeleteUser(req, env, params), true, true);

addRoute('GET', '/articles', async (req, env, _ctx, params) => handleListArticles(req, env, params));
addRoute('GET', '/articles/:slug', async (req, env, _ctx, params) => handleGetArticle(req, env, params));
addRoute('POST', '/articles', async (req, env) => handleCreateArticle(req, env), true);
addRoute('PUT', '/articles/:id', async (req, env, _ctx, params) => handleUpdateArticle(req, env, params), true);
addRoute('DELETE', '/articles/:id', async (req, env, _ctx, params) => handleDeleteArticle(req, env, params), true);

addRoute('GET', '/categories', async (req, env) => handleListCategories(req, env));
addRoute('POST', '/categories', async (req, env) => handleCreateCategory(req, env), true);
addRoute('PUT', '/categories/:id', async (req, env, _ctx, params) => handleUpdateCategory(req, env, params), true);
addRoute('DELETE', '/categories/:id', async (req, env, _ctx, params) => handleDeleteCategory(req, env, params), true, true);

addRoute('GET', '/tags', async (req, env) => handleListTags(req, env));
addRoute('POST', '/tags', async (req, env) => handleCreateTag(req, env), true);
addRoute('DELETE', '/tags/:id', async (req, env, _ctx, params) => handleDeleteTag(req, env, params), true, true);

addRoute('GET', '/articles/:article_id/comments', async (req, env, _ctx, params) => handleListComments(req, env, params));
addRoute('POST', '/articles/:article_id/comments', async (req, env, ctx, params) => handleSubmitComment(req, env, ctx, params));
addRoute('GET', '/comments', async (req, env) => handleListAllComments(req, env), true);
addRoute('PUT', '/comments/:id/approve', async (req, env, _ctx, params) => handleApproveComment(req, env, params), true);
addRoute('PUT', '/comments/:id/reject', async (req, env, _ctx, params) => handleRejectComment(req, env, params), true);
addRoute('DELETE', '/comments/:id', async (req, env, _ctx, params) => handleDeleteComment(req, env, params), true);

addRoute('GET', '/search', async (req, env) => handleSearch(req, env));

addRoute('POST', '/articles/:article_id/like', async (req, env, ctx, params) => handleToggleLike(req, env, ctx, params));
addRoute('GET', '/articles/:article_id/like-status', async (req, env, _ctx, params) => handleLikeStatus(req, env, params));

addRoute('POST', '/media/upload', async (req, env) => handleUploadMedia(req, env), true);
addRoute('GET', '/media', async (req, env) => handleListMedia(req, env), true);
addRoute('DELETE', '/media/:id', async (req, env, _ctx, params) => handleDeleteMedia(req, env, params), true);
addRoute('GET', '/media/serve/*', async (req, env, _ctx, params) => handleServeMedia(req, env, params));

addRoute('GET', '/config', async (req, env) => handleGetPublicConfig(req, env));
addRoute('GET', '/config/all', async (req, env) => handleGetAllConfig(req, env), true, true);
addRoute('PUT', '/config', async (req, env) => handleUpdateConfig(req, env), true, true);

addRoute('GET', '/friend-links', async (req, env) => handleListFriendLinks(req, env));
addRoute('GET', '/friend-links/all', async (req, env) => handleListAllFriendLinks(req, env), true);
addRoute('POST', '/friend-links', async (req, env) => handleCreateFriendLink(req, env), true);
addRoute('PUT', '/friend-links/:id', async (req, env, _ctx, params) => handleUpdateFriendLink(req, env, params), true);
addRoute('DELETE', '/friend-links/:id', async (req, env, _ctx, params) => handleDeleteFriendLink(req, env, params), true);

addRoute('GET', '/admin/export', async (req, env) => handleExport(req, env), true, true);
addRoute('POST', '/admin/import', async (req, env) => handleImport(req, env), true, true);

addRoute('POST', '/articles/:id/edit-lock', async (req, env, _ctx, params, auth) => handleAcquireLock(req, env, _ctx, params, auth), true);
addRoute('DELETE', '/articles/:id/edit-lock', async (req, env, _ctx, params, auth) => handleReleaseLock(req, env, _ctx, params, auth), true);
addRoute('GET', '/articles/:id/edit-lock', async (req, env, _ctx, params, auth) => handleGetLockStatus(req, env, _ctx, params, auth), true);
addRoute('POST', '/articles/:id/edit-lock/force', async (req, env, _ctx, params, auth) => handleForceReleaseLock(req, env, _ctx, params, auth), true, true);

export async function router(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const apiPrefix = env.API_PREFIX || '/api/v1';
  const pathname = url.pathname.slice(apiPrefix.length) || '/';
  const method = request.method;

  try {
    const corsResponse = corsMiddleware(request);
    if (corsResponse) return corsResponse;

    const rateLimitResponse = await rateLimitMiddleware(request, env, ctx);
    if (rateLimitResponse) return rateLimitResponse;

    const matched = matchRoute(method, pathname);
    if (!matched) {
      return Response.json({ code: 404, message: `API not found: ${method} ${pathname}`, data: null }, { status: 404 });
    }

    let authResult: AuthResult | undefined;
    if (matched.requireAuth) {
      const result = await authMiddleware(request, env);
      if (result instanceof Response) return result;
      if (matched.requireAdmin && result.user.role !== 'admin') {
        return forbidden('权限不足，仅管理员可执行此操作');
      }
      authResult = result.user;
    }

    return await matched.handler(request, env, ctx, matched.params, authResult);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Router error:', errMsg);
    return Response.json({ code: 500, message: errMsg, data: null }, { status: 500 });
  }
}
