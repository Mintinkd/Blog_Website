import { corsMiddleware } from './middleware/cors';
import { rateLimitMiddleware } from './middleware/rate_limit';
import { Env } from './index';

type Handler = (request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
  requireAuth: boolean;
}

const routes: Route[] = [];

function addRoute(method: string, path: string, handler: Handler, requireAuth = false): void {
  const paramNames: string[] = [];
  const patternStr = path.replace(/:([^/]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  routes.push({
    method,
    pattern: new RegExp(`^${patternStr}$`),
    paramNames,
    handler,
    requireAuth,
  });
}

async function matchRoute(method: string, pathname: string): Promise<{ handler: Handler; params: Record<string, string>; requireAuth: boolean } | null> {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = pathname.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });
      return { handler: route.handler, params, requireAuth: route.requireAuth };
    }
  }
  return null;
}

export async function router(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const apiPrefix = env.API_PREFIX || '/api/v1';
  const pathname = url.pathname.slice(apiPrefix.length) || '/';
  const method = request.method;

  const corsResponse = corsMiddleware(request);
  if (corsResponse) return corsResponse;

  const rateLimitResponse = await rateLimitMiddleware(request, env, ctx);
  if (rateLimitResponse) return rateLimitResponse;

  const matched = await matchRoute(method, pathname);
  if (!matched) {
    return Response.json({ code: 404, message: 'API not found', data: null }, { status: 404 });
  }

  if (matched.requireAuth) {
    const { authMiddleware } = await import('./middleware/auth');
    const authResult = await authMiddleware(request, env);
    if (authResult) return authResult;
  }

  try {
    return await matched.handler(request, env, ctx, matched.params);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Handler error:', errMsg, error);
    return Response.json({ code: 500, message: errMsg, data: null }, { status: 500 });
  }
}

// Auth routes
addRoute('POST', '/auth/login', async (req, env) => {
  const { handleLogin } = await import('./handlers/auth_handler');
  return handleLogin(req, env);
});

addRoute('POST', '/auth/refresh', async (req, env) => {
  const { handleRefresh } = await import('./handlers/auth_handler');
  return handleRefresh(req, env);
}, true);

// Article routes
addRoute('GET', '/articles', async (req, env, ctx, params) => {
  const { handleListArticles } = await import('./handlers/article');
  return handleListArticles(req, env, params);
});

addRoute('GET', '/articles/:slug', async (req, env, ctx, params) => {
  const { handleGetArticle } = await import('./handlers/article');
  return handleGetArticle(req, env, params);
});

addRoute('POST', '/articles', async (req, env) => {
  const { handleCreateArticle } = await import('./handlers/article');
  return handleCreateArticle(req, env);
}, true);

addRoute('PUT', '/articles/:id', async (req, env, ctx, params) => {
  const { handleUpdateArticle } = await import('./handlers/article');
  return handleUpdateArticle(req, env, params);
}, true);

addRoute('DELETE', '/articles/:id', async (req, env, ctx, params) => {
  const { handleDeleteArticle } = await import('./handlers/article');
  return handleDeleteArticle(req, env, params);
}, true);

// Category routes
addRoute('GET', '/categories', async (req, env) => {
  const { handleListCategories } = await import('./handlers/category');
  return handleListCategories(req, env);
});

addRoute('POST', '/categories', async (req, env) => {
  const { handleCreateCategory } = await import('./handlers/category');
  return handleCreateCategory(req, env);
}, true);

addRoute('PUT', '/categories/:id', async (req, env, ctx, params) => {
  const { handleUpdateCategory } = await import('./handlers/category');
  return handleUpdateCategory(req, env, params);
}, true);

addRoute('DELETE', '/categories/:id', async (req, env, ctx, params) => {
  const { handleDeleteCategory } = await import('./handlers/category');
  return handleDeleteCategory(req, env, params);
}, true);

// Tag routes
addRoute('GET', '/tags', async (req, env) => {
  const { handleListTags } = await import('./handlers/tag');
  return handleListTags(req, env);
});

addRoute('POST', '/tags', async (req, env) => {
  const { handleCreateTag } = await import('./handlers/tag');
  return handleCreateTag(req, env);
}, true);

addRoute('DELETE', '/tags/:id', async (req, env, ctx, params) => {
  const { handleDeleteTag } = await import('./handlers/tag');
  return handleDeleteTag(req, env, params);
}, true);

// Comment routes
addRoute('GET', '/articles/:article_id/comments', async (req, env, ctx, params) => {
  const { handleListComments } = await import('./handlers/comment');
  return handleListComments(req, env, params);
});

addRoute('POST', '/articles/:article_id/comments', async (req, env, ctx, params) => {
  const { handleSubmitComment } = await import('./handlers/comment');
  return handleSubmitComment(req, env, ctx, params);
});

addRoute('GET', '/comments', async (req, env) => {
  const { handleListAllComments } = await import('./handlers/comment');
  return handleListAllComments(req, env);
}, true);

addRoute('PUT', '/comments/:id/approve', async (req, env, ctx, params) => {
  const { handleApproveComment } = await import('./handlers/comment');
  return handleApproveComment(req, env, params);
}, true);

addRoute('PUT', '/comments/:id/reject', async (req, env, ctx, params) => {
  const { handleRejectComment } = await import('./handlers/comment');
  return handleRejectComment(req, env, params);
}, true);

addRoute('DELETE', '/comments/:id', async (req, env, ctx, params) => {
  const { handleDeleteComment } = await import('./handlers/comment');
  return handleDeleteComment(req, env, params);
}, true);

// Search route
addRoute('GET', '/search', async (req, env) => {
  const { handleSearch } = await import('./handlers/search');
  return handleSearch(req, env);
});

// Like routes
addRoute('POST', '/articles/:article_id/like', async (req, env, ctx, params) => {
  const { handleToggleLike } = await import('./handlers/like');
  return handleToggleLike(req, env, ctx, params);
});

addRoute('GET', '/articles/:article_id/like-status', async (req, env, ctx, params) => {
  const { handleLikeStatus } = await import('./handlers/like');
  return handleLikeStatus(req, env, params);
});

// Media routes
addRoute('POST', '/media/upload', async (req, env) => {
  const { handleUploadMedia } = await import('./handlers/media');
  return handleUploadMedia(req, env);
}, true);

addRoute('GET', '/media', async (req, env) => {
  const { handleListMedia } = await import('./handlers/media');
  return handleListMedia(req, env);
}, true);

addRoute('DELETE', '/media/:id', async (req, env, ctx, params) => {
  const { handleDeleteMedia } = await import('./handlers/media');
  return handleDeleteMedia(req, env, params);
}, true);

// Config routes
addRoute('GET', '/config', async (req, env) => {
  const { handleGetPublicConfig } = await import('./handlers/config');
  return handleGetPublicConfig(req, env);
});

addRoute('GET', '/config/all', async (req, env) => {
  const { handleGetAllConfig } = await import('./handlers/config');
  return handleGetAllConfig(req, env);
}, true);

addRoute('PUT', '/config', async (req, env) => {
  const { handleUpdateConfig } = await import('./handlers/config');
  return handleUpdateConfig(req, env);
}, true);

// Friend link routes
addRoute('GET', '/friend-links', async (req, env) => {
  const { handleListFriendLinks } = await import('./handlers/friend_link');
  return handleListFriendLinks(req, env);
});

addRoute('GET', '/friend-links/all', async (req, env) => {
  const { handleListAllFriendLinks } = await import('./handlers/friend_link');
  return handleListAllFriendLinks(req, env);
}, true);

addRoute('POST', '/friend-links', async (req, env) => {
  const { handleCreateFriendLink } = await import('./handlers/friend_link');
  return handleCreateFriendLink(req, env);
}, true);

addRoute('PUT', '/friend-links/:id', async (req, env, ctx, params) => {
  const { handleUpdateFriendLink } = await import('./handlers/friend_link');
  return handleUpdateFriendLink(req, env, params);
}, true);

addRoute('DELETE', '/friend-links/:id', async (req, env, ctx, params) => {
  const { handleDeleteFriendLink } = await import('./handlers/friend_link');
  return handleDeleteFriendLink(req, env, params);
}, true);

// Admin routes
addRoute('GET', '/admin/export', async (req, env) => {
  const { handleExport } = await import('./handlers/admin');
  return handleExport(req, env);
}, true);

addRoute('POST', '/admin/import', async (req, env) => {
  const { handleImport } = await import('./handlers/admin');
  return handleImport(req, env);
}, true);