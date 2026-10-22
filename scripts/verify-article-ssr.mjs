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
 * 脚本自己拉起 scripts/mock-article-api.mjs，不访问真实 Worker；启动后先确认
 * dev server 确实把 SSR 取数打到了本次 mock，否则立即失败并给出启动命令。
 * 覆盖：服务端 HTML 含正文 / 禁用 JS 可见（computed opacity）/ 阻断 motion
 * chunk 后首屏仍可见 / 404 / 502 / 控制台无报错。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  ARTICLE,
  ARTICLE_PATH,
  BODY_MARKER,
  DEFAULT_MOCK_PORT,
  ERROR_PATH,
  MISSING_PATH,
  MOCK_PATHS,
  browserApiFixture,
  isMotionChunkUrl,
} from "./article-ssr-fixture.mjs";

const BASE = (process.env.BASE || "http://localhost:4321").replace(/\/+$/, "");
const BASE_ORIGIN = new URL(BASE).origin;
const MOCK_PORT = Number(process.env.MOCK_PORT || DEFAULT_MOCK_PORT);
if (!Number.isInteger(MOCK_PORT) || MOCK_PORT <= 0 || MOCK_PORT > 65535) {
  throw new Error(`非法 MOCK_PORT：${process.env.MOCK_PORT}`);
}
const MOCK_ORIGIN = `http://127.0.0.1:${MOCK_PORT}`;
const MOCK_SCRIPT = fileURLToPath(
  new URL("./mock-article-api.mjs", import.meta.url)
);
// 页面 watchdog 是 3s；catch 路径应当在 DOMContentLoaded 后很快落标记。预算
// 必须明显小于 watchdog，否则「阻断 chunk」测试会被 3s 超时兜底误判为通过。
const MOTION_CATCH_BUDGET_MS = 1500;

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
  const stderr = [];
  let exit = null;
  child.stdout.on("data", (chunk) => process.stdout.write(`[mock] ${chunk}`));
  child.stderr.on("data", (chunk) => {
    stderr.push(chunk.toString());
    process.stderr.write(`[mock] ${chunk}`);
  });
  child.once("exit", (code, signal) => {
    exit = { code, signal };
  });
  return {
    child,
    stderr,
    get exit() {
      return exit;
    },
  };
}

/** mock 端口被占用时子进程会立即退出；不能让健康检查一直等到超时。 */
async function waitForMock(mock, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (mock.exit) break;
    try {
      const res = await fetch(`${MOCK_ORIGIN}${MOCK_PATHS.health}`);
      if (res.ok) {
        // 端口可能已被另一个（恰好也有 /health 的）进程占用：给子进程一个
        // 事件循环周期报告 EADDRINUSE，不能把别人的服务当成自己的 mock。
        await sleep(100);
        if (mock.exit) break;
        return;
      }
    } catch {
      /* 尚未 listen */
    }
    await sleep(100);
  }
  if (mock.exit) {
    const detail = mock.stderr.join("").trim();
    throw new Error(
      `mock 启动失败（端口 ${MOCK_PORT} 可能被占用）。` +
        (detail ? `\n${detail}` : "")
    );
  }
  throw new Error(`等待 mock ${MOCK_ORIGIN} 就绪超时`);
}

async function stopMock(mock) {
  if (mock.exit) return;
  mock.child.kill();
  await Promise.race([once(mock.child, "exit"), sleep(1000)]).catch(() => {});
}

async function readMockArticleRequests() {
  const res = await fetch(`${MOCK_ORIGIN}${MOCK_PATHS.stats}`);
  if (!res.ok) throw new Error(`mock stats 返回 HTTP ${res.status}`);
  const stats = await res.json();
  return Number(stats.articleRequests) || 0;
}

/**
 * 先确认 dev server 的 SSR 取数真的打到了本次 mock。否则后续断言只会看到
 * 真实 Worker 的 502 / 超时，报错信息会误导人。
 */
async function assertDevServerUsesMock() {
  if (BASE_ORIGIN === MOCK_ORIGIN) {
    throw new Error(
      `BASE 与 mock 指向同一地址 ${MOCK_ORIGIN}；请让 dev server 与 mock 使用不同端口。`
    );
  }
  const before = await readMockArticleRequests();
  const res = await fetch(BASE + ARTICLE_PATH);
  const html = await res.text();
  const after = await readMockArticleRequests();
  if (after === before) {
    throw new Error(
      `dev server（${BASE}）没有把文章 SSR 取数指向本次 mock（${MOCK_ORIGIN}）。` +
        `\n请用以下命令重启 dev server 后重试：` +
        `\n  $env:ARTICLE_API_ORIGIN='${MOCK_ORIGIN}'; npx astro dev --port 4321`
    );
  }
  if (res.status !== 200 || !html.includes(BODY_MARKER)) {
    throw new Error(
      `mock 已收到 SSR 取数，但文章页返回 HTTP ${res.status} 且正文标记缺失；` +
        `请检查 mock fixture 与页面渲染。`
    );
  }
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
  const isIgnored = (text, url) =>
    ignored.some((pattern) =>
      typeof pattern === "function"
        ? pattern({ text, url })
        : pattern.test(text) || pattern.test(url)
    );
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    const url = message.location()?.url || "";
    if (text.includes("favicon")) return;
    if (isIgnored(text, url)) return;
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
      (url) => isMotionChunkUrl(url.href),
      (route) => route.abort()
    );
  }
  return { context, page, errors };
}

/**
 * 等页脚 / 岛屿的异步请求落定，避免把尚未触发的报错当成“无报错”。
 * 超时直接让用例失败：静默跳过会把「岛屿没挂载」误判成通过。
 */
async function waitForIslands(page, { expectArticle = false } = {}) {
  await page.waitForSelector(
    ".footer-friend-links .no-links, .footer-friend-links .link-item",
    { timeout: 8000 }
  );
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
      // 容器自身的 opacity 也要看：子元素的 computed opacity 不会继承父级，
      // 只采样 <p> 会漏掉「正文容器仍为 opacity:0」的回归。
      bodyContainer: read(".article-content"),
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
    await waitForMock(mock);
    await waitForOk(BASE + "/", 20000);
    await assertDevServerUsesMock();

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
              ".article-content",
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

    await test("阻断 motion chunk 后走 catch 兜底且首屏仍可见", async () => {
      const { context, page, errors } = await openPage(browser, {
        blockMotion: true,
        // 只忽略被阻断的 motion chunk 自身的资源加载报错；不要用宽泛的
        // /ERR_FAILED/ 把其他失败请求一并吞掉。
        ignored: [
          ({ text, url }) => isMotionChunkUrl(url) && /ERR_FAILED/.test(text),
        ],
      });
      try {
        // DOMContentLoaded 在模块脚本执行后触发，从这里计时可以确保预算小于
        // 页面 3s watchdog：若 catch 失效，标记只会在约 3s 后出现。
        const response = await page.goto(BASE + ARTICLE_PATH, {
          waitUntil: "domcontentloaded",
        });
        assert.equal(response?.status(), 200);
        const started = Date.now();
        try {
          await page.waitForFunction(
            () => document.documentElement.hasAttribute("data-motion-failed"),
            undefined,
            { timeout: MOTION_CATCH_BUDGET_MS }
          );
        } catch {
          assert.fail(
            `阻断 motion chunk 后 ${MOTION_CATCH_BUDGET_MS}ms 内未出现 ` +
              `data-motion-failed：动态 import 的 catch 兜底可能失效` +
              `（3s 看门狗不在此预算内，避免误绿）`
          );
        }
        const catchDelay = Date.now() - started;
        assert.ok(
          catchDelay < MOTION_CATCH_BUDGET_MS,
          `data-motion-failed 在 ${catchDelay}ms 后才出现，疑似 3s 看门狗而非 catch 路径`
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
    await stopMock(mock);
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
