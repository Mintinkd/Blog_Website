import { Env } from '../index';
import { rateLimited } from '../utils/response';

interface RateLimitConfig {
  window_ms: number;
  max_requests: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'GET': { window_ms: 60000, max_requests: 60 },
  'POST:/comments': { window_ms: 60000, max_requests: 3 },
  'POST:/like': { window_ms: 60000, max_requests: 10 },
  'POST:/media': { window_ms: 60000, max_requests: 10 },
  'ADMIN': { window_ms: 60000, max_requests: 120 },
};

function getClientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown';
}

// 只对「写操作（POST/PUT/DELETE）」与「较贵的查询（GET /search）」做限流并写入 KV。
// 普通 GET 读接口（文章列表、配置、友情链接、媒体读取等，前端每次页面加载都会调用）
// 一律跳过限流，避免把 KV 写入量随访问量被放大。限流计数存放在独立的 RATE_LIMIT
// 命名空间，不再污染存放媒体文件的 MEDIA 库。
const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE']);

export async function rateLimitMiddleware(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  const apiPrefix = env.API_PREFIX || '/api/v1';
  const pathname = url.pathname.slice(apiPrefix.length) || '/';
  const method = request.method;

  const isMutation = MUTATING_METHODS.has(method);
  const isExpensiveGet = method === 'GET' && pathname.includes('/search');
  if (!isMutation && !isExpensiveGet) {
    return null;
  }

  let config: RateLimitConfig;
  if (pathname.includes('/comments') && method === 'POST') {
    config = RATE_LIMITS['POST:/comments'];
  } else if (pathname.includes('/like') && method === 'POST') {
    config = RATE_LIMITS['POST:/like'];
  } else if (pathname.includes('/media') && method === 'POST') {
    config = RATE_LIMITS['POST:/media'];
  } else if (pathname.includes('/admin') || pathname.includes('/auth')) {
    config = RATE_LIMITS['ADMIN'];
  } else {
    config = RATE_LIMITS[method] || RATE_LIMITS['GET'];
  }

  const ip = getClientIp(request);
  const key = `rate_limit:${ip}:${pathname}:${Math.floor(Date.now() / config.window_ms)}`;

  const current = parseInt((await env.RATE_LIMIT.get(key)) || '0', 10);
  if (current >= config.max_requests) {
    return rateLimited(`Rate limit exceeded. Max ${config.max_requests} requests per minute.`);
  }

  ctx.waitUntil(
    env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: Math.ceil(config.window_ms / 1000) })
  );

  return null;
}
