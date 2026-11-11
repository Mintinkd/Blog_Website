/**
 * #58 后台「统计」面板的手动 Playwright 回归。
 *
 * 用法（需先启动 dev server）：
 *   npx astro dev --port 4321
 *   node scripts/verify-admin-analytics.mjs
 *   # Windows 用系统 Edge：PW_CHANNEL=msedge node scripts/verify-admin-analytics.mjs
 *   # 自定义地址：BASE=http://localhost:4321 node scripts/verify-admin-analytics.mjs
 *
 * 只拦截 /api/v1/** 返回本地 fixture，不访问真实 Worker；
 * 覆盖：空库卡片 —/0、数据积累中、数据不足、无控制台报错；
 * 有 2 天以上数据时 PV/UV 双线与 sparkline 渲染、Tier 1 卡片不出现。
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:4321";
const CHANNEL = process.env.PW_CHANNEL;
const DAYS = Array.from({ length: 7 }, (_, i) => `2026-11-0${i + 3}`);

const ok = (data) => ({ code: 0, message: "ok", data });

function fixtures(mode) {
  const empty = mode === "empty";
  const modeError = mode === "error";
  const days = DAYS.map((day, index) => ({
    day,
    pv: !empty && index >= 5 ? (index - 4) * 5 : 0,
    uv: !empty && index >= 5 ? (index - 4) * 2 : 0,
    bot_filtered: !empty && index >= 5 ? 1 : 0,
  }));
  return {
    modeError,
    overview: ok({
      range: "7d",
      pv: empty ? 0 : 15,
      uv: empty ? 0 : 6,
      bot_filtered: empty ? 0 : 2,
      engaged: null,
    }),
    trend: ok({
      range: "7d",
      from: DAYS[0],
      to: DAYS.at(-1),
      days,
    }),
    articles: ok({
      range: "7d",
      page: 1,
      page_size: 20,
      total: empty ? 0 : 1,
      total_pages: empty ? 0 : 1,
      since: empty ? null : "2026-10-01",
      items: empty
        ? []
        : [
            {
              id: 7,
              title: "服务端渲染",
              slug: "ssr",
              pv: 15,
              uv: 6,
              top_referrer: "news.example.test",
              sparkline: [0, 0, 0, 0, 0, 5, 10],
              engaged_rate: null,
              avg_dwell_bucket: null,
            },
          ],
    }),
    quality: ok({
      range: "7d",
      from: DAYS[0],
      to: DAYS.at(-1),
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
    dimensions: (dim) =>
      ok({
        dim,
        range: "7d",
        article_id: null,
        total: empty ? 0 : 25,
        insufficient: empty,
        buckets: empty
          ? []
          : [
              { bucket: "desktop", count: 20 },
              { bucket: "other", count: 5 },
            ],
      }),
  };
}

function fixtureFor(pathname, searchParams, fixture) {
  if (fixture.modeError && pathname.includes("/admin/analytics/overview")) {
    return { code: 500, data: null };
  }
  if (pathname.includes("/admin/analytics/overview")) return fixture.overview;
  if (pathname.includes("/admin/analytics/trend")) return fixture.trend;
  if (pathname.includes("/admin/analytics/articles")) return fixture.articles;
  if (pathname.includes("/admin/analytics/quality")) return fixture.quality;
  if (pathname.includes("/admin/analytics/dimensions")) {
    return fixture.dimensions(searchParams.get("dim"));
  }
  // loadInitialData() 的其它接口：数组型或分页型空数据，避免模板报错
  if (
    pathname.endsWith("/users") ||
    pathname.includes("/comments") ||
    pathname.endsWith("/categories") ||
    pathname.endsWith("/tags") ||
    pathname.includes("/friend-links")
  ) {
    return ok([]);
  }
  return ok({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
    total_pages: 0,
  });
}

async function openPanel(browser, mode) {
  const context = await browser.newContext({ locale: "zh-CN" });
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
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const fixture = fixtures(mode);
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixtureFor(url.pathname, url.searchParams, fixture)),
    });
  });

  await page.goto(`${BASE}/admin`, { waitUntil: "load" });
  await page.waitForSelector(".admin-layout");
  await page.getByRole("button", { name: "统计" }).click();
  await page.waitForSelector(".analytics-panel");
  await page.waitForFunction(
    () => !document.querySelector(".analytics-panel .loading")
  );
  return { context, page, errors };
}

async function run() {
  const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
  try {
    {
      const { context, page, errors } = await openPanel(browser, "empty");
      try {
        const cards = await page
          .locator(".analytics-card-value")
          .allTextContents();
        assert.deepEqual(
          cards.map((text) => text.trim()),
          ["—", "—", "0"],
          "空库概览卡应显示 — / — / 0"
        );
        assert.equal(
          await page.locator(".analytics-card").count(),
          3,
          "Tier 1 卡片不得出现"
        );
        assert.match(
          await page.locator(".analytics-section").first().innerText(),
          /数据积累中/,
          "无趋势数据时应显示「数据积累中」"
        );
        assert.match(
          await page.locator(".analytics-dim").first().innerText(),
          /数据不足/,
          "小样本应显示「数据不足」"
        );
        assert.match(
          await page.locator(".analytics-table").first().innerText(),
          /该时间段暂无阅读数据/,
          "文章表空态"
        );
        assert.deepEqual(errors, [], `空库场景控制台不应报错：${errors}`);
        console.log("OK 空库：卡片 —/—/0、数据积累中、数据不足、空态、无报错");
      } finally {
        await context.close();
      }
    }

    {
      const { context, page, errors } = await openPanel(browser, "data");
      try {
        const cards = await page
          .locator(".analytics-card-value")
          .allTextContents();
        assert.deepEqual(
          cards.map((text) => text.trim()),
          ["15", "6", "2"],
          "有数据时概览卡显示汇总值"
        );
        assert.equal(
          await page.locator(".analytics-trend path").count(),
          2,
          "趋势图应有 PV / UV 双线"
        );
        assert.ok(
          (await page.locator(".analytics-spark path").count()) >= 1,
          "文章表应渲染 7 日 sparkline"
        );
        assert.equal(
          await page.locator(".analytics-card").count(),
          3,
          "Tier 1 卡片仍不得出现"
        );
        assert.deepEqual(errors, [], `有数据场景控制台不应报错：${errors}`);
        console.log(
          "OK 有数据：概览卡、PV/UV 双线、sparkline、Tier 1 隐藏、无报错"
        );
      } finally {
        await context.close();
      }
    }

    {
      const { context, page, errors } = await openPanel(browser, "error");
      try {
        const errorBox = page.locator(".analytics-panel .error-msg");
        await errorBox.waitFor({ timeout: 10000 });
        const detail = await page
          .locator(".analytics-error-detail")
          .innerText();
        // 纯函数拼接格式由 tests/analytics-view.test.ts 锁定，浏览器层只确认细节可见
        assert.match(detail, /overview/, "错误态应指出失败接口");
        assert.deepEqual(errors, [], `错误态控制台不应报错：${errors}`);
        console.log("OK 错误态：显示失败接口、无报错");
      } finally {
        await context.close();
      }
    }
    console.log("\nPASS：后台「统计」面板浏览器回归全部通过");
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
