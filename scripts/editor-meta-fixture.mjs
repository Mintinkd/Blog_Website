/**
 * 编辑器元信息面板两条 Playwright 回归的共享 fixture（issue #67 / T6）。
 *
 * `docs/agents/testing.md`：「mock、脚本、断言共用的端口、路径、资源匹配器放
 * 同一 fixture 模块，避免三处各写一份后漂移」。因此入口选择器、编辑器视口
 * 矩阵与 /api/v1/** 的响应只在这里定义一份，由
 * `verify-visual-friendliness.mjs`（观感）与 `verify-editor-responsive.mjs`
 * （响应式 / 交互）共同 import。两个脚本仍各自负责自己的断言，不共享判定逻辑。
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
  if (
    pathname.endsWith("/edit-lock") ||
    pathname.endsWith("/edit-lock/force")
  ) {
    return ok(null);
  }
  if (pathname.endsWith("/users")) return ok([]);
  return emptyList();
}
