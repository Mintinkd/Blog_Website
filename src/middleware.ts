import type { MiddlewareHandler } from 'astro';

const API_PREFIX = '/api/v1';

export const onRequest: MiddlewareHandler = async (context, next) => {
  const { request, url } = context;

  if (url.pathname.startsWith(API_PREFIX)) {
    const workerUrl = `https://blog_website.zen-13467.workers.dev${url.pathname}${url.search}`;

    const newRequest = new Request(workerUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    try {
      const response = await fetch(newRequest);
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Access-Control-Allow-Origin', url.origin);
      newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: newHeaders });
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    } catch (e) {
      return new Response(JSON.stringify({ code: 500, message: 'Worker unreachable' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return next();
};