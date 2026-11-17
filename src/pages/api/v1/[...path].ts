import { WORKER_ORIGIN } from "../../../utils/workerOrigin";
import {
  buildPreflightHeaders,
  buildProxyResponseHeaders,
} from "../../../utils/api-proxy";
import {
  IP_SIGNING_HEADER,
  signVisitorIp,
  visitorIpSigningSecret,
} from "../../../utils/visitorIpSigning";

export const prerender = false;

/** #85 / H4：代理上游超时（10s，与 articleServer.ts 的 8s 同量级） */
const PROXY_TIMEOUT_MS = 10_000;

export async function ALL({
  request,
  url,
  locals,
}: {
  request: Request;
  url: URL;
  locals?: unknown;
}) {
  // #85 / H4：预检不再绕过安全头；CORS 按白名单回显（非白名单无 ACAO）
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: buildPreflightHeaders(request.headers.get("Origin")),
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
    // #84 / H3：secret 必须来自运行时 env（`Astro.locals.runtime.env`），
    // 构建期 import.meta.env 在 Cloudflare 上拿不到私有变量，只作兜底。
    const runtimeEnv = (locals as { runtime?: { env?: unknown } } | undefined)
      ?.runtime?.env;
    const sig = await signVisitorIp(
      clientIp,
      visitorIpSigningSecret(runtimeEnv)
    );
    if (sig) headers.set(IP_SIGNING_HEADER, sig);
  }

  let body: BodyInit | null = null;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  // #85 / H4：代理 fetch 加 10s 超时（与 articleServer.ts 的 8s 同量级），
  // 上游挂起不再无限占用 Pages Function；超时映射为 502（与网络失败同口径）。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  const requestOrigin = request.headers.get("Origin");

  try {
    const workerResponse = await fetch(workerUrl, {
      method: request.method,
      headers,
      body,
      signal: controller.signal,
    });

    const responseHeaders = buildProxyResponseHeaders(
      workerResponse.headers,
      import.meta.env.DEV,
      requestOrigin
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
        headers: buildPreflightHeaders(requestOrigin),
      }
    );
  } finally {
    clearTimeout(timer);
  }
}

export const GET = ALL;
export const POST = ALL;
export const PUT = ALL;
export const DELETE = ALL;
