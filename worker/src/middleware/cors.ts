/**
 * CORS 中间件（安全收敛版）
 *
 * 修复渗透报告 001「CORS 全方法通配配置」：
 * - Origin 白名单精确匹配，移除 *.pages.dev 后缀通配（任何 pages.dev 站点此前都被信任）
 * - 预检只允许白名单 Origin 回显 ACAO；非白名单不再返回空 ACAO 头
 * - 所有响应带 Vary: Origin，防止缓存串源
 * - 方法/头收敛到后台 API 实际用到的集合（不再语义上的“全放行”）
 */

const ALLOWED_ORIGINS = [
  'https://blog.zenfishlog.dpdns.org',
  'https://blog-website-page.pages.dev',
  // 本地开发
  'http://localhost:4321',
  'http://127.0.0.1:4321',
];

// 后台 API 实际使用的方法与请求头集合（最小可用，不含 *）
const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization';
const MAX_AGE = '86400';

/** 仅当 Origin 在白名单中时返回该 Origin，否则返回 null（含无 Origin 的同源请求） */
function resolveAllowedOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

export function corsMiddleware(request: Request): Response | null {
  if (request.method !== 'OPTIONS') return null;

  const headers = new Headers({
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Max-Age': MAX_AGE,
    'Vary': 'Origin',
  });
  const origin = resolveAllowedOrigin(request);
  // 非白名单 Origin：不回显 ACAO，浏览器将拦截后续跨域请求
  if (origin) headers.set('Access-Control-Allow-Origin', origin);

  return new Response(null, { status: 204, headers });
}

export function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  headers.set('Vary', 'Origin');
  const origin = resolveAllowedOrigin(request);
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
