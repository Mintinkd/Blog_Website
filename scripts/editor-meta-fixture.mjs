/**
 * 编辑器元信息面板两条 Playwright 回归的共享 fixture（issue #67 / T6、#68 / T7）。
 *
 * `docs/agents/testing.md`：「mock、脚本、断言共用的端口、路径、资源匹配器放
 * 同一 fixture 模块，避免三处各写一份后漂移」。因此入口选择器、编辑器视口
 * 矩阵、编辑详情字面量与 /api/v1/** 的响应只在这里定义一份，由
 * `verify-visual-friendliness.mjs`（观感）、`verify-editor-responsive.mjs`
 * （响应式 / 交互）与 `verify-admin-responsive.mjs`（后台遮罩）共同 import。
 * 各脚本仍各自负责自己的断言，不共享判定逻辑。
 *
 * T7 #68：补 `GET /articles/:id/edit` 的详情响应与列表里的一行可编辑文章，
 * 让脚本能从列表「编辑」按钮进入「加载了完整正文」的编辑器（而非只有
 * 新建文章入口的空编辑器）。
 */

export const ok = (data) => ({ code: 0, message: "ok", data });

export const emptyList = () =>
  ok({ items: [], total: 0, page: 1, page_size: 20, total_pages: 0 });

/** 与按钮文案无关的稳定入口，中英文 locale 下都可定位（ArticlesPanel.vue）。 */
export const EDITOR_ENTRY_SELECTOR = '[data-editor-entry="new-article"]';

/** 票面验收的 280 / 375 / 1280 三档。 */
export const EDITOR_VIEWPORTS = [
  { name: "280px", width: 280, height: 720 },
  { name: "375px", width: 375, height: 812 },
  { name: "1280px", width: 1280, height: 800 },
];

/**
 * 与 Worker `ArticleEditDetail` 对齐的手写字面量（T7 #68）。
 * 字段形状对齐 `src/admin/editor/useArticleEditor.ts` 的 `ArticleEditDetailLike`：
 * `tags` 是 `{ name }[]` 对象数组，`category_id` 为 number，**不含** `content_html`。
 * 正文含 GFM 表格 / 围栏代码 / 引用 / 图片 / 链接，打开后走 WYSIWYG 渲染，
 * 供观感脚本量测真实工作区；图片路径与 verify-admin-responsive.mjs 的
 * 本地 SVG 兜底 route 对应，避免 /media/cover.png 404 污染控制台断言。
 */
export const EDITOR_EDIT_DETAIL = {
  id: 1,
  title: "编辑器观感回归基线",
  slug: "editor-visual-baseline",
  content: [
    "# 编辑器观感基线",
    "",
    "> 引用段落：用于量测 WYSIWYG 工作区的留白与文本对比度。",
    "",
    "| 视口 | 主题 |",
    "| --- | --- |",
    "| 280px | 亮色 |",
    "| 375px | 暗色 |",
    "",
    "```js",
    "const baseline = true;",
    "```",
    "",
    "普通 [站内链接](/about) 与图片 ![封面](/media/cover.png)。",
    "",
    "结尾段落，确认长文在工作区里纵向滚动而不是横向溢出。",
  ].join("\n"),
  summary: "编辑器观感回归摘要",
  cover_image: "",
  category_id: 1,
  tags: [{ name: "TypeScript" }, { name: "国际化与可访问性实践" }],
  status: "published",
};

/**
 * 列表里的一行可编辑文章（T7 #68）：字段与 verify-admin-responsive.mjs 的
 * ARTICLE_ROWS 风格一致，点第一行的「编辑」按钮即 `emit('edit', a)`
 * → `GET /articles/:id/edit`。刻意不带封面 URL，后台表格不会去请求外链图片。
 * id 与 EDITOR_EDIT_DETAIL.id 对齐，保证详情响应命中同一篇文章。
 */
export const EDITOR_LIST_ROW = {
  id: EDITOR_EDIT_DETAIL.id,
  title: EDITOR_EDIT_DETAIL.title,
  slug: EDITOR_EDIT_DETAIL.slug,
  author_name: "管理员",
  status: EDITOR_EDIT_DETAIL.status,
  view_count: 2006,
  created_at: "2026-11-06T08:00:00Z",
  category: { id: 1, name: "前端" },
};

/** 可选导出：需要「一行可编辑文章」的脚本可显式取用，不依赖 fixtureFor 的默认值。 */
export function articlesListFixture() {
  return ok({
    items: [EDITOR_LIST_ROW],
    total: 1,
    page: 1,
    page_size: 20,
    total_pages: 1,
  });
}

/** 本地 fixture：不访问真实 Worker 与账号；标签含一个较长中文名压裁切用例。 */
export function fixtureFor(pathname) {
  if (pathname.includes("/settings")) return ok(null);
  if (pathname.includes("/config")) {
    return ok({
      site_title: "Blog",
      site_subtitle: "",
      site_description: "观感检查 fixture",
      posts_per_page: "10",
      about_content: "",
      profile_card: "",
    });
  }
  if (pathname.endsWith("/tags")) {
    return ok({
      items: [
        { id: 1, name: "TypeScript" },
        { id: 2, name: "Cloudflare" },
        { id: 3, name: "国际化与可访问性实践" },
      ],
      total: 3,
      page: 1,
      page_size: 20,
      total_pages: 1,
    });
  }
  if (pathname.endsWith("/categories")) {
    return ok({ items: [{ id: 1, name: "技术" }], total: 1 });
  }
  if (pathname.includes("/analytics")) {
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
  }
  // GET /articles/:id/edit：编辑器按稳定 id 取正文（认证接口，无 content_html）。
  // 放在 /articles 列表判断之前，避免被通用列表分支吞掉。
  if (/\/articles\/\d+\/edit$/.test(pathname)) return ok(EDITOR_EDIT_DETAIL);
  // 编辑锁三端点都只要 code:0 即视为通过（useEditLock.ts 只判 code）：
  //   POST   /articles/:id/edit-lock        获取 / 续期锁
  //   DELETE /articles/:id/edit-lock        释放锁
  //   POST   /articles/:id/edit-lock/force  管理员强制接管
  // 本地 fixture 没有并发编辑者，一律 ok(null) 表示「无锁冲突 / 锁已释放」。
  if (
    pathname.endsWith("/edit-lock") ||
    pathname.endsWith("/edit-lock/force")
  ) {
    return ok(null);
  }
  if (pathname.endsWith("/users")) return ok([]);
  // GET /articles：返回一行可编辑文章，供「编辑」按钮进入完整编辑器。
  if (/\/articles$/.test(pathname)) return articlesListFixture();
  return emptyList();
}
