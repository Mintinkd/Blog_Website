import { WORKER_ORIGIN } from "./workerOrigin";

/**
 * 文章页 SSR 的站点标题。
 *
 * 直连 Worker 公共 `/api/v1/config`（与浏览器端站点配置同一数据源），
 * 让抓取器在首屏 HTML 里拿到配置后的 `<title>` / `og:title`。读取失败、
 * 超时或配置为空时返回 undefined，由 `articleMeta` 回退默认站名。
 */
const FETCH_TIMEOUT_MS = 800;

export async function loadSiteTitle(
  origin = WORKER_ORIGIN
): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${origin}/api/v1/config`, {
      signal: controller.signal,
    });
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) return undefined;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return undefined;
  }

  return siteTitleFromPayload(payload);
}

function siteTitleFromPayload(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;

  const { code, data } = payload as { code?: unknown; data?: unknown };
  if (code !== 0 || typeof data !== "object" || data === null) return undefined;

  const siteTitle = (data as { site_title?: unknown }).site_title;
  return typeof siteTitle === "string" && siteTitle.trim()
    ? siteTitle.trim()
    : undefined;
}
