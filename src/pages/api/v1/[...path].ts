export const prerender = false;

const WORKER_ORIGIN = 'https://blog-api.zen-13467.workers.dev';

export async function ALL({ request, url }: { request: Request; url: URL }) {
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

  const workerUrl = `${WORKER_ORIGIN}/api/v1${url.pathname.replace(/^\/api\/v1/, '')}${url.search}`;

  const headers = new Headers(request.headers);
  headers.set('Host', new URL(WORKER_ORIGIN).host);

  let body: BodyInit | null = null;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    body = await request.arrayBuffer();
  }

  try {
    const workerResponse = await fetch(workerUrl, {
      method: request.method,
      headers,
      body,
    });

    const responseHeaders = new Headers(workerResponse.headers);
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    return new Response(workerResponse.body, {
      status: workerResponse.status,
      statusText: workerResponse.statusText,
      headers: responseHeaders,
    });
  } catch {
    return new Response(JSON.stringify({ code: 502, message: 'Worker unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const GET = ALL;
export const POST = ALL;
export const PUT = ALL;
export const DELETE = ALL;