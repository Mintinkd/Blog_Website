import { Env } from "../index";
import {
  ArticleListItem,
  ArticleDetail,
  ArticleEditDetail,
  TagBrief,
  CreateArticleRequest,
  UpdateArticleRequest,
} from "../models/article";
import type { AuthResult } from "../middleware/auth";
import { ARTICLE_PUBLISH_COLUMNS } from "../utils/columns";
import { getUserIdByUsername } from "./user_service";

function generateSlug(title: string): string {
  return title
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .slice(0, 120);
}

export function calculateReadingTime(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || [])
    .length;
  const englishWords = text
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  const minutes = chineseChars / 300 + englishWords / 200;
  return Math.max(1, Math.ceil(minutes));
}

interface ListArticlesOptions {
  page: number;
  page_size: number;
  category_slug?: string;
  tag_slug?: string;
  status?: "published" | "draft" | "all";
  auth_result?: AuthResult;
  author_id?: number;
}

/**
 * 解析列表查询里 group_concat 出来的标签 blob（issue #89 / M1）。
 *
 * 格式：每条标签 `id^_name^_slug`，标签间以 `^^` 拼接。
 * 解析取「首个 ^_ 之前的 id、末个 ^_ 之后的 slug、中间整段 name」，
 * 这样 name 自身含 `^_` 组合也不丢失（slug 按约定为 URL-safe，不含分隔符）。
 * 空 blob / 缺字段的畸形片段直接丢弃，不抛异常。
 */
function parseTagsBlob(blob: unknown): TagBrief[] {
  if (typeof blob !== "string" || blob.length === 0) return [];
  const tags: TagBrief[] = [];
  for (const chunk of blob.split("^^")) {
    if (!chunk) continue;
    const first = chunk.indexOf("^_");
    const last = chunk.lastIndexOf("^_");
    if (first < 0 || last <= first) continue;
    const id = Number(chunk.slice(0, first));
    if (!Number.isFinite(id)) continue;
    tags.push({
      id,
      name: chunk.slice(first + 2, last),
      slug: chunk.slice(last + 2),
    });
  }
  return tags;
}

export async function listArticles(
  env: Env,
  options: ListArticlesOptions
): Promise<{ items: ArticleListItem[]; total: number }> {
  const {
    page,
    page_size,
    category_slug,
    tag_slug,
    status = "published",
    auth_result,
    author_id,
  } = options;
  const offset = (page - 1) * page_size;

  let whereClause = "";
  const params: unknown[] = [];

  // 审查报告 H1 修复：published 为默认过滤（不再被空串绕过）；draft/all 由 handler 保证已登录
  if (status === "draft") {
    whereClause = "WHERE a.status = ?";
    params.push("draft");
  } else if (status !== "all") {
    whereClause = "WHERE a.status = ?";
    params.push("published");
  }

  if (category_slug) {
    whereClause += whereClause ? " AND c.slug = ?" : "WHERE c.slug = ?";
    params.push(category_slug);
  }

  if (tag_slug) {
    whereClause += whereClause
      ? " AND EXISTS (SELECT 1 FROM article_tags at2 JOIN tags t2 ON at2.tag_id = t2.id WHERE at2.article_id = a.id AND t2.slug = ?)"
      : "WHERE EXISTS (SELECT 1 FROM article_tags at2 JOIN tags t2 ON at2.tag_id = t2.id WHERE at2.article_id = a.id AND t2.slug = ?)";
    params.push(tag_slug);
  }

  // editor：非公开视图（draft/all）仅可见自己的文章；无法解析用户时 fail-closed
  if (auth_result && auth_result.role === "editor" && status !== "published") {
    const userId = await getUserIdByUsername(env, auth_result.username);
    if (userId) {
      whereClause += whereClause
        ? " AND a.author_id = ?"
        : "WHERE a.author_id = ?";
      params.push(userId);
    } else {
      whereClause += whereClause ? " AND 1 = 0" : "WHERE 1 = 0";
    }
  } else if (author_id) {
    whereClause += whereClause
      ? " AND a.author_id = ?"
      : "WHERE a.author_id = ?";
    params.push(author_id);
  }

  const countResult = await env.DB.prepare(
    `SELECT COUNT(*) as total FROM articles a LEFT JOIN categories c ON a.category_id = c.id ${whereClause}`
  )
    .bind(...params)
    .first<{ total: number }>();
  const total = countResult?.total || 0;

  // issue #89 / M1：用相关子查询一次取回每篇文章的标签 blob，消除逐篇 D1 往返。
  // issue #90 / M2：列表不再 select a.content（content 只用于算时长，落库后无需搬运），
  // reading_time 直接读落库列。
  // 内层按 t.id 排序保证 blob 中标签顺序稳定（可复现），外层 group_concat 拼接。
  const articles = await env.DB.prepare(
    `
    SELECT a.id, a.title, a.slug, a.summary, a.cover_image, a.status,
           a.reading_time,
           a.view_count, a.like_count, a.comment_count, a.published_at, a.created_at,
           a.author_id,
           c.id as category_id, c.name as category_name, c.slug as category_slug,
           u.display_name as author_name,
           (SELECT group_concat(blob.part, '^^') FROM (
              SELECT t.id || '^_' || t.name || '^_' || t.slug AS part
              FROM tags t
              JOIN article_tags at ON t.id = at.tag_id
              WHERE at.article_id = a.id
              ORDER BY t.id
            ) blob) AS tags_blob
    FROM articles a
    LEFT JOIN categories c ON a.category_id = c.id
    LEFT JOIN users u ON a.author_id = u.id
    ${whereClause}
    ORDER BY a.published_at DESC, a.created_at DESC
    LIMIT ? OFFSET ?
  `
  )
    .bind(...params, page_size, offset)
    .all();

  const items: ArticleListItem[] = [];

  for (const row of articles.results) {
    const tags = parseTagsBlob(row.tags_blob);

    items.push({
      id: row.id as number,
      title: row.title as string,
      slug: row.slug as string,
      summary: row.summary as string,
      cover_image: row.cover_image as string,
      category: row.category_id
        ? {
            id: row.category_id as number,
            name: row.category_name as string,
            slug: row.category_slug as string,
          }
        : { id: 1, name: "未分类", slug: "uncategorized" },
      tags,
      status: row.status as "draft" | "published",
      view_count: row.view_count as number,
      like_count: row.like_count as number,
      comment_count: row.comment_count as number,
      author_id: row.author_id as number | null,
      author_name: row.author_name as string | null,
      published_at: row.published_at as string | null,
      created_at: row.created_at as string,
      // 落库值优先；列表不再取 content，无法在此现算，缺值时回退到与 schema
      // DEFAULT 一致的 1（存量回填由 scripts/migrate-reading-time.mjs 完成）。
      reading_time: row.reading_time != null ? (row.reading_time as number) : 1,
    });
  }

  return { items, total };
}

/**
 * 详情与编辑器取数共用的 SELECT / 标签查询 / 行映射（issue #63）。
 * 公开 `GET /articles/:slug` 与编辑器 `GET /articles/:id/edit` 同源，
 * 只差 WHERE 条件与最终投影，避免两处字段各自漂移。
 */
const ARTICLE_DETAIL_SELECT = `
    SELECT a.*, c.id as category_id, c.name as category_name, c.slug as category_slug,
           u.display_name as author_name
    FROM articles a
    LEFT JOIN categories c ON a.category_id = c.id
    LEFT JOIN users u ON a.author_id = u.id
  `;

const ARTICLE_TAGS_SQL = `
    SELECT t.id, t.name, t.slug FROM tags t
    JOIN article_tags at ON t.id = at.tag_id
    WHERE at.article_id = ?
  `;

async function loadArticleTags(
  env: Env,
  articleId: unknown
): Promise<TagBrief[]> {
  const tags = await env.DB.prepare(ARTICLE_TAGS_SQL).bind(articleId).all();
  return tags.results.map((t: Record<string, unknown>) => ({
    id: t.id as number,
    name: t.name as string,
    slug: t.slug as string,
  }));
}

function mapArticleDetail(
  row: Record<string, unknown>,
  tags: TagBrief[]
): ArticleDetail {
  return {
    id: row.id as number,
    title: row.title as string,
    slug: row.slug as string,
    content: row.content as string,
    content_html: row.content_html as string,
    summary: row.summary as string,
    cover_image: row.cover_image as string,
    category: row.category_id
      ? {
          id: row.category_id as number,
          name: row.category_name as string,
          slug: row.category_slug as string,
        }
      : { id: 1, name: "未分类", slug: "uncategorized" },
    tags,
    status: row.status as "draft" | "published",
    view_count: row.view_count as number,
    like_count: row.like_count as number,
    comment_count: row.comment_count as number,
    author_id: row.author_id as number | null,
    author_name: row.author_name as string | null,
    published_at: row.published_at as string | null,
    created_at: row.created_at as string,
    // 落库值优先；存量缺值时回退现算（详情 SELECT 仍含 a.*，content 可得）。
    reading_time:
      row.reading_time != null
        ? (row.reading_time as number)
        : calculateReadingTime((row.content as string) || ""),
  };
}

async function loadArticleDetailById(
  env: Env,
  id: unknown
): Promise<ArticleDetail | null> {
  const row = await env.DB.prepare(
    `${ARTICLE_DETAIL_SELECT}
    WHERE a.id = ?
  `
  )
    .bind(id)
    .first();
  if (!row) return null;
  return mapArticleDetail(row, await loadArticleTags(env, row.id));
}

export async function getArticleBySlug(
  env: Env,
  slug: string
): Promise<ArticleDetail | null> {
  const row = await env.DB.prepare(
    `${ARTICLE_DETAIL_SELECT}
    WHERE a.slug = ?
  `
  )
    .bind(slug)
    .first();

  if (!row) return null;

  return mapArticleDetail(row, await loadArticleTags(env, row.id));
}

/**
 * slug 唯一性检查单点（issue #101 / M21）：handler 创建/更新前的冲突检查、
 * service 创建时的后缀兜底都走这里，避免散落 SQL 口径漂移。
 * `excludeId` 用于更新时排除自身。
 */
export async function slugExists(
  env: Env,
  slug: string,
  excludeId?: number
): Promise<boolean> {
  const sql =
    excludeId === undefined
      ? "SELECT id FROM articles WHERE slug = ?"
      : "SELECT id FROM articles WHERE slug = ? AND id <> ?";
  const row = await env.DB.prepare(sql)
    .bind(...(excludeId === undefined ? [slug] : [slug, excludeId]))
    .first<{ id: number }>();
  return row != null;
}

/**
 * 编辑器按稳定 id 取正文（issue #63 / ADR 0006 取数接缝）。
 * 复用上面的 SELECT / 标签查询 / 映射，再投影成 ArticleEditDetail：
 * 不展开 `content_html`，也不带阅读统计字段。本函数只做读取——
 * 不调用 recordArticleView、不下发 `view_<id>` Cookie、不写 `requests`。
 */
export async function getArticleForEdit(
  env: Env,
  id: number
): Promise<ArticleEditDetail | null> {
  const row = await env.DB.prepare(
    `${ARTICLE_DETAIL_SELECT}
    WHERE a.id = ?
  `
  )
    .bind(id)
    .first();

  if (!row) return null;

  const detail = mapArticleDetail(row, await loadArticleTags(env, row.id));
  return {
    id: detail.id,
    title: detail.title,
    slug: detail.slug,
    content: detail.content,
    summary: detail.summary,
    cover_image: detail.cover_image,
    category_id: detail.category?.id ?? null,
    category: detail.category,
    tags: detail.tags,
    status: detail.status,
    author_id: detail.author_id,
    created_at: detail.created_at,
    updated_at: (row.updated_at as string) ?? "",
  };
}

export async function createArticle(
  env: Env,
  data: CreateArticleRequest,
  auth_result?: AuthResult
): Promise<ArticleDetail> {
  let slug =
    data.slug && data.slug.trim() ? data.slug.trim() : generateSlug(data.title);
  if (!slug) slug = generateSlug(data.title);
  // 唯一性兜底：冲突时追加 -n 后缀（slug 检查统一走 slugExists，issue #101）
  const slugBase = slug;
  let n = 2;
  while (await slugExists(env, slug)) {
    slug = `${slugBase}-${n++}`;
  }
  const now = new Date().toISOString();
  const published_at = data.status === "published" ? now : null;

  let author_id: number | null = null;
  if (auth_result) {
    author_id = await getUserIdByUsername(env, auth_result.username);
  }

  const reading_time = calculateReadingTime(data.content);
  const result = await env.DB.prepare(
    `
    INSERT INTO articles (title, slug, content, content_html, summary, cover_image, category_id, status, published_at, author_id, reading_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  )
    .bind(
      data.title,
      slug,
      data.content,
      "",
      data.summary || "",
      data.cover_image || "",
      data.category_id || 1,
      data.status || "draft",
      published_at,
      author_id,
      reading_time
    )
    .run();

  const article_id = result.meta.last_row_id;

  if (data.tags && data.tags.length > 0) {
    for (const tag_name of data.tags) {
      const tag = await env.DB.prepare("SELECT id FROM tags WHERE name = ?")
        .bind(tag_name)
        .first<{ id: number }>();
      if (tag) {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)"
        )
          .bind(article_id, tag.id)
          .run();
      }
    }
  }

  // issue #101 / M21：不再反调公开的 getArticleBySlug 形成回环，
  // 直接用 last_row_id 按 id 读回完整详情（与 getArticleBySlug 共享 SELECT / 映射，形状不变）。
  return (await loadArticleDetailById(env, article_id))!;
}

export async function checkArticleOwnership(
  env: Env,
  articleId: number,
  auth_result: AuthResult
): Promise<boolean> {
  if (auth_result.role === "admin") return true;
  const userId = await getUserIdByUsername(env, auth_result.username);
  if (!userId) return false;
  const article = await env.DB.prepare(
    "SELECT author_id FROM articles WHERE id = ?"
  )
    .bind(articleId)
    .first<{ author_id: number | null }>();
  if (!article) return false;
  return article.author_id === userId;
}

/**
 * 局部更新：`data` 中值为 `undefined` 的字段不写入、保持原值；
 * `content` / `summary` / `cover_image` 显式传 `""` 是合法的清空操作（issue #70），
 * 不得按假值跳过。请求 / 响应形状不变。
 */
export async function updateArticle(
  env: Env,
  id: number,
  data: UpdateArticleRequest
): Promise<ArticleDetail | null> {
  const existing = await env.DB.prepare(
    `SELECT ${ARTICLE_PUBLISH_COLUMNS} FROM articles WHERE id = ?`
  )
    .bind(id)
    .first();
  if (!existing) return null;

  const sets: string[] = [];
  const values: unknown[] = [];

  if (data.title !== undefined) {
    sets.push("title = ?");
    values.push(data.title);
  }
  if (data.slug !== undefined) {
    sets.push("slug = ?");
    values.push(data.slug);
  }
  if (data.content !== undefined) {
    sets.push("content = ?");
    values.push(data.content);
    // issue #90 / M2：正文变化时同步刷新落库的阅读时长。
    sets.push("reading_time = ?");
    values.push(calculateReadingTime(data.content));
  }
  if (data.summary !== undefined) {
    sets.push("summary = ?");
    values.push(data.summary);
  }
  if (data.cover_image !== undefined) {
    sets.push("cover_image = ?");
    values.push(data.cover_image);
  }
  if (data.category_id !== undefined) {
    sets.push("category_id = ?");
    values.push(data.category_id || 1);
  }
  if (data.status !== undefined) {
    sets.push("status = ?");
    values.push(data.status);
    if (data.status === "published" && !existing.published_at) {
      sets.push("published_at = ?");
      values.push(new Date().toISOString());
    }
  }

  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id);

  await env.DB.prepare(`UPDATE articles SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  if (data.tags !== undefined) {
    await env.DB.prepare("DELETE FROM article_tags WHERE article_id = ?")
      .bind(id)
      .run();
    for (const tag_name of data.tags) {
      const tag = await env.DB.prepare("SELECT id FROM tags WHERE name = ?")
        .bind(tag_name)
        .first<{ id: number }>();
      if (tag) {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)"
        )
          .bind(id, tag.id)
          .run();
      }
    }
  }

  // issue #101 / M21：不再「先查 slug 再 getArticleBySlug」回环，
  // 直接按 id 读回完整详情（SELECT / 映射与 getArticleBySlug 共享，形状不变）。
  return loadArticleDetailById(env, id);
}

export async function deleteArticle(env: Env, id: number): Promise<boolean> {
  const result = await env.DB.prepare("DELETE FROM articles WHERE id = ?")
    .bind(id)
    .run();
  return result.meta.changes > 0;
}

// 阅读量计数已迁至 services/analytics_service.ts 的 recordArticleView（issue #55）。

export { generateSlug };
