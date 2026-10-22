/**
 * #41 文章 SSR 浏览器回归的共享 fixture。
 *
 * mock Worker 与 Playwright 脚本共用同一份文章数据与端点表：mock 负责在服务端
 * 返回它，脚本断言这份数据确实出现在服务端 HTML / 无 JS / 阻断 motion chunk
 * 的页面里，并确认 dev server 真的把 SSR 取数指向了本次 mock。
 */

/** mock 默认端口；dev server 的 ARTICLE_API_ORIGIN 必须指向同一端口。 */
export const DEFAULT_MOCK_PORT = 4322;

/** 浏览器 / mock 共用的端点表，避免脚本与 mock 各写一份字面量。 */
export const API_PATHS = {
  config: "/api/v1/config",
  friendLinks: "/api/v1/friend-links",
  settingsPublic: "/api/v1/settings/public",
  articles: "/api/v1/articles/",
};

/** mock 自身的运维端点（不属于 Worker API）。 */
export const MOCK_PATHS = {
  health: "/health",
  stats: "/__stats",
};

/**
 * motion chunk 匹配：dev 是 `/src/utils/motion.ts`，构建产物是
 * `/motion.<hash>.js`。脚本用同一规则阻断请求并过滤对应的资源报错。
 */
export const MOTION_CHUNK_RE = /\/motion[\w.-]*\.(?:m?js|ts)$/;

export function isMotionChunkUrl(url) {
  try {
    return MOTION_CHUNK_RE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export const SITE_TITLE = "SSR 回归测试站";

export const ARTICLE = {
  id: 7,
  title: "SSR 回归验证文章",
  slug: "ssr-regression",
  content: [
    "# 服务端正文标题",
    "",
    "第一段正文，包含唯一标记：SERVER_BODY_MARKER_41。",
    "",
    "## 二级标题",
    "",
    "- 列表项甲",
    "- 列表项乙",
    "",
    "| 列 A | 列 B |",
    "| ---- | ---- |",
    "| 值 1 | 值 2 |",
    "",
    "```js",
    "const ssr = true;",
    "```",
    "",
    "普通 [站内链接](/about)。",
  ].join("\n"),
  summary: "SSR 回归摘要：用于断言禁用 JS 时摘要可见。",
  cover_image: "",
  category: { id: 1, name: "技术", slug: "tech" },
  tags: [{ id: 2, name: "Astro", slug: "astro" }],
  status: "published",
  view_count: 3,
  like_count: 4,
  reading_time: 5,
  published_at: "2026-10-22T00:00:00.000Z",
};

export const ARTICLE_PATH = `/articles/${ARTICLE.slug}`;
export const MISSING_SLUG = "missing-fixture";
export const ERROR_SLUG = "boom-fixture";
export const MISSING_PATH = `/articles/${MISSING_SLUG}`;
export const ERROR_PATH = `/articles/${ERROR_SLUG}`;

/** 正文里的唯一标记：断言服务端 HTML 与无 JS 页面都包含它。 */
export const BODY_MARKER = "SERVER_BODY_MARKER_41";

/** 浏览器端 API fixture（Playwright 拦截同源代理请求，避免打到真实 Worker）。 */
export function browserApiFixture(pathname) {
  if (pathname === API_PATHS.config) {
    return { code: 0, message: "ok", data: { site_title: SITE_TITLE } };
  }
  if (pathname === API_PATHS.friendLinks) {
    return { code: 0, message: "ok", data: [] };
  }
  if (pathname.endsWith("/like-status")) {
    return { code: 0, message: "ok", data: { liked: false } };
  }
  if (pathname.endsWith("/comments")) {
    return {
      code: 0,
      message: "ok",
      data: { items: [], total: 0, page: 1, page_size: 20 },
    };
  }
  return { code: 0, message: "ok", data: null };
}
