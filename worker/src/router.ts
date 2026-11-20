import { corsMiddleware, withCors } from "./middleware/cors";
import { withSecurityHeaders } from "./middleware/security_headers";
import { rateLimitMiddleware } from "./middleware/rate_limit";
import { authMiddleware } from "./middleware/auth";
import type { AuthResult } from "./middleware/auth";
import { forbidden } from "./utils/response";
import {
  handleLogin,
  handleRefresh,
  handleChangePassword,
  handleListUsers,
  handleCreateUser,
  handleUpdateUser,
  handleDeleteUser,
} from "./handlers/auth_handler";
import {
  handleListArticles,
  handleGetArticle,
  handleGetArticleForEdit,
  handleCreateArticle,
  handleUpdateArticle,
  handleDeleteArticle,
} from "./handlers/article";
import {
  handleListCategories,
  handleGetCategory,
  handleCreateCategory,
  handleUpdateCategory,
  handleDeleteCategory,
} from "./handlers/category";
import {
  handleListTags,
  handleGetTag,
  handleCreateTag,
  handleUpdateTag,
  handleDeleteTag,
} from "./handlers/tag";
import {
  handleListComments,
  handleSubmitComment,
  handleListAllComments,
  handleApproveComment,
  handleRejectComment,
  handleDeleteComment,
} from "./handlers/comment";
import { handleSearch } from "./handlers/search";
import { handleToggleLike, handleLikeStatus } from "./handlers/like";
import {
  handleUploadMedia,
  handleListMedia,
  handleDeleteMedia,
  handleServeMedia,
} from "./handlers/media";
import {
  handleGetPublicConfig,
  handleGetAllConfig,
  handleUpdateConfig,
} from "./handlers/config";
import {
  handleGetPublicSettings,
  handleGetSettings,
  handleUpdateSettings,
  handleResetSettings,
  handleExportSettings,
  handleImportSettings,
} from "./handlers/settings";
import { handleImgProxy } from "./handlers/img_proxy";
import { handleTextProxy } from "./handlers/text_proxy";
import { handleScrape } from "./handlers/scrape";
import {
  handleListFriendLinks,
  handleListAllFriendLinks,
  handleCreateFriendLink,
  handleUpdateFriendLink,
  handleDeleteFriendLink,
} from "./handlers/friend_link";
import { handleExport, handleImport } from "./handlers/admin";
import { handleReconcileCounters } from "./handlers/reconcile";
import {
  handleAnalyticsOverview,
  handleAnalyticsDimensions,
  handleAnalyticsArticles,
  handleAnalyticsQuality,
  handleAnalyticsTrend,
} from "./handlers/analytics";
import {
  handleAcquireLock,
  handleReleaseLock,
  handleGetLockStatus,
  handleForceReleaseLock,
} from "./handlers/edit_lock";
import { Env } from "./index";

type Handler = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
  authResult?: AuthResult
) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
  requireAuth: boolean;
  requireAdmin: boolean;
}

// issue #100 / M20：按 method 分桶（同时完成 L10 的同域工作，L10 关闭时引用本实现）。
// 旧实现是单一线性数组 + 每次 matchRoute 过滤 method——注册顺序敏感且白扫无关方法。
// 用 Map 而非 {}：method 来自 request.method，若为 `constructor` / `__proto__`
// 等原型属性名，普通对象的 `?? []` 会命中继承属性并对非数组执行 for...of → 500。
// Map 无原型链，未知 method 落到空桶 → 404（与 admin 导入表白名单的同类防护一致）。
const routesByMethod = new Map<string, Route[]>();

/** 正则元字符转义（路径字面量不当作正则） */
function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 路由路径编译（issue #100 / M20）。
 *
 * - `:id` / `:article_id` / `:comment_id` 等以 `id` 结尾的参数编译为 `(\d+)`，
 *   非法 id 直接不匹配（404），不进入 handler `bind(NaN)`；
 * - `:slug` 编译为 URL-safe 字符集 + 百分号编码（`%[0-9A-Fa-f]{2}`，兼容中文 slug），
 *   拒绝**未编码的**尖括号 / 引号 / 空格等注入字符。编码后的 `%3C` 等属合法 URL
 *   编码（中文 slug 同样靠它），解码内容由 handler 的参数绑定 + 前端 escapeHtml
 *   保证安全，不在路由层二次拒绝；
 * - 其余 `:name` 保守编译为 `[^/]+`（既有行为不变）；
 * - `*path` 通配具名，regex 为 `(.+)`；
 * - 路径中的正则元字符（. + ? 等）一律转义为字面量。
 */
export function compileRoutePath(path: string): {
  pattern: RegExp;
  paramNames: string[];
} {
  const paramNames: string[] = [];
  let source = "";
  let i = 0;
  while (i < path.length) {
    const ch = path[i];
    if (ch === ":" || ch === "*") {
      let end = i + 1;
      while (end < path.length && path[end] !== "/") end += 1;
      const name = path.slice(i + 1, end);
      if (!name) {
        // 零散符号按字面量处理（不应出现）
        source += escapeRegExpLiteral(ch);
        i += 1;
        continue;
      }
      paramNames.push(name);
      if (ch === "*") {
        source += "(.+)";
      } else if (name === "id" || name.endsWith("_id")) {
        source += "(\\d+)";
      } else if (name === "slug" || name.endsWith("_slug")) {
        // URL-safe 字符（含点号 / 波浪号，兼容 v1.0 这类存量 slug）+ 百分号编码；
        // 中文 slug 在 pathname 中是 %xx 形式（大小写 hex 均接受）。
        source += "((?:[A-Za-z0-9._~-]|%[0-9A-Fa-f]{2})+)";
      } else {
        source += "([^/]+)";
      }
      i = end;
    } else {
      source += escapeRegExpLiteral(ch);
      i += 1;
    }
  }
  return { pattern: new RegExp(`^${source}$`), paramNames };
}

// P1-5 / issue #8 建立；#83 / H1 收严：须改密会话在改密前拒绝**所有鉴权请求**
// （含 GET 类管理接口），仅保留令牌续期与改密两个豁免路径。
// 不再按 HTTP 方法区分——读接口同样能泄露配置/用户/统计数据，旧口径只拦写方法留下缺口。
const MUST_CHANGE_PASSWORD_EXEMPT_PATHS = new Set([
  "/auth/refresh",
  "/auth/change-password",
]);

function addRoute(
  method: string,
  path: string,
  handler: Handler,
  requireAuth = false,
  requireAdmin = false
): void {
  const { pattern, paramNames } = compileRoutePath(path);
  const bucket = routesByMethod.get(method) ?? [];
  bucket.push({
    method,
    pattern,
    paramNames,
    handler,
    requireAuth,
    requireAdmin,
  });
  routesByMethod.set(method, bucket);
}

export function matchRoute(
  method: string,
  pathname: string
): {
  handler: Handler;
  params: Record<string, string>;
  requireAuth: boolean;
  requireAdmin: boolean;
} | null {
  // 只遍历该 method 的桶（issue #100 / M20，兼 L10 method 分桶）
  // issue #113 / M20：HEAD 与 GET 同桶——HEAD 无独立路由时复用 GET 桶（响应体由平台剥离）
  const bucket =
    routesByMethod.get(method) ??
    (method === "HEAD" ? routesByMethod.get("GET") : undefined) ??
    [];
  for (const route of bucket) {
    const match = pathname.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        try {
          params[name] = decodeURIComponent(match[i + 1]);
        } catch {
          // Malformed % sequence → treat as raw string (fail-safe, not fail-open)
          params[name] = match[i + 1] || "";
        }
      });
      return {
        handler: route.handler,
        params,
        requireAuth: route.requireAuth,
        requireAdmin: route.requireAdmin,
      };
    }
  }
  return null;
}

addRoute("GET", "/health", async (_req, env) => {
  try {
    const dbTest = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM site_config"
    ).first();
    return Response.json({
      status: "ok",
      db: dbTest ? "connected" : "error",
      kv: "connected",
    });
  } catch (e) {
    console.error("Health check failed:", e);
    return Response.json({ status: "error" });
  }
});

addRoute("POST", "/auth/login", async (req, env) => handleLogin(req, env));
addRoute(
  "POST",
  "/auth/refresh",
  async (req, env, _ctx, _params) => handleRefresh(req, env),
  true
);
addRoute(
  "POST",
  "/auth/change-password",
  async (req, env, _ctx, _params, auth) => handleChangePassword(req, env, auth),
  true
);
addRoute(
  "GET",
  "/users",
  async (req, env) => handleListUsers(req, env),
  true,
  true
);
addRoute(
  "POST",
  "/users",
  async (req, env) => handleCreateUser(req, env),
  true,
  true
);
addRoute(
  "PUT",
  "/users/:id",
  async (req, env, _ctx, params) => handleUpdateUser(req, env, params),
  true,
  true
);
addRoute(
  "DELETE",
  "/users/:id",
  async (req, env, _ctx, params, auth) =>
    handleDeleteUser(req, env, params, auth),
  true,
  true
);

addRoute("GET", "/articles", async (req, env, _ctx, params, auth) =>
  handleListArticles(req, env, params, auth)
);
// issue #63 / ADR 0006：编辑器按稳定 id 取正文（需 Bearer 鉴权）。
// 两段路径 /articles/:id/edit 不会命中单段 /articles/:slug 的正则；
// 独立 handler 也不经过公开详情的阅读统计 / view_<id> Cookie 链路。
addRoute(
  "GET",
  "/articles/:id/edit",
  async (req, env, _ctx, params, auth) =>
    handleGetArticleForEdit(req, env, params, auth),
  true
);
addRoute("GET", "/articles/:slug", async (req, env, _ctx, params, auth) =>
  handleGetArticle(req, env, params, auth)
);
addRoute(
  "POST",
  "/articles",
  async (req, env, _ctx, params, auth) =>
    handleCreateArticle(req, env, params, auth),
  true
);
addRoute(
  "PUT",
  "/articles/:id",
  async (req, env, _ctx, params, auth) =>
    handleUpdateArticle(req, env, params, auth),
  true
);
addRoute(
  "DELETE",
  "/articles/:id",
  async (req, env, _ctx, params, auth) =>
    handleDeleteArticle(req, env, params, auth),
  true
);

addRoute("GET", "/categories", async (req, env) =>
  handleListCategories(req, env)
);
// taxonomy v2 / #78：分类详情（:slug 分型只匹配 URL-safe 字符，与 :id 写路由不同桶不冲突）
addRoute("GET", "/categories/:slug", async (req, env, _ctx, params) =>
  handleGetCategory(req, env, _ctx, params)
);
addRoute(
  "POST",
  "/categories",
  async (req, env, _ctx, params, auth) =>
    handleCreateCategory(req, env, params, auth),
  true
);
addRoute(
  "PUT",
  "/categories/:id",
  async (req, env, _ctx, params, auth) =>
    handleUpdateCategory(req, env, params, auth),
  true
);
addRoute(
  "DELETE",
  "/categories/:id",
  async (req, env, _ctx, params) => handleDeleteCategory(req, env, params),
  true,
  true
);

addRoute("GET", "/tags", async (req, env) => handleListTags(req, env));
// taxonomy v2 / #78：标签详情（GET 桶内无 /tags/:id 读路由，与 DELETE /tags/:id 不同 method 不冲突）
addRoute("GET", "/tags/:slug", async (req, env, _ctx, params) =>
  handleGetTag(req, env, _ctx, params)
);
addRoute(
  "POST",
  "/tags",
  async (req, env, _ctx, params, auth) =>
    handleCreateTag(req, env, _ctx, params, auth),
  true
);
// taxonomy v2 / #79：移动标签归属（只消费 category_id，不改 name/slug）
addRoute(
  "PUT",
  "/tags/:id",
  async (req, env, _ctx, params, auth) =>
    handleUpdateTag(req, env, _ctx, params, auth),
  true
);
addRoute(
  "DELETE",
  "/tags/:id",
  async (req, env, _ctx, params) => handleDeleteTag(req, env, params),
  true,
  true
);

addRoute(
  "GET",
  "/articles/:article_id/comments",
  async (req, env, _ctx, params) => handleListComments(req, env, params)
);
addRoute(
  "POST",
  "/articles/:article_id/comments",
  async (req, env, ctx, params) => handleSubmitComment(req, env, ctx, params)
);
addRoute(
  "GET",
  "/comments",
  async (req, env, _ctx, params, auth) =>
    handleListAllComments(req, env, _ctx, params, auth),
  true
);
addRoute(
  "PUT",
  "/comments/:id/approve",
  async (req, env, _ctx, params, auth) =>
    handleApproveComment(req, env, params, auth),
  true
);
addRoute(
  "PUT",
  "/comments/:id/reject",
  async (req, env, _ctx, params, auth) =>
    handleRejectComment(req, env, params, auth),
  true
);
addRoute(
  "DELETE",
  "/comments/:id",
  async (req, env, _ctx, params, auth) =>
    handleDeleteComment(req, env, params, auth),
  true
);

addRoute("GET", "/search", async (req, env) => handleSearch(req, env));

addRoute("POST", "/articles/:article_id/like", async (req, env, ctx, params) =>
  handleToggleLike(req, env, ctx, params)
);
addRoute(
  "GET",
  "/articles/:article_id/like-status",
  async (req, env, _ctx, params) => handleLikeStatus(req, env, params)
);

addRoute(
  "POST",
  "/media/upload",
  async (req, env, _ctx, params, auth) =>
    handleUploadMedia(req, env, _ctx, params, auth),
  true
);
addRoute(
  "GET",
  "/media",
  async (req, env, _ctx, params, auth) =>
    handleListMedia(req, env, _ctx, params, auth),
  true
);
addRoute(
  "DELETE",
  "/media/:id",
  async (req, env, _ctx, params, auth) =>
    handleDeleteMedia(req, env, params, auth),
  true
);
// issue #100 / M20：通配参数具名 path（旧实现硬编码数字下标）
addRoute("GET", "/media/serve/*path", async (req, env, _ctx, params) =>
  handleServeMedia(req, env, params)
);

// 外链图片智能代理（前端 img 直连失败时自动降级到本站代理，带安全校验与 KV TTL 缓存）
addRoute("GET", "/img-proxy", async (req, env, ctx) =>
  handleImgProxy(req, env, ctx)
);

// 外链文字/接口内容代理（前端 fetch 直连失败/CORS 受限时自动降级，text/json/xml 白名单 + CORS 头）
addRoute("GET", "/text-proxy", async (req, env, ctx) =>
  handleTextProxy(req, env, ctx)
);

// 网页抓取代理（admin-only；SSRF/robots/2MB/10s/每管理员限流；#33 / ADR 0003）
addRoute(
  "GET",
  "/admin/scrape",
  async (req, env, ctx, _params, auth) => handleScrape(req, env, ctx, auth),
  true,
  true
);

addRoute("GET", "/config", async (req, env) => handleGetPublicConfig(req, env));
addRoute(
  "GET",
  "/config/all",
  async (req, env) => handleGetAllConfig(req, env),
  true,
  true
);
addRoute(
  "PUT",
  "/config",
  async (req, env) => handleUpdateConfig(req, env),
  true,
  true
);

// 全站可视化配置中心
// 渗透报告 004 修复：/settings 完整视图收为管理员鉴权；前台只走 /settings/public 白名单投影
addRoute("GET", "/settings/public", async (req, env) =>
  handleGetPublicSettings(req, env)
);
addRoute(
  "GET",
  "/settings",
  async (req, env) => handleGetSettings(req, env),
  true,
  true
);
addRoute(
  "GET",
  "/settings/all",
  async (req, env) => handleGetSettings(req, env),
  true,
  true
);
addRoute(
  "PUT",
  "/settings",
  async (req, env) => handleUpdateSettings(req, env),
  true,
  true
);
addRoute(
  "POST",
  "/settings/reset",
  async (req, env) => handleResetSettings(req, env),
  true,
  true
);
addRoute(
  "GET",
  "/settings/export",
  async (req, env) => handleExportSettings(req, env),
  true,
  true
);
addRoute(
  "POST",
  "/settings/import",
  async (req, env) => handleImportSettings(req, env),
  true,
  true
);

addRoute("GET", "/friend-links", async (req, env) =>
  handleListFriendLinks(req, env)
);
addRoute(
  "GET",
  "/friend-links/all",
  async (req, env) => handleListAllFriendLinks(req, env),
  true
);
// C1 / issue #43：友链写操作收归 admin（editor 可写曾导致全站页脚存储型 XSS）
addRoute(
  "POST",
  "/friend-links",
  async (req, env) => handleCreateFriendLink(req, env),
  true,
  true
);
addRoute(
  "PUT",
  "/friend-links/:id",
  async (req, env, _ctx, params) => handleUpdateFriendLink(req, env, params),
  true,
  true
);
addRoute(
  "DELETE",
  "/friend-links/:id",
  async (req, env, _ctx, params) => handleDeleteFriendLink(req, env, params),
  true,
  true
);

addRoute(
  "GET",
  "/admin/export",
  async (req, env) => handleExport(req, env),
  true,
  true
);
addRoute(
  "POST",
  "/admin/import",
  async (req, env) => handleImport(req, env),
  true,
  true
);
// #72 / M9：手动计数器对账入口（admin-only；与 export/import 同一鉴权口径）
addRoute(
  "POST",
  "/admin/reconcile-counters",
  async (req, env) => handleReconcileCounters(req, env),
  true,
  true
);

// 阅读统计概览 / 分布 / 明细 / 质量 / 趋势（issue #55–#58）：站级数据只对 admin 开放
addRoute(
  "GET",
  "/admin/analytics/overview",
  async (req, env) => handleAnalyticsOverview(req, env),
  true,
  true
);
addRoute(
  "GET",
  "/admin/analytics/dimensions",
  async (req, env) => handleAnalyticsDimensions(req, env),
  true,
  true
);
addRoute(
  "GET",
  "/admin/analytics/articles",
  async (req, env) => handleAnalyticsArticles(req, env),
  true,
  true
);
addRoute(
  "GET",
  "/admin/analytics/quality",
  async (req, env) => handleAnalyticsQuality(req, env),
  true,
  true
);
addRoute(
  "GET",
  "/admin/analytics/trend",
  async (req, env) => handleAnalyticsTrend(req, env),
  true,
  true
);

addRoute(
  "POST",
  "/articles/:id/edit-lock",
  async (req, env, _ctx, params, auth) =>
    handleAcquireLock(req, env, _ctx, params, auth),
  true
);
addRoute(
  "DELETE",
  "/articles/:id/edit-lock",
  async (req, env, _ctx, params, auth) =>
    handleReleaseLock(req, env, _ctx, params, auth),
  true
);
addRoute(
  "GET",
  "/articles/:id/edit-lock",
  async (req, env, _ctx, params, auth) =>
    handleGetLockStatus(req, env, _ctx, params, auth),
  true
);
addRoute(
  "POST",
  "/articles/:id/edit-lock/force",
  async (req, env, _ctx, params, auth) =>
    handleForceReleaseLock(req, env, _ctx, params, auth),
  true,
  true
);

export async function router(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const apiPrefix = env.API_PREFIX || "/api/v1";
  const pathname = url.pathname.slice(apiPrefix.length) || "/";
  const method = request.method;

  try {
    const corsResponse = corsMiddleware(request);
    if (corsResponse) return withSecurityHeaders(corsResponse);

    const rateLimitResponse = await rateLimitMiddleware(request, env, ctx);
    if (rateLimitResponse)
      return withSecurityHeaders(withCors(rateLimitResponse, request));

    const matched = matchRoute(method, pathname);
    if (!matched) {
      return withSecurityHeaders(
        withCors(
          Response.json(
            {
              code: 404,
              message: `API not found: ${method} ${pathname}`,
              data: null,
            },
            { status: 404 }
          ),
          request
        )
      );
    }

    let authResult: AuthResult | undefined;
    if (matched.requireAuth) {
      const result = await authMiddleware(request, env);
      if (result instanceof Response)
        return withSecurityHeaders(withCors(result, request));
      if (matched.requireAdmin && result.user.role !== "admin") {
        return withSecurityHeaders(
          withCors(forbidden("权限不足，仅管理员可执行此操作"), request)
        );
      }
      // #83 / H1：会话级闸门——须改密会话的任何鉴权请求一律 403，
      // 含 GET 类管理接口；仅两个豁免路径可达。
      if (
        result.user.mustChangePassword &&
        !MUST_CHANGE_PASSWORD_EXEMPT_PATHS.has(pathname)
      ) {
        return withSecurityHeaders(
          withCors(
            forbidden("账号仍在使用初始口令，请先修改口令后再执行管理操作"),
            request
          )
        );
      }
      authResult = result.user;
    } else if (request.headers.get("Authorization")) {
      // 公开路由可选鉴权：携带合法 token 时解析出来，供草稿预览等场景使用；无 token/无效 token 不影响公开访问
      const result = await authMiddleware(request, env);
      if (!(result instanceof Response)) authResult = result.user;
    }

    const response = await matched.handler(
      request,
      env,
      ctx,
      matched.params,
      authResult
    );
    return withSecurityHeaders(withCors(response, request));
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Router error:", errMsg);
    return withSecurityHeaders(
      withCors(
        Response.json(
          { code: 500, message: "Internal server error", data: null },
          { status: 500 }
        ),
        request
      )
    );
  }
}
