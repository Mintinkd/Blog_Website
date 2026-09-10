import { Env } from '../index';
import {
  BLOCKED_HOST_RE,
  WORKERS_DEV_RE,
  isBlockedIp,
  clientIp,
  sha1Hex,
  MAX_FILE_SIZE,
  MAX_URL_LEN,
  CACHE_TTL,
  FETCH_TIMEOUT_MS,
  RATE_WINDOW_MS,
  RATE_MAX,
} from './img_proxy';

/**
 * 外链文字/接口内容代理（GET /text-proxy?url=...）
 *
 * 与 img-proxy 同构，面向 fetch 拉取的文字型内容：
 * 1. 触发方式：前端 fetch 外部 URL 直连失败（网络/CORS/非 2xx）时，
 *    自动改请求本站 /api/v1/text-proxy?url=<原地址>，由本 handler 兜底拉取。
 * 2. 安全性：与 img-proxy 同一套校验（http/https、URL 长度、内网/保留 IP、
 *    内部域名/workers.dev 递归、请求头净化、每 IP 限流、大小上限）。
 *    MIME 白名单只放行文字类（text/*、json、xml），不放行图片/二进制。
 * 3. 缓存自动过期删除：KV TTL 24h 到期自动清理。
 * 4. CORS：响应带 Access-Control-Allow-Origin: *，前端 fetch 可直接读取；
 *    同时处理 OPTIONS 预检。
 * 5. 安全提醒：text/html 等返回值由调用方自行解析（仅作文本/JSON 使用），
 *    切勿直接 innerHTML 注入，防 XSS。
 */

const ALLOWED_TEXT_MIME = [
  'text/plain', 'text/html', 'text/markdown', 'text/x-markdown',
  'text/csv', 'text/xml', 'text/css', 'text/javascript',
  'application/json', 'application/xml', 'application/rss+xml',
  'application/atom+xml', 'application/ld+json', 'application/xhtml+xml',
  'application/javascript',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function corsify(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export async function handleTextProxy(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // OPTIONS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get('url') || '';

  if (!target || target.length > MAX_URL_LEN) {
    return corsify(Response.json({ code: 400, message: 'url 参数缺失或过长', data: null }, { status: 400 }));
  }

  let tu: URL;
  try {
    tu = new URL(target);
  } catch {
    return corsify(Response.json({ code: 400, message: 'url 参数不是合法地址', data: null }, { status: 400 }));
  }

  if (tu.protocol !== 'https:' && tu.protocol !== 'http:') {
    return corsify(Response.json({ code: 400, message: '仅支持 http/https', data: null }, { status: 400 }));
  }

  const host = tu.hostname.toLowerCase();
  if (BLOCKED_HOST_RE.test(host) || WORKERS_DEV_RE.test(host) || isBlockedIp(host)) {
    return corsify(Response.json({ code: 403, message: '目标地址被禁止代理', data: null }, { status: 403 }));
  }

  // 每 IP 限流（独立键，与图片代理互不影响）
  const ip = clientIp(request);
  const rlKey = `textproxy:${ip}:${Math.floor(Date.now() / RATE_WINDOW_MS)}`;
  const rlCount = parseInt((await env.RATE_LIMIT.get(rlKey)) || '0', 10);
  if (rlCount >= RATE_MAX) {
    return corsify(Response.json({ code: 429, message: '代理请求过于频繁，请稍后再试', data: null }, { status: 429 }));
  }
  ctx.waitUntil(env.RATE_LIMIT.put(rlKey, String(rlCount + 1), { expirationTtl: 60 }));

  // KV 缓存（TTL 到期自动删除）
  const cacheKey = `textproxy/${await sha1Hex(target)}`;
  const cached = await env.MEDIA.getWithMetadata(cacheKey, { type: 'arrayBuffer' });
  if (cached.value) {
    const meta = (cached.metadata as { ct?: string } | null) || {};
    return corsify(new Response(cached.value, {
      status: 200,
      headers: {
        'Content-Type': meta.ct || 'text/plain',
        'Cache-Control': `public, max-age=${CACHE_TTL}`,
        'X-Text-Proxy': 'cache-hit',
      },
    }));
  }

  // 拉取目标（净化请求头：去 Referer/Cookie）
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(tu.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'application/json,text/plain,text/html,application/xml,text/xml,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: ctrl.signal,
    });
  } catch {
    return corsify(Response.json({ code: 502, message: '上游内容拉取失败', data: null }, { status: 502 }));
  } finally {
    clearTimeout(timer);
  }

  if (!upstream.ok) {
    return corsify(Response.json({ code: upstream.status, message: `上游返回 ${upstream.status}`, data: null }, { status: 502 }));
  }

  const contentType = (upstream.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_TEXT_MIME.includes(contentType)) {
    return corsify(Response.json({ code: 415, message: '目标不是受支持的文字类型', data: null }, { status: 415 }));
  }

  const declaredLen = parseInt(upstream.headers.get('Content-Length') || '0', 10);
  if (declaredLen > MAX_FILE_SIZE) {
    return corsify(Response.json({ code: 413, message: '内容超过 10MB 限制', data: null }, { status: 413 }));
  }

  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_FILE_SIZE) {
    return corsify(Response.json({ code: 413, message: '内容超过 10MB 限制', data: null }, { status: 413 }));
  }

  ctx.waitUntil(
    env.MEDIA.put(cacheKey, body, { expirationTtl: CACHE_TTL, metadata: { ct: contentType } })
  );

  return corsify(new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${CACHE_TTL}`,
      'X-Text-Proxy': 'cache-miss',
    },
  }));
}
