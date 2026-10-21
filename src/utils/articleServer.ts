import { WORKER_ORIGIN } from "./workerOrigin";

export interface ArticleCategory {
  id: number;
  name: string;
  slug: string;
}

export interface ArticleTag {
  id: number;
  name: string;
  slug: string;
}

/** 文章详情页需要的字段（API `GET /articles/:slug` 的读模型子集）。 */
export interface ArticleDetail {
  id: number;
  title: string;
  slug: string;
  content: string;
  summary: string;
  cover_image: string;
  category: ArticleCategory | null;
  tags: ArticleTag[];
  status: "draft" | "published";
  view_count: number;
  like_count: number;
  reading_time: number;
  published_at: string | null;
}

export type ArticleLoadResult =
  | { status: "ok"; article: ArticleDetail }
  | { status: "not-found" }
  | { status: "error" };

export interface LoadArticleOptions {
  /** 覆盖 Worker origin（测试用；生产走 WORKER_ORIGIN）。 */
  origin?: string;
}

/** 上游取数超时；超时与网络失败一样映射为 error（502 + 重试入口）。 */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * 文章详情页取数：请求时直连 Worker API（与 RSS 相同），不走同源代理。
 *
 * 三态结果把页面关心的边界一次收口：
 * - `ok`：上游返回已发布文章；
 * - `not-found`：404，或上游意外返回草稿（未发布对匿名访客一律 404）；
 * - `error`：网络失败 / 非 2xx / 非法响应体，页面映射为 502 + 重试入口。
 *
 * T4 将在此接缝上补访客 Cookie / cf-connecting-ip 转发与 Set-Cookie 回传。
 */
export async function loadArticleForPage(
  slug: string,
  options: LoadArticleOptions = {}
): Promise<ArticleLoadResult> {
  const origin = options.origin ?? WORKER_ORIGIN;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(
      `${origin}/api/v1/articles/${encodeURIComponent(slug)}`,
      { signal: controller.signal }
    );
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) return { status: "not-found" };
  if (!response.ok) return { status: "error" };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: "error" };
  }

  const article = parseArticle(payload);
  if (!article) return { status: "error" };
  if (article.status !== "published") return { status: "not-found" };

  return { status: "ok", article };
}

/** 把取数结果映射成文章页 HTTP 状态：ok → 200，not-found → 404，error → 502。 */
export function httpStatusForArticleResult(
  result: ArticleLoadResult
): 200 | 404 | 502 {
  if (result.status === "ok") return 200;
  return result.status === "not-found" ? 404 : 502;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseArticle(payload: unknown): ArticleDetail | null {
  if (!isRecord(payload) || payload.code !== 0 || !isRecord(payload.data)) {
    return null;
  }

  const data = payload.data;
  if (
    typeof data.id !== "number" ||
    typeof data.title !== "string" ||
    typeof data.slug !== "string" ||
    typeof data.content !== "string" ||
    (data.status !== "published" && data.status !== "draft")
  ) {
    return null;
  }

  return {
    id: data.id,
    title: data.title,
    slug: data.slug,
    content: data.content,
    summary: stringOr(data.summary, ""),
    cover_image: stringOr(data.cover_image, ""),
    category: parseCategory(data.category),
    tags: Array.isArray(data.tags)
      ? data.tags.map(parseTag).filter((tag): tag is ArticleTag => tag !== null)
      : [],
    status: data.status,
    view_count: Math.max(0, numberOr(data.view_count, 0)),
    like_count: Math.max(0, numberOr(data.like_count, 0)),
    reading_time: Math.max(1, numberOr(data.reading_time, 1)),
    published_at:
      typeof data.published_at === "string" ? data.published_at : null,
  };
}

function parseCategory(value: unknown): ArticleCategory | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.slug !== "string"
  ) {
    return null;
  }
  return {
    id: numberOr(value.id, 0),
    name: value.name,
    slug: value.slug,
  };
}

function parseTag(value: unknown): ArticleTag | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.slug !== "string"
  ) {
    return null;
  }
  return {
    id: numberOr(value.id, 0),
    name: value.name,
    slug: value.slug,
  };
}
