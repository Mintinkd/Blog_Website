/**
 * 浏览器前进/后退进入 /admin/ 的手动 Playwright 回归。
 *
 * 背景：Astro ClientRouter 的软导航不会重跑已执行过的模块脚本（跑过的
 * <script type="module" src> 会被打 data-astro-exec，runScripts() 直接跳过）。
 * 后台 Vue 应用若只在脚本顶层挂载一次，popstate 回到 /admin/ 时就只剩一个
 * 空的 #admin-app-mount，表现为「页面不加载」。
 *
 * 用法（需先启动 dev server）：
 *   npx astro dev --port 4321
 *   node scripts/verify-admin-history-nav.mjs
 *   # Windows 用系统 Edge：PW_CHANNEL=msedge node scripts/verify-admin-history-nav.mjs
 *   # 自定义地址：BASE=http://localhost:4321 node scripts/verify-admin-history-nav.mjs
 *
 * 覆盖两个方向：forward 回到后台（同一 document 内的软导航）、back 回到后台
 * （admin 模块脚本在该 document 中尚未执行过的首次软导航）。接口全部拦截，
 * 不依赖真实 Worker。
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:4321";
const CHANNEL = process.env.PW_CHANNEL;
const MOUNT_SELECTOR = "#admin-app-mount";

function fixtureFor(pathname) {
  let data;
  if (
    pathname.includes("friend-links") ||
    pathname.endsWith("/categories") ||
    pathname.endsWith("/tags") ||
    pathname.endsWith("/users") ||
    pathname.includes("/comments")
  ) {
    data = [];
  } else if (pathname.includes("/settings") || pathname.includes("/config")) {
    data = {};
  } else {
    data = { items: [], total: 0, page: 1, page_size: 20, total_pages: 0 };
  }
  return JSON.stringify({ code: 0, message: "ok", data });
}

async function newPage(browser) {
  const context = await browser.newContext({ locale: "zh-CN" });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("locale", "zh");
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
      body: fixtureFor(url.pathname),
    });
  });
  return { context, page, errors };
}

/** 记录 ClientRouter 确实做了软导航，避免 bfcache 恢复让用例假通过。 */
async function watchSwaps(page) {
  await page.evaluate(() => {
    window.__astroSwapCount = 0;
    document.addEventListener("astro:after-swap", () => {
      window.__astroSwapCount += 1;
    });
  });
}

/**
 * 等待 swap 计数达标：popstate 时 URL 会先变化，Astro 的 fetch + swap 是异步的，
 * 不能只等 pathname 就断言，否则会撞上 transition 尚未完成的竞态。
 */
async function waitForSwapCount(page, min, label) {
  try {
    await page.waitForFunction(
      (expected) => (window.__astroSwapCount ?? 0) >= expected,
      min,
      { timeout: 15000 }
    );
  } catch {
    const count = await page.evaluate(() => window.__astroSwapCount ?? 0);
    assert.fail(
      `${label}：应至少发生 ${min} 次 ClientRouter 软导航（after-swap），实测 ${count} 次；` +
        "若为 0 说明走了跨文档/bfcache 恢复，没有测到目标路径"
    );
  }
}

/**
 * 用真实链接点击走 ClientRouter（history.pushState）造同文档历史项。
 * page.goto 造的是跨文档历史项，后退会走 bfcache 恢复而非 popstate 软导航。
 */
async function clickSoftLink(page, href, selector) {
  await page.evaluate((url) => {
    if (document.getElementById("__regression-nav-link")) return;
    const a = document.createElement("a");
    a.id = "__regression-nav-link";
    a.href = url;
    a.textContent = "regression-nav";
    a.style.cssText =
      "position:fixed;top:0;left:0;z-index:99999;padding:6px 10px;background:#fff;color:#000;font-size:12px";
    document.body.appendChild(a);
  }, href);
  await page.locator(selector).click();
}

/** 后台应用挂载的判定：挂载点存在且恰好一个根节点，且 .admin-app 可见。 */
async function waitForAdminApp(page, label) {
  try {
    await page.waitForFunction(
      () => {
        const mount = document.getElementById("admin-app-mount");
        const app = mount && mount.querySelector(".admin-app");
        return (
          !!mount &&
          mount.children.length === 1 &&
          !!app &&
          getComputedStyle(app).display !== "none"
        );
      },
      undefined,
      { timeout: 15000 }
    );
  } catch {
    const mountCount = await page.locator(MOUNT_SELECTOR).count();
    const childCount = mountCount
      ? await page.locator(`${MOUNT_SELECTOR} > *`).count()
      : 0;
    assert.fail(
      `${label}：后台应用未挂载（挂载点=${mountCount}，子节点=${childCount}）；` +
        "挂载点存在但子节点为 0，正是「前进/后退进 /admin/ 页面不加载」的回归"
    );
  }
  const count = await page.locator(`${MOUNT_SELECTOR} > *`).count();
  assert.equal(count, 1, `${label}：挂载点下应恰好有一个应用根节点`);
  await page
    .locator(".admin-app")
    .waitFor({ state: "visible", timeout: 15000 });
}

async function assertUnmounted(page, label) {
  const alive = await page.evaluate(() =>
    Boolean(window.__blogAdminRuntime && window.__blogAdminRuntime.app)
  );
  assert.equal(
    alive,
    false,
    `${label}：离开后台后应卸载旧 Vue 实例（避免监听器/编辑锁残留）`
  );
}

async function scenarioForward(browser) {
  const { context, page, errors } = await newPage(browser);
  try {
    // 硬加载 /，再用真实链接点击软导航进 /admin/，造出同文档的 popstate 历史项
    await page.goto(`${BASE}/`, { waitUntil: "load" });
    await page.waitForSelector(".site-header");
    await watchSwaps(page);
    await clickSoftLink(page, "/admin/", "#__regression-nav-link");
    await page.waitForFunction(
      () => location.pathname.startsWith("/admin"),
      undefined,
      {
        timeout: 15000,
      }
    );
    await waitForAdminApp(page, "首次软导航进入");
    await waitForSwapCount(page, 1, "首次软导航进入后台");
    console.log(
      "OK 首次软导航 /admin/（脚本首次于 runScripts 执行）：Vue 应用已挂载"
    );

    // 后退离开后台（popstate 软导航）
    await page.evaluate(() => history.back());
    await page.waitForFunction(
      () =>
        location.pathname === "/" &&
        !document.getElementById("admin-app-mount"),
      undefined,
      { timeout: 15000 }
    );
    await waitForSwapCount(page, 2, "后退离开后台");
    await assertUnmounted(page, "后退离开后台");

    // 前进回到后台：修复前这里只剩空 div，waitForAdminApp 会超时
    await page.evaluate(() => history.forward());
    await page.waitForFunction(
      () => location.pathname.startsWith("/admin"),
      undefined,
      {
        timeout: 15000,
      }
    );
    await waitForSwapCount(page, 3, "前进回到后台");
    await waitForAdminApp(page, "前进回到后台");
    console.log("OK 前进回到 /admin/：Vue 应用重新挂载且只有一份");

    // 再来一轮，验证幂等（不重复挂载、不残留实例）
    await page.evaluate(() => history.back());
    await page.waitForFunction(
      () =>
        location.pathname === "/" &&
        !document.getElementById("admin-app-mount"),
      undefined,
      { timeout: 15000 }
    );
    await assertUnmounted(page, "第二轮后退离开后台");
    await page.evaluate(() => history.forward());
    await page.waitForFunction(
      () => location.pathname.startsWith("/admin"),
      undefined,
      {
        timeout: 15000,
      }
    );
    await waitForSwapCount(page, 5, "第二轮前进回到后台");
    await waitForAdminApp(page, "第二轮前进回到后台");
    console.log("OK 反复前进/后退：挂载保持幂等");

    assert.deepEqual(errors, [], `控制台不应报错：${errors.join(" | ")}`);
    console.log("OK 前进场景：控制台无报错");
  } finally {
    await context.close();
  }
}

async function scenarioBack(browser) {
  const { context, page, errors } = await newPage(browser);
  try {
    // 同文档历史栈：/ → /admin/ → /，然后 back 回到 /admin/
    await page.goto(`${BASE}/`, { waitUntil: "load" });
    await page.waitForSelector(".site-header");
    await watchSwaps(page);
    await clickSoftLink(page, "/admin/", "#__regression-nav-link");
    await page.waitForFunction(
      () => location.pathname.startsWith("/admin"),
      undefined,
      {
        timeout: 15000,
      }
    );
    await waitForAdminApp(page, "场景 B 软导航进入后台");

    // 点站点 logo 回首页（同样是 ClientRouter 软导航），制造可后退的历史项
    await page.locator(".site-logo").click();
    await page.waitForFunction(
      () =>
        location.pathname === "/" &&
        !document.getElementById("admin-app-mount"),
      undefined,
      { timeout: 15000 }
    );
    await waitForSwapCount(page, 2, "场景 B 离开后台");
    await assertUnmounted(page, "场景 B 离开后台");

    // 后退进入后台
    await page.evaluate(() => history.back());
    await page.waitForFunction(
      () => location.pathname.startsWith("/admin"),
      undefined,
      {
        timeout: 15000,
      }
    );
    await waitForSwapCount(page, 3, "后退回到后台");
    await waitForAdminApp(page, "后退回到后台");
    console.log("OK 后退进入 /admin/：Vue 应用已挂载");

    assert.deepEqual(errors, [], `控制台不应报错：${errors.join(" | ")}`);
    console.log("OK 后退场景：控制台无报错");
  } finally {
    await context.close();
  }
}

async function run() {
  const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
  try {
    await scenarioForward(browser);
    await scenarioBack(browser);
    console.log("\nPASS：后台前进/后退导航回归全部通过");
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
