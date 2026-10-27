import { Env } from "../index";
import { successResponse, error, ErrorCodes } from "../utils/response";

function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const chineseRegex = /[\u4e00-\u9fff\u3400-\u4dbf]+/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;

  while ((match = chineseRegex.exec(query)) !== null) {
    if (match.index > lastIndex) {
      const englishPart = query.slice(lastIndex, match.index).trim();
      if (englishPart)
        tokens.push(...englishPart.split(/\s+/).filter((w) => w.length > 0));
    }
    for (const char of match[0]) {
      tokens.push(char);
    }
    lastIndex = chineseRegex.lastIndex;
  }

  if (lastIndex < query.length) {
    const remaining = query.slice(lastIndex).trim();
    if (remaining)
      tokens.push(...remaining.split(/\s+/).filter((w) => w.length > 0));
  }

  return tokens;
}

function buildLikeClause(
  tokens: string[],
  fields: string[]
): { clause: string; params: string[] } {
  const fieldConditions = fields.map((field) => {
    const tokenConditions = tokens.map(() => `${field} LIKE ? ESCAPE '\\'`);
    return `(${tokenConditions.join(" AND ")})`;
  });
  const clause = `(${fieldConditions.join(" OR ")})`;
  const params: string[] = [];
  for (const field of fields) {
    if (field === "content") continue;
    for (const token of tokens) {
      params.push(`%${escapeLike(token)}%`);
    }
  }
  for (const token of tokens) {
    params.push(`%${escapeLike(token)}%`);
  }
  for (const token of tokens) {
    params.push(`%${escapeLike(token)}%`);
  }
  return { clause, params };
}

/** LIKE 通配符转义：`%` `_` `\\` 前加反斜杠，并以 `ESCAPE '\\'` 声明 */
export function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, "\\$&");
}

function escapeHtml(s: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return s.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * 生成 <mark> 高亮前先整体 HTML 转义：
 * 标题/摘要中的任意 HTML（如 <img onerror=...>）将被中和，
 * 只有转义后的纯文本才会被包上 <mark>，前端 v-html 渲染安全。
 */
function highlightText(text: string, tokens: string[]): string {
  if (!text) return "";
  let result = escapeHtml(text);
  for (const token of tokens) {
    const escapedToken = escapeHtml(token);
    if (!escapedToken) continue;
    result = result.replace(
      new RegExp(escapeRegExp(escapedToken), "gi"),
      "<mark>$&</mark>"
    );
  }
  return result;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * FTS snippet() 直接拼接原文与 <mark>，原文中的 HTML 未转义。
 * 先暂存 mark 标签 -> 整体转义 -> 恢复 mark，确保 snippet 中只含安全标签。
 */
function sanitizeSnippet(html: string): string {
  if (!html) return "";
  const OPEN = "\u0000MARK_OPEN\u0000";
  const CLOSE = "\u0000MARK_CLOSE\u0000";
  const tmp = String(html)
    .replace(/<mark>/gi, OPEN)
    .replace(/<\/mark>/gi, CLOSE);
  return escapeHtml(tmp)
    .split(OPEN)
    .join("<mark>")
    .split(CLOSE)
    .join("</mark>");
}

export async function handleSearch(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const page_size = Math.min(
    20,
    Math.max(1, parseInt(url.searchParams.get("page_size") || "10", 10))
  );

  if (!q || q.length < 1 || q.length > 100) {
    return error(
      ErrorCodes.PARAM_ERROR,
      "Search query must be between 1 and 100 characters"
    );
  }

  const offset = (page - 1) * page_size;
  const tokens = tokenize(q);

  try {
    const escaped_q = q.replace(/"/g, '""');
    const ftsResults = await env.DB.prepare(
      `
      SELECT a.id, a.title, a.slug, a.summary, a.published_at, a.created_at,
             snippet(articles_fts, 0, '<mark>', '</mark>', '...', 30) as title_highlight,
             snippet(articles_fts, 1, '<mark>', '</mark>', '...', 80) as content_highlight
      FROM articles_fts f
      JOIN articles a ON a.id = f.rowid
      WHERE articles_fts MATCH ?
      AND a.status = 'published'
      ORDER BY rank
      LIMIT ? OFFSET ?
    `
    )
      .bind(`"${escaped_q}"`, page_size, offset)
      .all();

    const ftsCount = await env.DB.prepare(
      `
      SELECT COUNT(*) as total
      FROM articles_fts f
      JOIN articles a ON a.id = f.rowid
      WHERE articles_fts MATCH ?
      AND a.status = 'published'
    `
    )
      .bind(`"${escaped_q}"`)
      .first<{ total: number }>();

    if ((ftsCount?.total || 0) > 0) {
      const items = ftsResults.results.map((row: Record<string, unknown>) => ({
        ...row,
        title_highlight: sanitizeSnippet(String(row.title_highlight || "")),
        content_highlight: sanitizeSnippet(String(row.content_highlight || "")),
      }));
      return successResponse({
        items,
        total: ftsCount?.total || 0,
        page,
        page_size,
        query: q,
      });
    }
  } catch (e) {
    // #51：FTS 失败不得静默吞异常——记录日志后走 LIKE 回退
    console.error("FTS search failed, falling back to LIKE:", e);
  }

  if (tokens.length === 0) {
    return successResponse({ items: [], total: 0, page, page_size, query: q });
  }

  const titleLikeParts = tokens.map(() => "title LIKE ? ESCAPE '\\'");
  const contentLikeParts = tokens.map(() => "content LIKE ? ESCAPE '\\'");
  const summaryLikeParts = tokens.map(() => "summary LIKE ? ESCAPE '\\'");

  const whereClause = `((${titleLikeParts.join(" AND ")}) OR (${contentLikeParts.join(" AND ")}) OR (${summaryLikeParts.join(" AND ")}))`;

  const bindParams: string[] = [];
  for (const token of tokens) bindParams.push(`%${escapeLike(token)}%`);
  for (const token of tokens) bindParams.push(`%${escapeLike(token)}%`);
  for (const token of tokens) bindParams.push(`%${escapeLike(token)}%`);

  const results = await env.DB.prepare(
    `
    SELECT id, title, slug, summary, published_at, created_at
    FROM articles
    WHERE status = 'published'
    AND ${whereClause}
    ORDER BY published_at DESC, created_at DESC
    LIMIT ? OFFSET ?
  `
  )
    .bind(...bindParams, page_size, offset)
    .all();

  const countResult = await env.DB.prepare(
    `
    SELECT COUNT(*) as total
    FROM articles
    WHERE status = 'published'
    AND ${whereClause}
  `
  )
    .bind(...bindParams)
    .first<{ total: number }>();

  const items = results.results.map((row: Record<string, unknown>) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    published_at: row.published_at,
    created_at: row.created_at,
    title_highlight: highlightText(String(row.title || ""), tokens),
    content_highlight: highlightText(String(row.summary || ""), tokens),
  }));

  return successResponse({
    items,
    total: countResult?.total || 0,
    page,
    page_size,
    query: q,
  });
}
