/**
 * 后台管理页移动端可读性回归。
 *
 * 背景：`/admin` 的文章管理等 6 张 `.data-table` 在 <768px 仍按 7 列表格渲染，
 * 375px 下每列只剩约 40px，中文标题被拆成竖排单字，操作按钮也挤成细条。
 * 本脚本在 280px / 375px 触控视口下逐页检查：
 *   1. 表格单元格不得窄于 120px（卡片化后每格接近整行宽度）；
 *   2. 页面不得出现横向滚动；
 *   3. 后台主区域不得被表格撑破。
 *
 * 用法（需先启动 dev server）：
 *   npm run dev -- --port 4321
 *   node scripts/verify-admin-responsive.mjs
 *   # Windows 用系统 Edge：PW_CHANNEL=msedge node scripts/verify-admin-responsive.mjs
 *   # 自定义地址：BASE=http://localhost:4321 node scripts/verify-admin-responsive.mjs
 *
 * 所有 /api/v1/** 均由本地 fixture 返回，不依赖真实 Worker 与账号。
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:4321";
const CHANNEL = process.env.PW_CHANNEL;
const SHOT_DIR = process.env.SHOT_DIR;
const MIN_CELL_WIDTH = 120;
const VIEWPORTS = [
  { name: "280px", width: 280, height: 653 },
  { name: "375px", width: 375, height: 667 },
];

const ok = (data) => ({ code: 0, message: "ok", data });

const ARTICLE_ROWS = [
  {
    id: 1,
    title: "移动端后台表格可读性改造记录",
    slug: "mobile-admin-table",
    author_name: "管理员",
    status: "published",
    view_count: 2006,
    created_at: "2026-11-06T08:00:00Z",
    category: { id: 1, name: "前端" },
  },
  {
    id: 2,
    title: "一篇标题足够长、会触发换行的草稿文章",
    slug: "long-title-draft",
    author_name: "编辑者",
    status: "draft",
    view_count: 0,
    created_at: "2026-11-07T09:30:00Z",
    category: { id: 2, name: "后端" },
  },
];

const FIXTURES = {
  articles: () =>
    ok({
      items: ARTICLE_ROWS,
      total: ARTICLE_ROWS.length,
      page: 1,
      page_size: 100,
      total_pages: 1,
    }),
  categories: () =>
    ok([
      { id: 1, name: "前端", slug: "frontend", article_count: 12 },
      { id: 2, name: "后端", slug: "backend", article_count: 8 },
    ]),
  tags: () =>
    ok([
      { id: 1, name: "CSS", slug: "css" },
      { id: 2, name: "Astro", slug: "astro" },
    ]),
  comments: () =>
    ok([
      {
        id: 1,
        nickname: "访客",
        content:
          "这是一条比较长的评论内容，用来确认移动端卡片会完整换行，而不是被截成一行省略号。",
        article_slug: "mobile-admin-table",
        article_title: "移动端后台表格可读性改造记录",
        status: "pending",
        created_at: "2026-11-08T10:00:00Z",
      },
    ]),
  users: () =>
    ok([
      {
        id: 1,
        username: "admin",
        display_name: "管理员",
        role: "admin",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: 2,
        username: "editor",
        display_name: "编辑者",
        role: "editor",
        created_at: "2026-02-01T00:00:00Z",
      },
    ]),
  friendLinks: () =>
    ok([
      {
        id: 1,
        name: "Example",
        url: "https://example.com/a/very/long/friend/link/path",
        safe_url: "https://example.com/",
        description: "示例友链",
        sort_order: 1,
        is_active: true,
      },
    ]),
  media: () => ok({ items: [] }),
  config: () =>
    ok({
      site_title: "Blog",
      site_subtitle: "记录技术与生活",
      site_description: "响应式后台回归",
      posts_per_page: "10",
      about_content: "",
      profile_card: "",
    }),
  analyticsOverview: () =>
    ok({ range: "7d", pv: 0, uv: 0, bot_filtered: 0, engaged: null }),
  analyticsTrend: () =>
    ok({
      range: "7d",
      from: "2026-11-06",
      to: "2026-11-12",
      days: [],
    }),
  analyticsArticles: () =>
    ok({
      range: "7d",
      page: 1,
      page_size: 20,
      total: 0,
      total_pages: 0,
      items: [],
    }),
  analyticsQuality: () =>
    ok({
      range: "7d",
      from: "2026-11-06",
      to: "2026-11-12",
      pv: 0,
      uv: 0,
      requests: 0,
      bot_filtered: 0,
      bot_ratio: null,
      bot_ratio_alert: false,
      proxy_coverage: null,
      proxy_coverage_alert: false,
      heartbeat_at: null,
      heartbeat_alert: false,
      anomaly: false,
      today_pv: 0,
      baseline_mean: 0,
      baseline_sigma: 0,
      token_rows: 0,
      token_rows_alert: false,
      engaged_rate: null,
    }),
  analyticsDimensions: (dim) =>
    ok({
      dim,
      range: "7d",
      article_id: null,
      total: 0,
      insufficient: true,
      buckets: [],
    }),
  // 返回 null 时后台保留 getDefaultSettings()，外观页仍可完整渲染
  settings: () => ok(null),
};

function fixtureFor(pathname, searchParams) {
  if (pathname.includes("/admin/analytics/overview")) {
    return FIXTURES.analyticsOverview();
  }
  if (pathname.includes("/admin/analytics/trend")) {
    return FIXTURES.analyticsTrend();
  }
  if (pathname.includes("/admin/analytics/articles")) {
    return FIXTURES.analyticsArticles();
  }
  if (pathname.includes("/admin/analytics/quality")) {
    return FIXTURES.analyticsQuality();
  }
  if (pathname.includes("/admin/analytics/dimensions")) {
    return FIXTURES.analyticsDimensions(searchParams.get("dim"));
  }
  if (pathname.includes("/friend-links")) return FIXTURES.friendLinks();
  if (pathname.endsWith("/categories")) return FIXTURES.categories();
  if (pathname.endsWith("/tags")) return FIXTURES.tags();
  if (pathname.endsWith("/users")) return FIXTURES.users();
  if (pathname.includes("/comments")) return FIXTURES.comments();
  if (pathname.endsWith("/media")) return FIXTURES.media();
  if (pathname.includes("/config")) return FIXTURES.config();
  if (pathname.includes("/settings")) return FIXTURES.settings();
  if (pathname.includes("/articles")) return FIXTURES.articles();
  return ok([]);
}

const TABLE_TABS = [
  { label: "文章管理", name: "articles" },
  { label: "分类管理", name: "categories" },
  { label: "标签管理", name: "tags" },
  { label: "评论管理", name: "comments" },
  { label: "账户管理", name: "users" },
  { label: "友情链接", name: "friend_links" },
];

const OTHER_TABS = [
  "统计",
  "网页抓取",
  "关于页面",
  "图片管理",
  "站点配置",
  "外观与个性化",
];

async function openAdmin(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    hasTouch: true,
    locale: "zh-CN",
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("locale", "zh");
      localStorage.setItem("admin_token", "regression-token");
      localStorage.setItem("admin_role", "admin");
      localStorage.setItem("admin_user_id", "1");
    } catch {
      // about:blank 等非 http 文档没有 localStorage，忽略
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixtureFor(url.pathname, url.searchParams)),
    });
  });
  await page.goto(`${BASE}/admin`, { waitUntil: "load" });
  await page.waitForSelector(".admin-layout");
  return { context, page, errors };
}

async function clickTab(page, label) {
  await page
    .locator(".sidebar-nav .nav-item")
    .filter({ hasText: label })
    .first()
    .click();
  await page.waitForFunction(
    (expected) => {
      const active = document.querySelector(".sidebar-nav .nav-item.active");
      return (
        active?.textContent?.includes(expected) &&
        !document.querySelector(".admin-panel .loading")
      );
    },
    label,
    { timeout: 15000 }
  );
}

async function assertNoHorizontalScroll(page, label) {
  const metrics = await page.evaluate(() => {
    const main = document.querySelector(".admin-main");
    const mainRect = main?.getBoundingClientRect();
    const insideScroller = (el) => {
      let parent = el.parentElement;
      while (parent && parent !== main) {
        const style = getComputedStyle(parent);
        if (style.overflowX === "auto" || style.overflowX === "scroll") {
          return true;
        }
        parent = parent.parentElement;
      }
      return false;
    };
    const describe = (el) => {
      const cls = [...el.classList].slice(0, 2).join(".");
      return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`;
    };
    const offenders =
      mainRect && main
        ? [...main.querySelectorAll("*")]
            .filter((el) => {
              const rect = el.getBoundingClientRect();
              if (!rect.width || !rect.height) return false;
              if (el.classList.contains("sr-only")) return false;
              if (insideScroller(el)) return false;
              return (
                rect.right > mainRect.right + 1 || rect.left < mainRect.left - 1
              );
            })
            .slice(0, 8)
            .map(describe)
        : [];
    return {
      pageScrollWidth: document.documentElement.scrollWidth,
      pageClientWidth: document.documentElement.clientWidth,
      mainScrollWidth: main?.scrollWidth ?? 0,
      mainClientWidth: main?.clientWidth ?? 0,
      offenders,
    };
  });
  assert.ok(
    metrics.pageScrollWidth <= metrics.pageClientWidth + 1,
    `${label}：页面出现横向滚动（${metrics.pageScrollWidth} > ${metrics.pageClientWidth}）`
  );
  assert.ok(
    metrics.mainScrollWidth <= metrics.mainClientWidth + 1,
    `${label}：后台主区域被内容撑破（${metrics.mainScrollWidth} > ${metrics.mainClientWidth}）` +
      (metrics.offenders.length
        ? `；越界元素：${metrics.offenders.join(", ")}`
        : "")
  );
}

async function assertReadableTable(page, viewport, tab) {
  await page.waitForSelector(".data-table tbody tr");
  const result = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".data-table tbody tr")].filter(
      (row) => !row.querySelector(".empty")
    );
    const cells = rows.flatMap((row) => [...row.children]);
    return {
      rows: rows.length,
      cells: cells.length,
      minWidth: cells.length
        ? Math.min(...cells.map((cell) => cell.getBoundingClientRect().width))
        : 0,
      labels: cells.filter((cell) => cell.dataset.label).length,
    };
  });
  assert.ok(result.rows > 0, `${viewport.name} / ${tab.label}：表格应有数据行`);
  assert.ok(
    result.minWidth >= MIN_CELL_WIDTH,
    `${viewport.name} / ${tab.label}：单元格被挤到 ${Math.round(result.minWidth)}px，` +
      `低于 ${MIN_CELL_WIDTH}px，中文会逐字竖排`
  );
  assert.equal(
    result.labels,
    result.cells,
    `${viewport.name} / ${tab.label}：每个单元格都应带 data-label，卡片模式才能显示字段名`
  );
}

async function assertCopyRowReadable(page, viewport) {
  const minWidth = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll(".copy-row input")].filter(
      (input) => input.getBoundingClientRect().width > 0
    );
    return inputs.length
      ? Math.min(...inputs.map((input) => input.getBoundingClientRect().width))
      : 0;
  });
  assert.ok(
    minWidth >= 80,
    `${viewport.name} / 外观与个性化：文案覆盖输入框仅 ${Math.round(minWidth)}px 宽，无法阅读和编辑`
  );
}

async function run() {
  const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
  try {
    for (const viewport of VIEWPORTS) {
      const { context, page, errors } = await openAdmin(browser, viewport);
      try {
        for (const tab of TABLE_TABS) {
          await clickTab(page, tab.label);
          await assertReadableTable(page, viewport, tab);
          await assertNoHorizontalScroll(
            page,
            `${viewport.name} / ${tab.label}`
          );
          if (SHOT_DIR) {
            await page.screenshot({
              path: `${SHOT_DIR}/${viewport.name}-${tab.name}.png`,
              fullPage: true,
            });
          }
        }
        for (const label of OTHER_TABS) {
          await clickTab(page, label);
          await assertNoHorizontalScroll(page, `${viewport.name} / ${label}`);
          if (label === "外观与个性化") {
            await assertCopyRowReadable(page, viewport);
          }
          if (SHOT_DIR) {
            await page.screenshot({
              path: `${SHOT_DIR}/${viewport.name}-${label}.png`,
              fullPage: true,
            });
          }
        }
        assert.deepEqual(
          errors,
          [],
          `${viewport.name}：后台移动端不应有控制台报错：${errors.join(" | ")}`
        );
        console.log(
          `OK ${viewport.name}：6 张数据表均可读，其他面板无横向溢出`
        );
      } finally {
        await context.close();
      }
    }

    {
      const viewport = { name: "1280px", width: 1280, height: 800 };
      const { context, page, errors } = await openAdmin(browser, viewport);
      try {
        await clickTab(page, "文章管理");
        const display = await page
          .locator(".data-table")
          .evaluate((table) => getComputedStyle(table).display);
        assert.equal(
          display,
          "table",
          "1280px / 文章管理：桌面端应保留表格布局，不能被移动端卡片规则影响"
        );
        await assertNoHorizontalScroll(page, "1280px / 文章管理");
        assert.deepEqual(
          errors,
          [],
          `1280px：桌面端不应有控制台报错：${errors.join(" | ")}`
        );
        console.log("OK 1280px：桌面表格布局保持不变");
      } finally {
        await context.close();
      }
    }
    console.log("\nPASS：后台移动端可读性回归全部通过");
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
