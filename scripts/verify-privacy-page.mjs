/**
 * #59 隐私页的手动 Playwright 回归。
 *
 * 用法（需先启动 dev server）：
 *   npx astro dev --port 4321
 *   node scripts/verify-privacy-page.mjs
 *   # Windows 用系统 Edge：PW_CHANNEL=msedge node scripts/verify-privacy-page.mjs
 *
 * 覆盖：页脚入口可到达 /privacy、中文案完整、切换语言后英文生效、
 * 控制台无报错。/api/v1/** 全部拦截为空数据，不依赖真实 Worker。
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:4321";
const CHANNEL = process.env.PW_CHANNEL;
const ZH_TITLE = "隐私与阅读统计";
const EN_TITLE = "Privacy & Reading Analytics";

async function run() {
  const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
  try {
    const context = await browser.newContext({ locale: "zh-CN" });
    await context.addInitScript(() => {
      try {
        localStorage.setItem("locale", "zh");
      } catch {
        // about:blank 等非 http 文档没有 localStorage
      }
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.route("**/api/v1/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          code: 0,
          message: "ok",
          data: {
            items: [],
            total: 0,
            page: 1,
            page_size: 20,
            total_pages: 0,
          },
        }),
      })
    );

    await page.goto(`${BASE}/`, { waitUntil: "load" });
    const footerLink = page.locator('footer a[href="/privacy"]');
    await footerLink.waitFor({ state: "visible" });
    await footerLink.click();
    await page.waitForURL("**/privacy");

    const title = page.locator(".privacy-page h1");
    await title.waitFor();
    assert.equal(
      (await title.textContent())?.trim(),
      ZH_TITLE,
      "中文标题应由 data-i18n 渲染"
    );

    // 关键披露段落必须出现在静态 HTML 中（无 JS 也完整）
    const body = await page.locator(".privacy-page").innerText();
    for (const phrase of ["HttpOnly", "HMAC-SHA256", "24 小时", "400 天"]) {
      assert.ok(body.includes(phrase), `披露文案应包含 ${phrase}`);
    }

    await page.locator("#locale-toggle-btn").click();
    await page.waitForFunction(
      (expected) =>
        document.querySelector(".privacy-page h1")?.textContent?.trim() ===
        expected,
      EN_TITLE,
      { timeout: 10000 }
    );
    const english = await page.locator(".privacy-page").innerText();
    assert.ok(english.includes("Essential cookie"), "英文文案应生效");

    assert.deepEqual(errors, [], `控制台不应报错：${errors.join(" | ")}`);
    console.log("OK 页脚入口 → /privacy、中英切换、披露文案完整、无报错");
    console.log("\nPASS：隐私页浏览器回归通过");
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
