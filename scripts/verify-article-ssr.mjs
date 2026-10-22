/**
 * #41 文章详情 SSR 浏览器回归。
 *
 * 用法：
 *   1) npm i -D playwright && npx playwright install chromium
 *      （Windows 也可直接用系统 Edge：PW_CHANNEL=msedge）
 *   2) 启动开发服务器，并把文章页 SSR 取数指向本地 mock：
 *      $env:ARTICLE_API_ORIGIN='http://127.0.0.1:4322'; npx astro dev --port 4321
 *   3) node scripts/verify-article-ssr.mjs
 *
 * 脚本自己拉起 scripts/mock-article-api.mjs，不访问真实 Worker。
 * 覆盖：服务端 HTML 含正文 / 禁用 JS 可见（computed opacity）/ 阻断 motion
 * chunk 后首屏仍可见 / 404 / 502 / 控制台无报错。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  ARTICLE,
  ARTICLE_PATH,
  BODY_MARKER,
  ERROR_PATH,
  MISSING_PATH,
  browserApiFixture,
} from "./article-ssr-fixture.mjs";

const BASE = process.env.BASE || "http://localhost:4321";
const BASE_ORIGIN = new URL(BASE).origin;
const MOCK_PORT = Number(process.env.MOCK_PORT || 4322);
const MOCK_ORIGIN = `http://127.0.0.1:${MOCK_PORT}`;
const MOCK_SCRIPT = fileURLToPath(
  new URL("./mock-article-api.mjs", import.meta.url)
);

const failures = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function waitForOk(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(200);
  }
  throw new Error(`等待 ${url} 就绪超时：${lastError?.message || "unknown"}`);
}

function startMock() {
  const child = spawn(
    process.execPath,
    [MOCK_SCRIPT, "--port", String(MOCK_PORT)],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  child.stdout.on("data", (chunk) => process.stdout.write(`[mock] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[mock] ${chunk}`));
  return child;
}

async function launchBrowser() {
  const channel = process.env.PW_CHANNEL;
  try {
    return await chromium.launch({
      headless: true,
      ...(channel ? { channel } : {}),
    });
  } catch (err) {
    throw new Error(
      `无法启动浏览器。先运行 npx playwright install chromium，或设置 PW_CHANNEL=msedge 使用系统 Edge。原始错误：${err.message}`
    );
  }
}

function isMotionChunk(url) {
  try {
    const pathname = new URL(url).pathname;
    return /\/motion[\w.-]*\.(?:m?js|ts)$/.test(pathname);
  } catch {
    return false;
  }
}

/** 浏览器侧 API 全部本地 fulfill：这些请求走同源代理，page.route 可以拦截。 */
async function installBrowserFixtures(page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== BASE_ORIGIN) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(browserApiFixture(url.pathname)),
    });
  });
  await page.route("https://api.furry.ist/**", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        hitokoto: "回归测试一言",
        from: "verify-article-ssr",
      }),
    })
  );
}

function collectErrors(page, { ignored = [] } = {}) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    const url = message.location()?.url || "";
    if (text.includes("favicon")) return;
    if (ignored.some((pattern) => pattern.test(text) || pattern.test(url))) {
      return;
    }
    errors.push(`${text}${url ? ` (${url})` : ""}`);
  });
  page.on("pageerror", (error) => errors.push(`PAGEERROR: ${error.message}`));
  return errors;
}

async function openPage(browser, options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...options.context,
  });
  const page = await context.newPage();
  const errors = collectErrors(page, { ignored: options.ignored });
  await installBrowserFixtures(page);
  if (options.blockMotion) {
    await page.route(
      (url) => isMotionChunk(url.href),
      (route) => route.abort()
    );
  }
  return { context, page, errors };
}

/** 等页脚 / 岛屿的异步请求落定，避免把尚未触发的报错当成“无报错”。 */
async function waitForIslands(page, { expectArticle = false } = {}) {
  await page
    .waitForSelector(
      ".footer-friend-links .no-links, .footer-friend-links .link-item",
      { timeout: 8000 }
    )
    .catch(() => {});
  if (expectArticle) {
    await page.waitForSelector("#like-button-mount .like-btn", {
      timeout: 8000,
    });
    await page.waitForSelector("#comment-section-mount .comment-section", {
      timeout: 8000,
    });
  }
}

async function readRevealStyles(page) {
  return page.evaluate(() => {
    const read = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        opacity: style.opacity,
        display: style.display,
        visibility: style.visibility,
        height: el.getBoundingClientRect().height,
        text: (el.textContent || "").trim(),
      };
    };
    return {
      title: read(".article-title"),
      summary: read(".article-summary"),
      body: read(".article-content p"),
    };
  });
}

async function assertFirstScreenVisible(page, label) {
  const styles = await readRevealStyles(page);
  for (const [name, value] of Object.entries(styles)) {
    assert.ok(value, `${label}：缺少 ${name} 元素`);
    assert.equal(
      value.opacity,
      "1",
      `${label}：${name} 的 computed opacity 为 ${value.opacity}（不能只信 toBeVisible）`
    );
    assert.ok(value.height > 0, `${label}：${name} 高度为 0`);
  }
  assert.match(styles.title.text, /SSR 回归验证文章/);
  assert.match(styles.summary.text, /SSR 回归摘要/);
  assert.match(styles.body.text, new RegExp(BODY_MARKER));
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`OK ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.error(`FAIL ${name}: ${err.message}`);
  }
}

async function run() {
  const mock = startMock();
  let browser;
  try {
    await waitForOk(`${MOCK_ORIGIN}/health`);
    await waitForOk(BASE + "/", 20000);

    browser = await launchBrowser();

    await test("服务端 HTML 含正文与每篇文章 meta（不经过浏览器 JS）", async () => {
      const res = await fetch(BASE + ARTICLE_PATH);
      const html = await res.text();
      assert.equal(res.status, 200);
      const cacheControl = res.headers.get("cache-control") || "";
      assert.match(cacheControl, /private/);
      assert.match(cacheControl, /no-cache/);
      assert.ok(html.includes(ARTICLE.title), "服务端 HTML 缺少文章标题");
      assert.ok(html.includes(BODY_MARKER), "服务端 HTML 缺少正文标记");
      assert.ok(
        html.includes('class="article-content prose"'),
        "服务端 HTML 缺少正文容器"
      );
      assert.ok(html.includes("<table>"), "服务端 HTML 缺少 GFM 表格");
      assert.ok(html.includes("const ssr = true;"), "服务端 HTML 缺少围栏代码");
      assert.match(html, /<meta property="og:type" content="article"/);
      const setCookies = res.headers.getSetCookie?.() || [];
      assert.ok(
        setCookies.some((cookie) => cookie.startsWith("view_7=1")),
        "阅读量去重 Set-Cookie 未回传给浏览器"
      );
    });

    await test("JS 正常时岛屿挂载、首屏可见且控制台无报错", async () => {
      const { context, page, errors } = await openPage(browser);
      try {
        const response = await page.goto(BASE + ARTICLE_PATH, {
          waitUntil: "load",
        });
        assert.equal(response?.status(), 200);
        await waitForIslands(page, { expectArticle: true });
        // 正常路径由 IntersectionObserver 播放入场动画；等首屏元素动画结束再断言。
        await page.waitForFunction(
          () => {
            const selectors = [
              ".article-title",
              ".article-summary",
              ".article-content p",
            ];
            return selectors.every((selector) => {
              const el = document.querySelector(selector);
              return !!el && getComputedStyle(el).opacity === "1";
            });
          },
          undefined,
          { timeout: 8000 }
        );
        await assertFirstScreenVisible(page, "JS 正常");
        assert.deepEqual(errors, [], `控制台报错：\n${errors.join("\n")}`);
      } finally {
        await context.close();
      }
    });

    await test("禁用 JS：标题 / 摘要 / 正文 computed opacity 为 1", async () => {
      const { context, page, errors } = await openPage(browser, {
        context: { javaScriptEnabled: false },
      });
      try {
        const response = await page.goto(BASE + ARTICLE_PATH, {
          waitUntil: "load",
        });
        assert.equal(response?.status(), 200);
        await assertFirstScreenVisible(page, "禁用 JS");
        assert.ok(
          (await page.locator(".article-content").innerText()).includes(
            BODY_MARKER
          )
        );
        assert.deepEqual(errors, [], `控制台报错：\n${errors.join("\n")}`);
      } finally {
        await context.close();
      }
    });

    await test("阻断 motion chunk 后首屏仍可见", async () => {
      const { context, page, errors } = await openPage(browser, {
        blockMotion: true,
        ignored: [/motion[\w.-]*\.(?:m?js|ts)/, /ERR_FAILED/],
      });
      try {
        const response = await page.goto(BASE + ARTICLE_PATH, {
          waitUntil: "load",
        });
        assert.equal(response?.status(), 200);
        await page.waitForFunction(
          () => document.documentElement.hasAttribute("data-motion-failed"),
          undefined,
          { timeout: 6000 }
        );
        await waitForIslands(page, { expectArticle: true });
        await assertFirstScreenVisible(page, "阻断 motion chunk");
        assert.deepEqual(errors, [], `控制台报错：\n${errors.join("\n")}`);
      } finally {
        await context.close();
      }
    });

    await test("未知 slug 返回 404 并渲染未找到 UI", async () => {
      const { context, page, errors } = await openPage(browser, {
        // Chrome 会把导航文档自身的 404 记成 console error；这是被测状态本身，不是页面脚本报错。
        ignored: [new RegExp(escapeRegExp(BASE + MISSING_PATH))],
      });
      try {
        const response = await page.goto(BASE + MISSING_PATH, {
          waitUntil: "load",
        });
        assert.equal(response?.status(), 404);
        await page.waitForSelector("#article-detail.article-not-found");
        assert.match(
          await page.locator("#article-detail").innerText(),
          /文章未找到/
        );
        await waitForIslands(page);
        assert.deepEqual(errors, [], `控制台报错：\n${errors.join("\n")}`);
      } finally {
        await context.close();
      }
    });

    await test("上游失败返回 502 并渲染重试入口", async () => {
      const { context, page, errors } = await openPage(browser, {
        ignored: [new RegExp(escapeRegExp(BASE + ERROR_PATH))],
      });
      try {
        const response = await page.goto(BASE + ERROR_PATH, {
          waitUntil: "load",
        });
        assert.equal(response?.status(), 502);
        await page.waitForSelector("#article-detail.article-not-found");
        const text = await page.locator("#article-detail").innerText();
        assert.match(text, /服务暂时不可用/);
        assert.equal(
          await page.locator("#article-detail .back-link").getAttribute("href"),
          ERROR_PATH
        );
        await waitForIslands(page);
        assert.deepEqual(errors, [], `控制台报错：\n${errors.join("\n")}`);
      } finally {
        await context.close();
      }
    });
  } finally {
    await browser?.close().catch(() => {});
    mock.kill();
  }

  if (failures.length > 0) {
    console.error("\n================ 结果 ================");
    console.error(`FAIL：${failures.length} 处问题`);
    failures.forEach((failure, index) =>
      console.error(`  ${index + 1}. ${failure}`)
    );
    process.exit(1);
  }

  console.log("\n================ 结果 ================");
  console.log(
    "PASS：文章 SSR 服务端正文 / 无 JS / motion 失败兜底 / 404 / 502 全部通过"
  );
}

run().catch((err) => {
  console.error("脚本异常：", err);
  process.exit(2);
});
