/**
 * issue #67（编辑器 T6）元信息面板、响应式与可访问性 · 手动 Playwright 回归。
 *
 * 用法（需先启动 dev server）：
 *   npx astro dev --port 4321
 *   node scripts/verify-editor-responsive.mjs
 *   # Windows 用系统 Edge：PW_CHANNEL=msedge node scripts/verify-editor-responsive.mjs
 *   # 自定义地址：BASE=http://localhost:4321 node ...
 *
 * 只拦截 /api/v1/** 与封面图片请求，不访问真实 Worker / 不上传真实文件。
 * 与 verify-visual-friendliness.mjs 分工：那边量 computed style 与几何观感，
 * 这里锁交互契约（抽屉、焦点、URL 白名单、发布前校验、无横向滚动）。
 * CI 门禁接线归 T7 #68，本脚本按 docs/agents/testing.md 保持手动运行。
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
// docs/agents/testing.md：入口选择器 / 视口 / API fixture 与观感脚本共用一份。
import {
  EDITOR_ENTRY_SELECTOR,
  EDITOR_VIEWPORTS as VIEWPORTS,
  fixtureFor,
  ok,
} from "./editor-meta-fixture.mjs";

const BASE = process.env.BASE || "http://localhost:4321";
const CHANNEL = process.env.PW_CHANNEL;

const LOCALES = ["zh", "en"];
const TOKEN = "regression-token";

async function openEditor(browser, viewport, locale, options = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    locale: locale === "zh" ? "zh-CN" : "en-US",
    colorScheme: "light",
    hasTouch: viewport.width < 768,
    reducedMotion: "reduce",
  });
  await context.addInitScript(
    ({ token, activeLocale }) => {
      try {
        localStorage.setItem("locale", activeLocale);
        localStorage.setItem("theme", "light");
        localStorage.setItem("admin_token", token);
        localStorage.setItem("admin_role", "admin");
        localStorage.setItem("admin_user_id", "1");
      } catch {
        // about:blank 等非 http 文档没有 localStorage
      }
    },
    { token: TOKEN, activeLocale: locale }
  );

  const state = { postCount: 0, savedPayload: null };
  await context.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/api/v1/articles") {
      state.postCount += 1;
      state.savedPayload = JSON.parse(request.postData() || "{}");
      await route.fulfill({
        status: options.postStatus ?? 200,
        contentType: "application/json",
        body: JSON.stringify(options.postResponse ?? ok({ id: 123 })),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixtureFor(url.pathname)),
    });
  });

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "beforeunload") {
      await dialog.accept();
      return;
    }
    errors.push(`dialog: ${dialog.message()}`);
    await dialog.dismiss();
  });

  await page.goto(`${BASE}/admin`, { waitUntil: "load" });
  await page.waitForSelector(".admin-layout", { timeout: 15000 });
  // EDITOR_ENTRY_SELECTOR 与文案无关，中英文 locale 下都能稳定定位。
  await page.locator(EDITOR_ENTRY_SELECTOR).click();
  await page.waitForSelector(".article-editor-overlay", { timeout: 10000 });

  if (viewport.width <= 767) {
    // 窄屏元信息默认折叠，展开后才能量测面板内部控件。
    assert.equal(
      await page.locator(".editor-meta-panel").isVisible(),
      false,
      `${viewport.name}: 元信息面板在窄屏应默认折叠`
    );
    await page.locator(".meta-drawer-toggle").click();
    await page.waitForSelector(".editor-meta-panel.open", { timeout: 5000 });
    assert.equal(
      await page.locator(".meta-drawer-toggle").getAttribute("aria-expanded"),
      "true"
    );
  } else {
    assert.equal(
      await page.locator(".editor-meta-panel").isVisible(),
      true,
      `${viewport.name}: 元信息面板在宽屏应常显`
    );
  }

  await page.waitForSelector("#meta-title", { timeout: 10000 });
  return { context, page, errors, state };
}

/** VF-11 等价断言：页面 / 全屏壳 / 正文区 / 元信息面板均无横向溢出。 */
async function checkNoHorizontalScroll(page, label) {
  const boxes = await page.evaluate(() => {
    const pick = (name, el) =>
      el
        ? {
            name,
            sw: el.scrollWidth,
            cw: el.clientWidth,
          }
        : null;
    return [
      pick("html", document.documentElement),
      pick(
        ".article-editor-overlay",
        document.querySelector(".article-editor-overlay")
      ),
      pick(".editor-body", document.querySelector(".editor-body")),
      pick(".editor-meta-panel", document.querySelector(".editor-meta-panel")),
    ].filter(Boolean);
  });
  for (const box of boxes) {
    assert.ok(
      box.sw <= box.cw + 1,
      `${label}: ${box.name} 横向溢出 scrollWidth=${box.sw} clientWidth=${box.cw}`
    );
  }

  // 票面「工具栏横向滚动或换行，不挤压正文」：编辑器沿用 flex-wrap: wrap，
  // 且工具栏自身不得产生横向溢出。
  const toolbar = await page.evaluate(() => {
    const el = document.querySelector(".editor-toolbar");
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      wrap: style.flexWrap,
      sw: el.scrollWidth,
      cw: el.clientWidth,
    };
  });
  assert.ok(toolbar, `${label}: .editor-toolbar 应存在`);
  assert.ok(
    ["wrap", "wrap-reverse"].includes(toolbar.wrap) ||
      toolbar.sw <= toolbar.cw + 1,
    `${label}: 工具栏既不换行又横向溢出（flex-wrap=${toolbar.wrap}, ${toolbar.sw}/${toolbar.cw}）`
  );
}

/** 中英文下最长标签 / 按钮文案不裁切。 */
async function checkNoTruncation(page, label) {
  const clipped = await page.evaluate(() => {
    const selectors =
      ".editor-meta-panel .form-group label, .editor-meta-panel button, " +
      ".meta-drawer-toggle, .article-editor-overlay .editor-footer button, " +
      ".article-editor-overlay .editor-header button";
    return [...document.querySelectorAll(selectors)]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => ({
        text: (el.textContent || "").trim(),
        sw: el.scrollWidth,
        cw: el.clientWidth,
      }));
  });
  assert.deepEqual(
    clipped,
    [],
    `${label}: 文案被裁切 ${JSON.stringify(clipped)}`
  );
}

/** 焦点陷阱：Tab 不跑出弹窗，关闭后焦点归还触发按钮。 */
async function checkFocusTrap(page, label) {
  const trigger = page.locator(".editor-toolbar .toolbar-btn").first();
  await trigger.click();
  await page.waitForSelector(".link-dialog", { timeout: 10000 });

  const dialog = page.locator(".link-dialog");
  assert.equal(await dialog.getAttribute("role"), "dialog", `${label}: role`);
  assert.equal(
    await dialog.getAttribute("aria-modal"),
    "true",
    `${label}: aria-modal`
  );

  const inside = () =>
    page.evaluate(() => {
      const el = document.querySelector(".link-dialog");
      return Boolean(
        el && document.activeElement && el.contains(document.activeElement)
      );
    });
  await page.waitForFunction(
    () => {
      const el = document.querySelector(".link-dialog");
      return Boolean(
        el && document.activeElement && el.contains(document.activeElement)
      );
    },
    undefined,
    { timeout: 5000 }
  );
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    assert.equal(await inside(), true, `${label}: 第 ${i + 1} 次 Tab 逃出弹窗`);
  }
  await page.keyboard.press("Shift+Tab");
  assert.equal(await inside(), true, `${label}: Shift+Tab 逃出弹窗`);

  await page.locator(".link-dialog .btn-secondary").click();
  await page.waitForSelector(".link-dialog", { state: "detached" });
  await page.waitForFunction(
    () =>
      document.activeElement ===
      document.querySelector(".editor-toolbar .toolbar-btn"),
    undefined,
    { timeout: 5000 }
  );
}

/** 封面：只加载 http(s)，失败与非法协议都有占位，成功可正常解码。 */
async function checkCoverPreview(page, label) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>';
  // 两张图都返回有效 SVG，避免真实 404 污染控制台断言；「加载失败」用
  // 合成 error 事件触发 Vue 的 @error 分支（与 T5 用合成 DataTransfer 同理）。
  await page.route("**/cover-fail.svg", (route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg })
  );
  await page.route("**/cover-ok.svg", (route) =>
    route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg })
  );

  for (const invalid of [
    "javascript:alert(1)",
    "/relative/cover.png",
    "data:image/png;base64,AAAA",
  ]) {
    await page.locator("#meta-cover").fill(invalid);
    // aria-live 区域直接暴露 coverState，能区分「空值」与「非法 URL」两种占位。
    await page.waitForFunction(
      () =>
        document.querySelector("#meta-cover-state")?.textContent?.trim() ===
        "invalid",
      undefined,
      { timeout: 5000 }
    );
    assert.equal(
      await page.locator(".meta-cover-preview img").count(),
      0,
      `${label}: 非法封面 ${invalid} 不得渲染 img`
    );
    assert.equal(
      await page.locator(".meta-cover-placeholder").isVisible(),
      true,
      `${label}: 非法封面 ${invalid} 应显示占位`
    );
  }

  await page.locator("#meta-cover").fill("https://example.test/cover-fail.svg");
  await page.waitForSelector(".meta-cover-preview img", { timeout: 8000 });
  await page.locator(".meta-cover-preview img").dispatchEvent("error");
  await page.waitForFunction(
    () =>
      document.querySelector("#meta-cover-state")?.textContent?.trim() ===
      "failed",
    undefined,
    { timeout: 8000 }
  );
  assert.equal(
    await page.locator(".meta-cover-placeholder").isVisible(),
    true,
    `${label}: 加载失败应显示占位`
  );

  await page.locator("#meta-cover").fill("https://example.test/cover-ok.svg");
  await page.waitForFunction(
    () => {
      const img = document.querySelector(".meta-cover-preview img");
      return Boolean(img && img.complete && img.naturalWidth > 0);
    },
    undefined,
    { timeout: 8000 }
  );
  assert.equal(
    await page.locator(".meta-cover-placeholder").count(),
    0,
    `${label}: 加载成功不应再有占位`
  );
}

/** 发布前校验：已发布且标题 / 正文为空时拦截保存，不发 POST。 */
async function checkPublishGate(page, label, state) {
  await page.locator("#meta-status").selectOption("published");
  const saveButton = page.locator(".editor-footer .btn-primary");
  assert.equal(
    await saveButton.isDisabled(),
    false,
    `${label}: 保存按钮应可用（证明拦截来自发布校验而非 canSave）`
  );
  const before = (
    await page.locator(".meta-publish-error").textContent()
  )?.trim();
  await saveButton.click();
  const after = (
    await page.locator(".meta-publish-error").textContent()
  )?.trim();
  assert.notEqual(after, before, `${label}: 应给出具体的缺失字段提示`);
  assert.equal(state.postCount, 0, `${label}: 发布校验失败不得发 POST`);

  await page.locator("#meta-title").fill("标题");
  await saveButton.click();
  assert.equal(state.postCount, 0, `${label}: 正文为空仍不得发 POST`);
}

/** slug 生成后锁定、可解锁手改；摘要计数与字数 / 阅读时长有读数。 */
async function checkMetaFields(page, label) {
  await page.locator("#meta-title").fill("中文 标题");
  await page.locator(".meta-slug-generate").click();
  assert.equal(
    await page.locator("#meta-slug").inputValue(),
    "中文-标题",
    `${label}: slug 生成`
  );
  assert.equal(
    await page.locator("#meta-slug").isDisabled(),
    true,
    `${label}: 生成后应锁定`
  );
  await page.locator(".meta-lock-btn").click();
  assert.equal(
    await page.locator("#meta-slug").isDisabled(),
    false,
    `${label}: 解锁后可手改`
  );

  await page.locator("#meta-summary").fill("摘要");
  assert.match(
    await page.locator("#meta-summary-count").textContent(),
    /\b2\b/,
    `${label}: 摘要字数计数（「摘要」按码点为 2）`
  );
  assert.match(
    await page.locator("#meta-title-count").textContent(),
    /5\/200/,
    `${label}: 标题计数与 200 上限（「中文 标题」按码点为 5）`
  );
  assert.match(
    await page.locator(".meta-stats").textContent(),
    /约\s*1\s*分钟|about\s*1\s*min/,
    `${label}: 空正文的阅读时长读数（最少 1 分钟）`
  );
}

const CONFLICT_MESSAGE = "Slug 已被占用：my-slug";

/** 服务端 slug 冲突：原样展示 message，不改写 / 不追加后缀。 */
async function checkSlugConflict(page, label) {
  await page.locator("#meta-slug").fill("my-slug");
  await page.locator(".editor-footer .btn-primary").click();
  await page.waitForSelector(".editor-error", { timeout: 8000 });
  const shown = (await page.locator(".editor-error").textContent())?.trim();
  assert.equal(shown, CONFLICT_MESSAGE, `${label}: 服务端冲突提示应原样展示`);
  assert.equal(
    await page.locator("#meta-slug").inputValue(),
    "my-slug",
    `${label}: slug 不得被静默改写或追加后缀`
  );
}

async function run() {
  const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
  let checks = 0;
  try {
    for (const viewport of VIEWPORTS) {
      for (const locale of LOCALES) {
        const label = `${viewport.name} / ${locale}`;
        const { context, page, errors } = await openEditor(
          browser,
          viewport,
          locale
        );
        try {
          await checkNoHorizontalScroll(page, label);
          await checkNoTruncation(page, label);
          checks += 2;
          assert.deepEqual(
            errors,
            [],
            `${label}: 控制台报错 ${errors.join(" | ")}`
          );
          checks += 1;
          console.log(`  ✓ ${label} — 无横向滚动 / 文案不裁切 / 控制台无报错`);
        } finally {
          await context.close();
        }
      }
    }

    // 交互契约只在 1280 / zh 跑一遍，避免与上面的矩阵重复。
    const { context, page, errors, state } = await openEditor(
      browser,
      VIEWPORTS[2],
      "zh"
    );
    try {
      await checkFocusTrap(page, "焦点陷阱");
      checks += 1;
      console.log("  ✓ 焦点陷阱与关闭后焦点归还");
      await checkCoverPreview(page, "封面");
      checks += 1;
      console.log("  ✓ 封面仅 http(s) / 失败占位 / 成功预览");
      await checkMetaFields(page, "元信息");
      checks += 1;
      console.log("  ✓ slug 生成与锁定 / 摘要与标题计数 / 字数读数");
      await checkPublishGate(page, "发布前校验", state);
      checks += 1;
      console.log("  ✓ 发布前校验拦截保存且不发 POST");
      assert.deepEqual(errors, [], `交互场景控制台报错：${errors.join(" | ")}`);
      checks += 1;
    } finally {
      await context.close();
    }

    // slug 冲突单独一个 context：POST 返回业务错误，验证原样展示与不改写。
    const conflict = await openEditor(browser, VIEWPORTS[2], "zh", {
      postResponse: { code: 10005, message: CONFLICT_MESSAGE, data: null },
    });
    try {
      await checkSlugConflict(conflict.page, "slug 冲突");
      checks += 1;
      console.log("  ✓ slug 冲突提示原样展示且不改写 slug");
      assert.deepEqual(
        conflict.errors,
        [],
        `slug 冲突场景控制台报错：${conflict.errors.join(" | ")}`
      );
    } finally {
      await conflict.context.close();
    }

    console.log(`\nPASS：${checks} 组断言全部通过。`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error("编辑器响应式回归失败：", error);
  process.exitCode = 1;
});
