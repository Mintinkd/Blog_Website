import { Env } from "../index";
import { rateLimited } from "../utils/response";
import { getClientIpString } from "../utils/client_ip";
import { consumeRateLimit, type RateLimitConfig } from "../utils/rate_limiter";

// 限流规则：method + 规范化路由模板（精确匹配）——issue #48 / H8 的分桶成果，
// 本票 #91 只替换底层算法（滑动窗口计数 + await 写），保留分桶口径。
// 模板里的资源 id 段统一归一为 :id，同一路由下不同资源 id 共享一个计数桶。
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // 较贵的查询：/search 与文章详情（每次访问写 D1）参与限流。
  "GET:/search": { windowMs: 60_000, maxRequests: 10 },
  // issue #91：/articles/:slug 每次访问写 D1（阅读统计），加宽松限流抑制放大。
  // 宽松阈值 120/分不影响真人浏览，仅拦高频抓取。
  "GET:/articles/:slug": { windowMs: 60_000, maxRequests: 120 },

  // 评论：每 IP 每分钟 3 次，跨全部文章共享，遍历 article_id 不能放大配额
  "POST:/articles/:id/comments": { windowMs: 60_000, maxRequests: 3 },
  "POST:/articles/:id/like": { windowMs: 60_000, maxRequests: 10 },
  "POST:/media/upload": { windowMs: 60_000, maxRequests: 10 },

  // 管理 / 鉴权写操作沿用原有 120 次/分
  "POST:/auth/login": { windowMs: 60_000, maxRequests: 120 },
  "POST:/auth/refresh": { windowMs: 60_000, maxRequests: 120 },
  "POST:/auth/change-password": { windowMs: 60_000, maxRequests: 120 },
  "POST:/admin/import": { windowMs: 60_000, maxRequests: 120 },
};

// 未在 RATE_LIMITS 中单列的路由落到按方法定义的明确配额，
// 不再静默借用 GET 配额（issue #48）。原有写操作阈值保持不变。
const METHOD_DEFAULTS: Record<string, RateLimitConfig> = {
  GET: { windowMs: 60_000, maxRequests: 60 },
  POST: { windowMs: 60_000, maxRequests: 60 },
  PUT: { windowMs: 60_000, maxRequests: 60 },
  DELETE: { windowMs: 60_000, maxRequests: 10 },
};

// 把 pathname 归一为路由模板：纯数字资源 id 段替换为 :id。
//   /articles/1/comments   → /articles/:id/comments
//   /articles/hello        → /articles/hello（slug 保留，按文章详情模板限流见下）
function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  return trimmed
    .split("/")
    .map((segment) => (/^\d+$/.test(segment) ? ":id" : segment))
    .join("/");
}

/** 单段文章详情（slug）才走宽松限流；列表 /articles 与两段 /articles/:id/edit 不匹配。 */
function isArticleDetailGet(method: string, pathname: string): boolean {
  return method === "GET" && /^\/articles\/[^/]+$/.test(pathname);
}

// 只对写操作、较贵的查询（GET /search）、文章详情（写 D1）做限流并写 KV。
// 其他普通 GET 读接口跳过，避免把 KV 写入量随访问量放大。
const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE"]);

export async function rateLimitMiddleware(
  request: Request,
  env: Env,
  _ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  const apiPrefix = env.API_PREFIX || "/api/v1";
  const pathname = url.pathname.slice(apiPrefix.length) || "/";
  const method = request.method;

  const isMutation = MUTATING_METHODS.has(method);
  const isExpensiveGet = method === "GET" && pathname.includes("/search");
  const isArticleGet = isArticleDetailGet(method, pathname);
  if (!isMutation && !isExpensiveGet && !isArticleGet) {
    return null;
  }

  const normalizedPathname = normalizePathname(pathname);
  // 文章详情 slug 归一到固定模板键，避免每个 slug 各占一个桶（否则限流形同虚设）。
  const template = isArticleGet ? "/articles/:slug" : normalizedPathname;
  const config =
    RATE_LIMITS[`${method}:${template}`] ?? METHOD_DEFAULTS[method];
  if (!config) {
    return null;
  }

  const ip = await getClientIpString(request, env.VISITOR_IP_SIGNING_SECRET);
  const verdict = await consumeRateLimit(env.RATE_LIMIT, {
    scope: "global",
    // 用 template 而非原始 slug：每 IP 跨所有文章详情共享一个桶
    // （与 H8 评论跨 article_id 共享同哲学），遍历 slug 不能放大 D1 写放大。
    identity: `${ip}:${method}:${template}`,
    config,
    nowMs: Date.now(),
  });

  if (!verdict.allowed) {
    return rateLimited(
      `Rate limit exceeded. Max ${config.maxRequests} requests per minute.`
    );
  }
  return null;
}
