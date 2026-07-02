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

export async function rateLimitMiddleware(request: Request, env: Env, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  const apiPrefix = env.API_PREFIX || '/api/v1';
  const pathname = url.pathname.slice(apiPrefix.length) || '/';
  const method = request.method;
  const ip = getClientIp(request);

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

  const key = `rate_limit:${ip}:${pathname}:${Math.floor(Date.now() / config.window_ms)}`;

  const current = parseInt((await env.MEDIA.get(key)) || '0', 10);
  if (current >= config.max_requests) {
    return rateLimited(`Rate limit exceeded. Max ${config.max_requests} requests per minute.`);
  }

  ctx.waitUntil(
    env.MEDIA.put(key, String(current + 1), { expirationTtl: Math.ceil(config.window_ms / 1000) })
  );

  return null;
}