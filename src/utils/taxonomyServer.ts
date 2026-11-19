import {
  buildCategoryArticlesQuery,
  type FilterChipTag,
} from "./taxonomyFilter";
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
export interface TaxonomyItem extends FilterChipTag {
  /** Worker 行 id（分类卡片按 id 把标签归到分类，issue #119）。 */
  id?: number;
  article_count: number;
  description: string;
  /** 分类名下标签数（不受文章状态影响，issue #119）。 */
  tag_count?: number;
  /** 标签归属分类 id；无归属 / 缺字段为 null（issue #119）。 */
  category_id?: number | null;
  /** 标签归属分类概要；无归属 / 畸形值为 null（issue #119）。 */
  category?: { id: number; name: string; slug: string } | null;
}

/** 详情列表项（分类 / 标签下的文章）。 */
export interface TaxonomyArticle {
  slug: string;
  title: string;
  summary: string;
  published_at: string | null;
  view_count: number;
  tags: Array<{
    name: string;
    slug: string;
    category: { name: string; slug: string } | null;
  }>;
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
  /** category-articles 的标签筛选（issue #117）；缺省 = 全部。 */
  tagSlug?: string;
  /** tags 的分类过滤（issue #117）；缺省 = 全部分类。 */
  categorySlug?: string;
}

const FETCH_TIMEOUT_MS = 8_000;

/** requestUrl 的取数上下文：origin 已归一化，其余字段按 kind 取用。 */
type RequestTarget = LoadTaxonomyOptions & { origin: string };

function requestUrl(kind: TaxonomyKind, target: RequestTarget): string {
  const { origin } = target;
  switch (kind) {
    case "categories":
      return `${origin}/api/v1/categories`;
    case "tags": {
      const categoryPart = target.categorySlug
        ? `?category_slug=${encodeURIComponent(target.categorySlug)}`
        : "";
      return `${origin}/api/v1/tags${categoryPart}`;
    }
    case "category-articles":
      return `${origin}/api/v1/articles?${buildCategoryArticlesQuery({
        categorySlug: target.slug ?? "",
        tagSlug: target.tagSlug,
      })}`;
    case "tag-articles":
      return `${origin}/api/v1/articles?status=published&page=1&page_size=10&tag_slug=${encodeURIComponent(target.slug ?? "")}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 有限数值收敛；缺失 / 非数值 / NaN / Infinity → null。 */
function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 标签归属分类概要；形状不符（缺 id / name / slug）→ null。 */
function parseCategoryRef(
  value: unknown
): { id: number; name: string; slug: string } | null {
  if (!isRecord(value)) return null;
  const id = finiteNumber(value.id);
  if (id === null || typeof value.name !== "string") return null;
  if (typeof value.slug !== "string") return null;
  return { id, name: value.name, slug: value.slug };
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
    isRecord(data) &&
    typeof data.total_pages === "number" &&
    Number.isFinite(data.total_pages)
      ? Math.max(0, Math.floor(data.total_pages))
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
      const id = finiteNumber(row.id);
      const item: TaxonomyItem = {
        name: row.name,
        slug: row.slug,
        article_count: finiteNumber(row.article_count) ?? 0,
        description: typeof row.description === "string" ? row.description : "",
      };
      if (id !== null) item.id = id;
      if (kind === "categories") {
        // issue #119：分类卡片的「N 标签」直接取 Worker 的 tag_count，缺字段降级为 0。
        item.tag_count = finiteNumber(row.tag_count) ?? 0;
      } else {
        // issue #119：保留标签归属，/tags 的 SSR 才能按分类分组；缺失 / 畸形降级为 null。
        item.category_id = finiteNumber(row.category_id);
        item.category = parseCategoryRef(row.category);
      }
      items.push(item);
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
            .map((t) => {
              const tag = t as Record<string, unknown>;
              return {
                name: t.name,
                slug: t.slug,
                category:
                  isRecord(tag.category) &&
                  typeof tag.category.name === "string" &&
                  typeof tag.category.slug === "string"
                    ? {
                        name: tag.category.name,
                        slug: tag.category.slug,
                      }
                    : null,
              };
            })
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
    const response = await fetch(requestUrl(kind, { ...options, origin }), {
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
