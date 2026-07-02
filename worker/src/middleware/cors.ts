const ALLOWED_ORIGINS = [
  'https://blog.example.com',
  'http://localhost:4321',
];

const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization';
const MAX_AGE = '86400';

export function corsMiddleware(request: Request): Response | null {
  const origin = request.headers.get('Origin') || '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.pages.dev');

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': isAllowed ? origin : '',
        'Access-Control-Allow-Methods': ALLOWED_METHODS,
        'Access-Control-Allow-Headers': ALLOWED_HEADERS,
        'Access-Control-Max-Age': MAX_AGE,
      },
    });
  }

  return null;
}

export function withCors(response: Response, request: Request): Response {
  const origin = request.headers.get('Origin') || '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.pages.dev');

  if (isAllowed) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  }

  return response;
}