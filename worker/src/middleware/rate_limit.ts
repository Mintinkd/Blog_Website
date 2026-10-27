import { Env } from "../index";
import { rateLimited } from "../utils/response";

interface RateLimitConfig {
  window_ms: number;
  max_requests: number;
}

// 限流规则：method + 规范化路由模板（精确匹配）。
// 模板里的资源 id 段统一归一为 :id，同一路由下不同资源 id 共享一个计数桶。
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // 较贵的查询：只有 /search 参与限流
  "GET:/search": { window_ms: 60000, max_requests: 10 },

  // 评论：每 IP 每分钟 3 次，跨全部文章共享，遍历 article_id 不能放大配额
  "POST:/articles/:id/comments": { window_ms: 60000, max_requests: 3 },
  "POST:/articles/:id/like": { window_ms: 60000, max_requests: 10 },
  "POST:/media/upload": { window_ms: 60000, max_requests: 10 },

  // 管理 / 鉴权写操作沿用原有 120 次/分
  "POST:/auth/login": { window_ms: 60000, max_requests: 120 },
  "POST:/auth/refresh": { window_ms: 60000, max_requests: 120 },
  "POST:/auth/change-password": { window_ms: 60000, max_requests: 120 },
  "POST:/admin/import": { window_ms: 60000, max_requests: 120 },
};

// 未在 RATE_LIMITS 中单列的路由落到按方法定义的明确配额，
// 不再静默借用 GET 配额（issue #48）。原有写操作阈值保持不变：
// POST/PUT 60 次/分；DELETE 明确为 10 次/分。
const METHOD_DEFAULTS: Record<string, RateLimitConfig> = {
  GET: { window_ms: 60000, max_requests: 60 },
  POST: { window_ms: 60000, max_requests: 60 },
  PUT: { window_ms: 60000, max_requests: 60 },
  DELETE: { window_ms: 60000, max_requests: 10 },
};

function getClientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

// 把 pathname 归一为路由模板：纯数字资源 id 段替换为 :id。
//   /articles/1/comments   → /articles/:id/comments
//   /articles/1/comments/2 → /articles/:id/comments/:id
//   /articles/1            → /articles/:id
function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  return trimmed
    .split("/")
    .map((segment) => (/^\d+$/.test(segment) ? ":id" : segment))
    .join("/");
}

// 只对「写操作（POST/PUT/DELETE）」与「较贵的查询（GET /search）」做限流并写入 KV。
// 普通 GET 读接口（文章列表、配置、友情链接、媒体读取等，前端每次页面加载都会调用）
// 一律跳过限流，避免把 KV 写入量随访问量被放大。限流计数存放在独立的 RATE_LIMIT
// 命名空间，不再污染存放媒体文件的 MEDIA 库。
const MUTATING_METHODS = new Set(["POST", "PUT", "DELETE"]);

export async function rateLimitMiddleware(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response | null> {
  const url = new URL(request.url);
  const apiPrefix = env.API_PREFIX || "/api/v1";
  const pathname = url.pathname.slice(apiPrefix.length) || "/";
  const method = request.method;

  const isMutation = MUTATING_METHODS.has(method);
  const isExpensiveGet = method === "GET" && pathname.includes("/search");
  if (!isMutation && !isExpensiveGet) {
    return null;
  }

  // 计数键使用规范化路由模板（去掉资源 id），保证遍历资源 id 仍命中同一个桶。
  const normalizedPathname = normalizePathname(pathname);
  const config =
    RATE_LIMITS[`${method}:${normalizedPathname}`] ?? METHOD_DEFAULTS[method];
  if (!config) {
    return null;
  }

  const ip = getClientIp(request);
  const windowStart = Math.floor(Date.now() / config.window_ms);
  const key = `rate_limit:${ip}:${method}:${normalizedPathname}:${windowStart}`;

  const current = parseInt((await env.RATE_LIMIT.get(key)) || "0", 10);
  if (current >= config.max_requests) {
    return rateLimited(
      `Rate limit exceeded. Max ${config.max_requests} requests per minute.`
    );
  }

  ctx.waitUntil(
    env.RATE_LIMIT.put(key, String(current + 1), {
      expirationTtl: Math.ceil(config.window_ms / 1000),
    })
  );

  return null;
}
