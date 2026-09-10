import { Env } from '../index';

/**
 * 外链图片智能代理（GET /img-proxy?url=...）
 *
 * 设计目标：
 * 1. 外链图片因防盗链（Referer 校验）、域名失效等无法直接显示时，前端 img onerror
 *    自动把 src 换成本站 /api/v1/img-proxy?url=<原图>，由本 handler 代理拉取。
 * 2. 安全性：
 *    - 仅接受 http/https，URL 长度限制；
 *    - 拒绝内网/保留地址（IPv4 私有段、IPv6 唯一本地/链路本地、localhost、内部域名、
 *      workers.dev 递归代理等），双保险防 SSRF；
 *    - 请求头净化：去掉 Referer/Cookie，防被当作中间人带出敏感上下文；
 *    - 仅允许图片 Content-Type，响应体大小上限 10MB，防开放代理滥用；
 *    - 每 IP 独立限流（默认 120 次/分钟）。
 * 3. 用户体验：命中 KV 缓存直接返回（浏览器侧再配 Cache-Control），代理仅在直连失败
 *    时触发，用户基本无感。
 * 4. 缓存自动过期删除：KV 写入带 expirationTtl（24h），过期由 KV 自动清理，无需手动删。
 */

const ALLOWED_IMAGE_MIME = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
  'image/svg+xml', 'image/x-icon', 'image/bmp', 'image/tiff', 'image/jxl',
];

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_URL_LEN = 2048;
export const CACHE_TTL = 60 * 60 * 24; // 24h，到期 KV 自动删除
export const FETCH_TIMEOUT_MS = 10_000;
export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX = 120; // 每 IP 每分钟

// 拒绝的域名：内部/保留/示例域名，及 Cloudflare workers.dev（防递归代理本站 API）
export const BLOCKED_HOST_RE = /(^|\.)(localhost|local|internal|intranet|example\.com|example\.org|example\.net|test|invalid|onion|home|lan)$/i;
export const WORKERS_DEV_RE = /\.workers\.dev$/i;

export function isBlockedIp(host: string): boolean {
  // IPv6 字面量 [::1] 形式
  const h = host.replace(/^\[|\]$/g, '');
  if (/^[0-9.]+$/.test(h)) {
    return (
      /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || /^0\./.test(h) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)
    );
  }
  return /^::1$/.test(h) || /^::$/.test(h) || /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Real-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handleImgProxy(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const target = url.searchParams.get('url') || '';

  if (!target || target.length > MAX_URL_LEN) {
    return Response.json({ code: 400, message: 'url 参数缺失或过长', data: null }, { status: 400 });
  }

  let tu: URL;
  try {
    tu = new URL(target);
  } catch {
    return Response.json({ code: 400, message: 'url 参数不是合法地址', data: null }, { status: 400 });
  }

  if (tu.protocol !== 'https:' && tu.protocol !== 'http:') {
    return Response.json({ code: 400, message: '仅支持 http/https', data: null }, { status: 400 });
  }

  const host = tu.hostname.toLowerCase();
  if (BLOCKED_HOST_RE.test(host) || WORKERS_DEV_RE.test(host) || isBlockedIp(host)) {
    return Response.json({ code: 403, message: '目标地址被禁止代理', data: null }, { status: 403 });
  }

  // 每 IP 限流（独立于全局 rate_limit，避免拖垮普通图片直连）
  const ip = clientIp(request);
  const rlKey = `imgproxy:${ip}:${Math.floor(Date.now() / RATE_WINDOW_MS)}`;
  const rlCount = parseInt((await env.RATE_LIMIT.get(rlKey)) || '0', 10);
  if (rlCount >= RATE_MAX) {
    return Response.json({ code: 429, message: '代理请求过于频繁，请稍后再试', data: null }, { status: 429 });
  }
  ctx.waitUntil(env.RATE_LIMIT.put(rlKey, String(rlCount + 1), { expirationTtl: 60 }));

  // KV 缓存（TTL 到期自动删除 = 过期内容自动清理）
  const cacheKey = `imgproxy/${await sha1Hex(target)}`;
  const cached = await env.MEDIA.getWithMetadata(cacheKey, { type: 'arrayBuffer' });
  if (cached.value) {
    const meta = (cached.metadata as { ct?: string } | null) || {};
    return new Response(cached.value, {
      status: 200,
      headers: {
        'Content-Type': meta.ct || 'image/*',
        'Cache-Control': `public, max-age=${CACHE_TTL}`,
        'X-Img-Proxy': 'cache-hit',
      },
    });
  }

  // 拉取目标（净化请求头：去 Referer/Cookie，标准 UA，防防盗链与被带出上下文）
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(tu.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
  } catch {
    return Response.json({ code: 502, message: '上游图片拉取失败', data: null }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }

  if (!upstream.ok) {
    return Response.json({ code: upstream.status, message: `上游返回 ${upstream.status}`, data: null }, { status: 502 });
  }

  const contentType = (upstream.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_MIME.includes(contentType)) {
    return Response.json({ code: 415, message: '目标不是受支持的图片类型', data: null }, { status: 415 });
  }

  const declaredLen = parseInt(upstream.headers.get('Content-Length') || '0', 10);
  if (declaredLen > MAX_FILE_SIZE) {
    return Response.json({ code: 413, message: '图片超过 10MB 限制', data: null }, { status: 413 });
  }

  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_FILE_SIZE) {
    return Response.json({ code: 413, message: '图片超过 10MB 限制', data: null }, { status: 413 });
  }

  // 写入 KV 缓存（TTL 自动过期删除）
  ctx.waitUntil(
    env.MEDIA.put(cacheKey, body, { expirationTtl: CACHE_TTL, metadata: { ct: contentType } })
  );

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${CACHE_TTL}`,
      'X-Img-Proxy': 'cache-miss',
    },
  });
}
