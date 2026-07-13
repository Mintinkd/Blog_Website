globalThis.process ??= {}; globalThis.process.env ??= {};
export { r as renderers } from '../../../chunks/_@astro-renderers_V6C19r4Q.mjs';

const prerender = false;
const WORKER_ORIGIN = "https://blog-api.zen-13467.workers.dev";
async function ALL({ request, url }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400"
      }
    });
  }
  const workerUrl = `${WORKER_ORIGIN}/api/v1${url.pathname.replace(/^\/api\/v1/, "")}${url.search}`;
  const headers = new Headers(request.headers);
  headers.set("Host", new URL(WORKER_ORIGIN).host);
  const clientIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  if (clientIp) {
    headers.set("X-Real-IP", clientIp);
  }
  let body = null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
  }
  try {
    const workerResponse = await fetch(workerUrl, {
      method: request.method,
      headers,
      body
    });
    const responseHeaders = new Headers(workerResponse.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return new Response(workerResponse.body, {
      status: workerResponse.status,
      statusText: workerResponse.statusText,
      headers: responseHeaders
    });
  } catch {
    return new Response(JSON.stringify({ code: 502, message: "Worker unreachable" }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  }
}
const GET = ALL;
const POST = ALL;
const PUT = ALL;
const DELETE = ALL;

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  ALL,
  DELETE,
  GET,
  POST,
  PUT,
  prerender
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
