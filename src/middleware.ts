import type { MiddlewareHandler } from 'astro';

const API_PREFIX = '/api/v1';
const WORKER_ORIGIN = 'https://blog_website.zen-13467.workers.dev';

export const onRequest: MiddlewareHandler = async (context, next) => {
  const { request, url } = context;

  if (url.pathname.startsWith(API_PREFIX)) {
    const workerUrl = `${WORKER_ORIGIN}${url.pathname}${url.search}`;

    const headers = new Headers(request.headers);
    headers.set('Host', new URL(WORKER_ORIGIN).host);
    headers.delete('cf-connecting-ip');
    headers.delete('cf-ipcountry');
    headers.delete('cf-ray');
    headers.delete('cf-visitor');

    let body: ReadableStream | null = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        body = request.body;
      } catch {
        body = null;
      }
    }

    const newRequest = new Request(workerUrl, {
      method: request.method,
      headers,
      body,
    });

    try {
      const response = await fetch(newRequest);

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
          },
        });
      }

      const newHeaders = new Headers(response.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    } catch (e) {
      return new Response(JSON.stringify({ code: 502, message: 'Worker unreachable' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return next();
};
