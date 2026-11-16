import { resolveArticleApiOrigin } from "./workerOrigin";

/**
 * 分类 / 标签页服务端取数（issue #97 / M17，方案 A：补 SSR 首屏）。
 *
 * 四页面（categories/index、categories/[slug]、tags/index、tags/[slug]）此前声明
 * prerender=false 却零服务端产出——首屏空壳、非 JS 抓取器拿不到内容，却付出 SSR 成本。
 * 本模块复用 articleServer.ts 的模式：frontmatter 服务端直连 Worker API，渲染首屏，
 * 客户端脚本保留负责后续交互（分页 / 语言切换）。不走同源代理（避免 SSR 自请求绕圈）。
 */

export type TaxonomyKind =
  "categories" | "tags" | "category-articles" | "tag-articles";

/** 目录项（分类 / 标签云）。 */
export interface TaxonomyItem {
  name: string;
  slug: string;
  article_count: number;
  description: string;
}

/** 详情列表项（分类 / 标签下的文章）。 */
export interface TaxonomyArticle {
  slug: string;
  title: string;
  summary: string;
  published_at: string | null;
  view_count: number;
  tags: Array<{ name: string; slug: string }>;
  category: { name: string; slug: string } | null;
}

export type TaxonomyResult =
  | {
      status: "ok";
      items: Array<TaxonomyItem | TaxonomyArticle>;
      totalPages: number;
    }
  | { status: "empty" }
  | { status: "error" };

export interface LoadTaxonomyOptions {
  /** 覆盖 Worker origin（测试用；缺省走 resolveArticleApiOrigin）。 */
  origin?: string;
  /** category-articles / tag-articles 的资源 slug。 */
  slug?: string;
}

const FETCH_TIMEOUT_MS = 8_000;

function requestUrl(kind: TaxonomyKind, origin: string, slug?: string): string {
  switch (kind) {
    case "categories":
      return `${origin}/api/v1/categories`;
    case "tags":
      return `${origin}/api/v1/tags`;
    case "category-articles":
      return `${origin}/api/v1/articles?status=published&page=1&page_size=10&category_slug=${encodeURIComponent(slug ?? "")}`;
    case "tag-articles":
      return `${origin}/api/v1/articles?status=published&page=1&page_size=10&tag_slug=${encodeURIComponent(slug ?? "")}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 解析 `{ code: 0, data: [...] | { items: [...] } }`，畸形数据 fail-closed → error。 */
function parseResult(payload: unknown, kind: TaxonomyKind): TaxonomyResult {
  if (!isRecord(payload) || payload.code !== 0) return { status: "error" };
  const data = payload.data;
  const rawItems = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.items)
      ? data.items
      : null;
  if (!rawItems) return { status: "error" };

  const totalPages =
    isRecord(data) && typeof data.total_pages === "number"
      ? Math.max(0, data.total_pages)
      : 1;

  if (kind === "categories" || kind === "tags") {
    const items: TaxonomyItem[] = [];
    for (const row of rawItems) {
      if (
        !isRecord(row) ||
        typeof row.name !== "string" ||
        typeof row.slug !== "string"
      )
        continue;
      items.push({
        name: row.name,
        slug: row.slug,
        article_count:
          typeof row.article_count === "number" &&
          Number.isFinite(row.article_count)
            ? row.article_count
            : 0,
        description: typeof row.description === "string" ? row.description : "",
      });
    }
    return items.length === 0
      ? { status: "empty" }
      : { status: "ok", items, totalPages: 1 };
  }

  const items: TaxonomyArticle[] = [];
  for (const row of rawItems) {
    if (
      !isRecord(row) ||
      typeof row.slug !== "string" ||
      typeof row.title !== "string"
    )
      continue;
    items.push({
      slug: row.slug,
      title: row.title,
      summary: typeof row.summary === "string" ? row.summary : "",
      published_at:
        typeof row.published_at === "string" ? row.published_at : null,
      view_count:
        typeof row.view_count === "number" && Number.isFinite(row.view_count)
          ? row.view_count
          : 0,
      tags: Array.isArray(row.tags)
        ? row.tags
            .filter(
              (t): t is { name: string; slug: string } =>
                isRecord(t) &&
                typeof t.name === "string" &&
                typeof t.slug === "string"
            )
            .map((t) => ({ name: t.name, slug: t.slug }))
        : [],
      category:
        isRecord(row.category) && typeof row.category.name === "string"
          ? { name: row.category.name, slug: String(row.category.slug ?? "") }
          : null,
    });
  }
  return items.length === 0
    ? { status: "empty" }
    : { status: "ok", items, totalPages };
}

/**
 * 服务端取数。网络失败 / 超时 / 非 2xx / 非法响应体都映射为 error（不抛异常），
 * 由页面降级为客户端接管（脚本仍会 fetch 刷新）。
 */
export async function loadTaxonomyForPage(
  kind: TaxonomyKind,
  options: LoadTaxonomyOptions = {}
): Promise<TaxonomyResult> {
  const origin = (options.origin ?? resolveArticleApiOrigin()).replace(
    /\/+$/,
    ""
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(requestUrl(kind, origin, options.slug), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return { status: "error" };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: "error" };
    }
    return parseResult(payload, kind);
  } catch {
    return { status: "error" };
  } finally {
    clearTimeout(timer);
  }
}
