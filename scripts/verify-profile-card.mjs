/**
 * 个人名片手动 Playwright 回归（后台配置 → 前台读取闭环）。
 *
 * 用法（需先启动 dev server）：
 *   npx astro dev --port 4321
 *   node scripts/verify-profile-card.mjs
 *   # Windows 用系统 Edge：PW_CHANNEL=msedge node scripts/verify-profile-card.mjs
 *   # 自定义地址：BASE=http://localhost:4321 node scripts/verify-profile-card.mjs
 *
 * 不访问真实 Worker：/api/v1/** 全部由本地 mock 应答，并用一个内存 config 状态
 * 串起「后台 PUT /config → 前台 GET /config」，验证保存后 /about 立即读到最新值。
 * 覆盖：未配置占位、字段编辑 / 头像上传 / 链接增删与空行过滤、XSS 转义、移动端无横向溢出。
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:4321";
const CHANNEL = process.env.PW_CHANNEL;
const AVATAR_URL = "/api/v1/media/serve/regression/avatar.png";
const EMPTY_LIST = [];
const EMPTY_PAGE = {
  items: EMPTY_LIST,
  total: 0,
  page: 1,
  page_size: 20,
  total_pages: 0,
};

function ok(data) {
  return JSON.stringify({ code: 0, message: "ok", data });
}

/** 每个 context 独立的 mock 服务端状态，PUT /config 会真的改写它 */
function createServer(initialProfileCard) {
  const config = {
    site_title: "测试博客",
    site_subtitle: "",
    site_description: "",
    site_keywords: "",
    posts_per_page: "10",
    about_content: "关于正文",
  };
  if (initialProfileCard !== undefined) {
    config.profile_card = initialProfileCard;
  }
  const putBodies = [];

  async function handle(route) {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (req.method() === "PUT" && path.endsWith("/config")) {
      const body = JSON.parse(req.postData() || "{}");
      putBodies.push(body);
      Object.assign(config, body);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: ok(null),
      });
    }
    if (path.endsWith("/media/upload")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: ok({ id: 1, url: AVATAR_URL }),
      });
    }
    if (path.includes("/media/serve/")) {
      return route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
      });
    }
    if (path.endsWith("/config") || path.endsWith("/config/all")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: ok(config),
      });
    }
    if (
      path.includes("friend-links") ||
      path.includes("/comments") ||
      path.endsWith("/categories") ||
      path.endsWith("/tags") ||
      path.endsWith("/users") ||
      path.endsWith("/media")
    ) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: ok(EMPTY_LIST),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: ok(EMPTY_PAGE),
    });
  }

  return { config, putBodies, handle };
}

async function newContext(browser, server, { admin = false, viewport } = {}) {
  const context = await browser.newContext({
    locale: "zh-CN",
    ...(viewport ? { viewport } : {}),
  });
  await context.addInitScript((isAdmin) => {
    try {
      localStorage.setItem("locale", "zh");
      if (isAdmin) {
        localStorage.setItem("admin_token", "regression-token");
        localStorage.setItem("admin_role", "admin");
        localStorage.setItem("admin_user_id", "1");
      }
    } catch {
      // about:blank 没有 localStorage，忽略
    }
  }, admin);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.route("**/api/v1/**", server.handle);
  return { context, page, errors };
}

async function waitForCard(page) {
  await page.locator(".profile-card").waitFor({ timeout: 15000 });
}

async function scenarioFlow(browser) {
  // 模拟老库：完全没有 profile_card 这一行
  const server = createServer(undefined);
  const { context, page, errors } = await newContext(browser, server, {
    admin: true,
  });
  try {
    // 1) 未配置：占位名片仍要出现
    await page.goto(`${BASE}/about`, { waitUntil: "load" });
    await waitForCard(page);
    assert.equal(
      await page.locator(".profile-card__avatar--fallback").count(),
      1,
      "未配置时应显示首字母占位头像"
    );
    assert.match(
      await page.locator(".profile-card__name").innerText(),
      /测试博客/,
      "空姓名应回退站点名"
    );
    assert.match(
      await page.locator(".profile-card__bio--placeholder").innerText(),
      /还没有填写名片/,
      "未配置时应显示引导文案"
    );
    assert.equal(
      await page.locator(".profile-card__link").count(),
      0,
      "未配置时不应出现社交按钮"
    );
    console.log("OK 未配置：占位名片 + 站点名回退 + 引导文案 + 无按钮");

    // 2) 后台「关于页面」面板：上传头像、编辑字段、增删链接
    await page.goto(`${BASE}/admin/`, { waitUntil: "load" });
    await page.locator(".admin-layout").waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "关于页面" }).click();
    await page.locator(".profile-editor").waitFor({ timeout: 15000 });
    assert.equal(
      await page.locator(".profile-link-row").count(),
      3,
      "首次进入应预置三条社交链接示例行"
    );

    await page.locator('.profile-upload-btn input[type="file"]').setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: Buffer.from([1, 2, 3, 4]),
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector(".profile-avatar-preview img")
          ?.getAttribute("src")
          ?.includes("/api/v1/media/serve/"),
      undefined,
      { timeout: 15000 }
    );

    await page.getByPlaceholder("例如：老大 / Laoda").fill("老大 / Laoda");
    await page
      .getByPlaceholder("例如：独立开发者 · Indie Maker")
      .fill("独立开发者 · Indie Maker");
    await page
      .getByPlaceholder("一句话介绍自己")
      .fill("记录代码、设计与生活的博客作者，欢迎来逛逛。");

    const rows = page.locator(".profile-link-row");
    await rows
      .nth(0)
      .locator(".profile-link-url")
      .fill("https://github.com/example");
    await rows
      .nth(1)
      .locator(".profile-link-url")
      .fill("mailto:hi@example.com");
    // 第三条留空：保存时应被过滤
    await page.getByRole("button", { name: "+ 添加链接" }).click();
    assert.equal(await page.locator(".profile-link-row").count(), 4);
    await page
      .locator(".profile-link-row")
      .nth(3)
      .getByRole("button", { name: "删除" })
      .click();
    assert.equal(await page.locator(".profile-link-row").count(), 3);

    await page.getByRole("button", { name: "保存名片" }).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector(".profile-editor-actions .msg")
          ?.textContent?.includes("保存成功"),
      undefined,
      { timeout: 15000 }
    );
    const body = server.putBodies.at(-1);
    assert.ok(
      body && typeof body.profile_card === "string",
      "应提交 profile_card 字符串"
    );
    const saved = JSON.parse(body.profile_card);
    assert.equal(saved.name, "老大 / Laoda");
    assert.equal(saved.role, "独立开发者 · Indie Maker");
    assert.equal(saved.avatar, AVATAR_URL);
    assert.equal(saved.links.length, 2, "空白社交链接行应被过滤");
    console.log(
      "OK 后台：头像上传预览、字段编辑、链接增删、空行过滤、保存成功"
    );

    // 3) 前台自动读取更新后的配置（同一个 mock 服务端状态）
    await page.goto(`${BASE}/about`, { waitUntil: "load" });
    await waitForCard(page);
    assert.equal(
      await page.locator(".profile-card__name").innerText(),
      "老大 / Laoda"
    );
    assert.equal(
      await page.locator(".profile-card__role").innerText(),
      "独立开发者 · Indie Maker"
    );
    assert.match(
      await page.locator(".profile-card__bio").innerText(),
      /欢迎来逛逛/
    );
    assert.ok(
      (
        await page.locator(".profile-card__avatar img").getAttribute("src")
      )?.includes(AVATAR_URL),
      "前台应展示后台上传的头像"
    );
    assert.equal(await page.locator(".profile-card__link").count(), 2);
    assert.equal(
      await page.getByRole("link", { name: "GitHub" }).getAttribute("href"),
      "https://github.com/example"
    );
    console.log(
      "OK 闭环：保存后 /about 立即读到最新姓名 / 职位 / 简介 / 头像 / 链接"
    );

    // 4) 移动端：无横向溢出
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload({ waitUntil: "load" });
    await waitForCard(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    assert.ok(overflow <= 1, `移动端不应横向溢出，实测超出 ${overflow}px`);
    const avatarBox = await page.locator(".profile-card__avatar").boundingBox();
    assert.ok(avatarBox && avatarBox.width <= 56, "移动端头像应收缩到 54px");
    console.log("OK 移动端 375px：无横向溢出、头像自适应收缩");

    assert.deepEqual(errors, [], `控制台不应报错：${errors.join(" | ")}`);
    console.log("OK 全链路控制台无报错");
  } finally {
    await context.close();
  }
}

async function scenarioXss(browser) {
  const malicious = {
    name: '<img src=x onerror="window.__profileXss=1">',
    role: "<script>window.__profileXss=2</script>",
    bio: '"><svg onload="window.__profileXss=3">',
    avatar: "",
    links: [
      { label: "<b>GitHub</b>", url: "javascript:window.__profileXss=4" },
      { label: "RSS", url: "/rss.xml" },
    ],
  };
  const server = createServer(JSON.stringify(malicious));
  const { context, page, errors } = await newContext(browser, server);
  try {
    await page.goto(`${BASE}/about`, { waitUntil: "load" });
    await waitForCard(page);
    assert.equal(
      await page.evaluate(() => window.__profileXss),
      undefined,
      "配置内容不得执行任何脚本"
    );
    assert.equal(
      await page.locator(".profile-card__name").innerText(),
      malicious.name,
      "姓名应按纯文本展示"
    );
    assert.equal(
      await page.locator(".profile-card__role").innerText(),
      malicious.role,
      "职位应按纯文本展示"
    );
    assert.equal(
      await page.locator(".profile-card__link").count(),
      1,
      "javascript: 链接必须被丢弃"
    );
    console.log("OK XSS：文本转义、伪协议链接丢弃、无脚本执行");
    assert.deepEqual(errors, [], `控制台不应报错：${errors.join(" | ")}`);
  } finally {
    await context.close();
  }
}

async function run() {
  const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
  try {
    await scenarioFlow(browser);
    await scenarioXss(browser);
    console.log("\nPASS：个人名片浏览器回归全部通过");
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
