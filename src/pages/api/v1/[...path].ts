import { WORKER_ORIGIN } from "../../../utils/workerOrigin";
import {
  PROXY_CORS_HEADERS,
  buildProxyResponseHeaders,
} from "../../../utils/api-proxy";
import {
  IP_SIGNING_HEADER,
  signVisitorIp,
  visitorIpSigningSecret,
} from "../../../utils/visitorIpSigning";

export const prerender = false;

export async function ALL({ request, url }: { request: Request; url: URL }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: PROXY_CORS_HEADERS,
    });
  }

  const workerUrl = `${WORKER_ORIGIN}/api/v1${url.pathname.replace(/^\/api\/v1/, "")}${url.search}`;

  const headers = new Headers(request.headers);
  headers.set("Host", new URL(WORKER_ORIGIN).host);

  // #84 / H3：只认边缘可信的 cf-connecting-ip，映射为 X-Real-IP 并加签；
  // 客户端自带的 X-Real-IP / X-Real-IP-Sig 一律先删除，杜绝透传伪造。
  // 不再回退 x-forwarded-for（#40 已裁定 XFF 可伪造，见 docs/reviews/2026-10-22-article-ssr-t4.md）。
  headers.delete("X-Real-IP");
  headers.delete(IP_SIGNING_HEADER);
  const clientIp = request.headers.get("cf-connecting-ip")?.trim() || "";
  if (clientIp) {
    headers.set("X-Real-IP", clientIp);
    const sig = await signVisitorIp(clientIp, visitorIpSigningSecret());
    if (sig) headers.set(IP_SIGNING_HEADER, sig);
  }

  let body: BodyInit | null = null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  try {
    const workerResponse = await fetch(workerUrl, {
      method: request.method,
      headers,
      body,
    });

    const responseHeaders = buildProxyResponseHeaders(
      workerResponse.headers,
      import.meta.env.DEV
    );

    return new Response(workerResponse.body, {
      status: workerResponse.status,
      statusText: workerResponse.statusText,
      headers: responseHeaders,
    });
  } catch {
    return new Response(
      JSON.stringify({ code: 502, message: "Worker unreachable" }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

export const GET = ALL;
export const POST = ALL;
export const PUT = ALL;
export const DELETE = ALL;
