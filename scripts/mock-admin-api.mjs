/**
 * #68 / T7：编辑器的有状态本地 admin API（纯状态机，不含 HTTP）。
 *
 * 与 `scripts/mock-article-api.mjs` 同一进程内共用一份内存文章数据：
 * 编辑器的 `PUT /articles/:id` 写入后，文章页 SSR 的
 * `GET /articles/:slug` 会读到同一份 Markdown。这正是 spec §10.3
 * 要求的「只用 page.route 覆盖不了 SSR 服务端取数」的解法——
 * 浏览器请求由回归脚本转发到本 mock，SSR 取数由 dev-only
 * `ARTICLE_API_ORIGIN` 直连同一个进程。
 *
 * 本文件不 import node:http，因此可在 vitest 里直接测状态机
 * （tests/mock-admin-api.test.ts）；HTTP 适配在 mock-article-api.mjs。
 */

export const EDITOR_ARTICLE_ID = 7;
export const EDITOR_ARTICLE_SLUG = "editor-regression";
export const BASE_MARKER = "EDITOR_BASE_MARKER_68";
export const FOOTER_MARKER = "EDITOR_SAVED_MARKER_68";
export const MOCK_UPLOAD_URL = "/api/v1/media/serve/media/2026/11/mock.png";

/** mock 自有运维端点（不属于 Worker API，也不计入 articleRequests）。 */
export const MOCK_CONTROL_PATHS = {
  control: "/__control",
  reset: "/__reset",
  stats: "/__stats",
};

/**
 * 安全语料：GFM 表格 / 围栏代码 / 引用 / 图片 / 普通链接 / data-embed。
 * 手写字面量，与 tests/fixtures/editor/markdown-corpus.ts 的类别对齐；
 * 打开后应进入 WYSIWYG（T0 结论：7 项装配下这些语法可语义等价往返）。
 */
export const SAFE_MARKDOWN = [
  "# 编辑器回归基线",
  "",
  `> 引用段落，含唯一标记：${BASE_MARKER}。`,
  "",
  "| 列 A | 列 B |",
  "| --- | --- |",
  "| 值 1 | 值 2 |",
  "",
  "```js",
  "const baseline = true;",
  "```",
  "",
  "普通 [站内链接](/about) 与 ![封面](/media/cover.png)。",
  "",
  '<a href="https://example.com/embed" data-embed="1">内嵌预览</a>',
].join("\n");

/**
 * 有损语料（实测来源，非人为 stub）：图片 alt 里的行内 Markdown 标记会被
 * Milkdown 序列化剥掉——`![**粗体** 与 `代码`](/m.png)` 往返后 alt 变为
 * `粗体 与 代码`，消毒 HTML 的 alt 属性不同，守卫判 lossy。
 *
 * 7 项装配下 T0 的 15 条语料全部 safe，任务列表 / 原始 HTML / 硬换行 /
 * setext / 缩进代码等常见候选实测也全部 safe；只有 alt 内标记与空链接文本
 * 会真实改变渲染结果。本语料是浏览器回归里「lossy → 源码模式」的唯一
 * 真实输入，若内核升级后变为 safe，脚本会明确失败而不是静默跳过。
 */
export const LOSSY_MARKDOWN = [
  "# 有损语料",
  "",
  "图片 alt 含行内 Markdown：![**粗体** 与 `代码`](/media/cover.png)。",
  "",
  "正文结尾。",
].join("\n");

const ok = (data) => ({ code: 0, message: "ok", data });
const fail = (code, message, data = null) => ({ code, message, data });

const DETAIL_FIELDS = [
  "author_id",
  "category",
  "category_id",
  "content",
  "cover_image",
  "created_at",
  "id",
  "slug",
  "status",
  "summary",
  "tags",
  "title",
  "updated_at",
];

function seedArticle() {
  return {
    id: EDITOR_ARTICLE_ID,
    title: "编辑器回归基线文章",
    slug: EDITOR_ARTICLE_SLUG,
    content: SAFE_MARKDOWN,
    summary: "编辑器回归摘要",
    cover_image: "",
    category_id: 1,
    category: { id: 1, name: "技术", slug: "tech" },
    tags: [{ id: 2, name: "Astro", slug: "astro" }],
    status: "published",
    author_id: 1,
    created_at: "2026-10-22T00:00:00.000Z",
    updated_at: "2026-10-22T00:00:00.000Z",
    view_count: 3,
    like_count: 0,
    reading_time: 1,
    published_at: "2026-10-22T00:00:00.000Z",
  };
}

function editDetail(record) {
  const detail = {};
  for (const field of DETAIL_FIELDS) detail[field] = record[field];
  return detail;
}

function publicDetail(record) {
  return {
    id: record.id,
    title: record.title,
    slug: record.slug,
    content: record.content,
    summary: record.summary,
    cover_image: record.cover_image,
    category: record.category,
    tags: record.tags,
    status: record.status,
    view_count: record.view_count,
    like_count: record.like_count,
    reading_time: record.reading_time,
    published_at: record.published_at,
  };
}

function listItem(record) {
  return {
    id: record.id,
    title: record.title,
    slug: record.slug,
    author_name: "管理员",
    author_id: record.author_id,
    status: record.status,
    view_count: record.view_count,
    created_at: record.created_at,
    category: record.category,
  };
}

/** 简单目录端点的最小合法响应，避免后台首屏因缺字段报错。 */
function catalogFixture(pathname) {
  if (pathname === "/api/v1/settings") return ok(null);
  if (pathname === "/api/v1/categories")
    return ok({ items: [{ id: 1, name: "技术", slug: "tech" }], total: 1 });
  if (pathname === "/api/v1/tags")
    return ok({
      items: [{ id: 2, name: "Astro", slug: "astro" }],
      total: 1,
      page: 1,
      page_size: 20,
      total_pages: 1,
    });
  if (pathname === "/api/v1/users") return ok([]);
  // 后台首屏还会拉 /friend-links/all；缺了它会以 404 污染控制台（#68 实测）。
  if (pathname.startsWith("/api/v1/friend-links")) return ok([]);
  if (pathname === "/api/v1/comments")
    return ok({ items: [], total: 0, page: 1, page_size: 20 });
  if (pathname.startsWith("/api/v1/analytics"))
    return ok({
      range: "7d",
      pv: 0,
      uv: 0,
      bot_filtered: 0,
      engaged: null,
      insufficient: true,
      buckets: [],
      items: [],
      total: 0,
    });
  if (pathname === "/api/v1/media")
    return ok({ items: [], total: 0, page: 1, page_size: 20 });
  return null;
}

export function createAdminApiState() {
  let articles;
  let nextId;
  let flags;
  let counters;

  function reset() {
    articles = new Map();
    articles.set(EDITOR_ARTICLE_ID, seedArticle());
    nextId = EDITOR_ARTICLE_ID + 1;
    flags = {
      failLoad: false,
      failSave: false,
      lockConflict: false,
      verifyConflict: false,
    };
    counters = {
      putRequests: 0,
      postRequests: 0,
      lockAcquireRequests: 0,
      lockDeleteRequests: 0,
      lockForceRequests: 0,
      uploadRequests: 0,
      savedBodies: [],
    };
  }

  reset();

  function control(patch = {}) {
    for (const [key, value] of Object.entries(patch)) {
      if (key in flags) flags[key] = Boolean(value);
    }
    return { ...flags };
  }

  function stats() {
    return {
      ...counters,
      savedBodies: counters.savedBodies.map((body) => ({ ...body })),
      flags: { ...flags },
      articles: [...articles.values()].map((record) => ({ ...record })),
    };
  }

  function findBySlug(slug) {
    for (const record of articles.values()) {
      if (record.slug === slug) return record;
    }
    return null;
  }

  function applyPayload(record, body = {}) {
    const next = { ...record };
    for (const field of [
      "title",
      "slug",
      "content",
      "summary",
      "cover_image",
      "status",
      "category_id",
      "tags",
    ]) {
      if (body[field] !== undefined) next[field] = body[field];
    }
    if (next.tags) {
      next.tags = next.tags.map((tag, index) =>
        typeof tag === "string" ? { id: index + 1, name: tag, slug: tag } : tag
      );
    }
    next.updated_at = "2026-11-15T00:00:00.000Z";
    return next;
  }

  /**
   * 处理一个 Worker API 请求。
   * @returns {{status:number, body:object}|null} null 表示不由本层处理，
   *   交给 mock-article-api.mjs 的 SSR 回归分支（保持 #41 行为不变）。
   */
  function handle(method, pathWithQuery, body) {
    const path = String(pathWithQuery || "").split("?")[0];
    if (!path.startsWith("/api/v1/")) return null;

    const editMatch = path.match(/^\/api\/v1\/articles\/(\d+)\/edit$/);
    const forceMatch = path.match(
      /^\/api\/v1\/articles\/(\d+)\/edit-lock\/force$/
    );
    const lockMatch = path.match(/^\/api\/v1\/articles\/(\d+)\/edit-lock$/);
    const idMatch = path.match(/^\/api\/v1\/articles\/(\d+)$/);
    const slugMatch = path.match(/^\/api\/v1\/articles\/([^/]+)$/);

    if (method === "POST" && path === "/api/v1/auth/login") {
      return {
        status: 200,
        body: ok({
          token: "regression-token",
          user: { id: 1, username: "admin", role: "admin" },
        }),
      };
    }

    if (method === "POST" && path === "/api/v1/media/upload") {
      counters.uploadRequests += 1;
      return {
        status: 200,
        body: ok({
          url: MOCK_UPLOAD_URL,
          original_name: body?.original_name || "photo.png",
        }),
      };
    }

    if (method === "POST" && forceMatch) {
      counters.lockForceRequests += 1;
      flags.lockConflict = false;
      return { status: 200, body: ok(null) };
    }

    if (lockMatch) {
      const id = Number(lockMatch[1]);
      if (method === "DELETE") {
        counters.lockDeleteRequests += 1;
        return { status: 200, body: ok(null) };
      }
      if (method === "POST") {
        counters.lockAcquireRequests += 1;
        const once = flags.verifyConflict;
        if (once) flags.verifyConflict = false;
        if (flags.lockConflict || once) {
          return {
            status: 409,
            body: fail(10006, "文章正在被另一位编辑编辑", {
              holder_name: "另一位编辑",
              expires_at: "2026-11-15T23:00:00.000Z",
            }),
          };
        }
        return { status: 200, body: ok({ article_id: id }) };
      }
      return null;
    }

    if (method === "GET" && editMatch) {
      const record = articles.get(Number(editMatch[1]));
      if (flags.failLoad) {
        return { status: 500, body: fail(10008, "mock 加载失败") };
      }
      if (!record)
        return { status: 404, body: fail(10005, "Article not found") };
      return { status: 200, body: ok(editDetail(record)) };
    }

    if (path === "/api/v1/articles") {
      if (method === "GET") {
        const items = [...articles.values()].map(listItem);
        return {
          status: 200,
          body: ok({
            items,
            total: items.length,
            page: 1,
            page_size: 20,
            total_pages: 1,
          }),
        };
      }
      if (method === "POST") {
        counters.postRequests += 1;
        counters.savedBodies.push({ ...(body || {}) });
        if (flags.failSave) {
          return { status: 500, body: fail(10008, "mock 保存失败") };
        }
        const id = nextId++;
        const record = applyPayload(
          {
            ...seedArticle(),
            id,
            slug: body?.slug || `draft-${id}`,
            title: body?.title || "",
            content: body?.content || "",
            status: body?.status || "draft",
            view_count: 0,
            published_at:
              body?.status === "published" ? "2026-11-15T00:00:00.000Z" : null,
          },
          body
        );
        articles.set(id, record);
        return { status: 200, body: ok({ id }) };
      }
    }

    if (method === "PUT" && idMatch) {
      const id = Number(idMatch[1]);
      counters.putRequests += 1;
      counters.savedBodies.push({ ...(body || {}) });
      if (flags.failSave) {
        return { status: 500, body: fail(10008, "mock 保存失败") };
      }
      const current = articles.get(id);
      if (!current)
        return { status: 404, body: fail(10005, "Article not found") };
      articles.set(id, applyPayload(current, body));
      return { status: 200, body: ok({ id }) };
    }

    if (method === "GET" && slugMatch) {
      const slug = decodeURIComponent(slugMatch[1]);
      const record = findBySlug(slug);
      // 本状态机里没有的 slug（ssr-regression / missing-fixture / boom-fixture）
      // 交回 #41 的 SSR 分支，保持原回归的三态契约不被 admin 层吞掉。
      if (!record) return null;
      if (record.status !== "published") {
        return { status: 404, body: fail(10005, "Article not found") };
      }
      return { status: 200, body: ok(publicDetail(record)) };
    }

    const catalog = catalogFixture(path);
    if (catalog) return { status: 200, body: catalog };

    return null;
  }

  return { handle, stats, control, reset };
}
