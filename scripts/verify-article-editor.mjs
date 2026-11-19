/**
 * #68 / T7：文章编辑器端到端 Playwright 回归（spec §10.3 的 9 条）。
 *
 * 用法（需先启动 dev server，并把文章页 SSR 取数指向本地 mock）：
 *   $env:ARTICLE_API_ORIGIN='http://127.0.0.1:4322'; npx astro dev --port 4321
 *   node scripts/verify-article-editor.mjs
 *   # Windows 用系统 Edge：PW_CHANNEL=msedge node scripts/verify-article-editor.mjs
 *
 * 与 T5 骨架的关键差别：**有状态**。浏览器侧所有 /api/v1/** 用
 * `page.route().fetch()` 转发到 `mock-article-api.mjs`，SSR 侧由 dev-only
 * `ARTICLE_API_ORIGIN` 直连同一进程；编辑器的 `PUT /articles/:id` 与文章页
 * 的 `GET /articles/:slug` 因此共用一份内存文章数据，能给出「保存 → 前台
 * 语义等价」的真实端到端证据。只用 page.route fulfill 静态度据做不到这一点。
 *
 * 每个场景独立 browser context（docs/agents/testing.md 的 T7 约定）：
 * localStorage / 编辑锁 / 故障注入互不串味，失败能定位到具体检查单条目。
 *
 * 不访问真实 Worker、不上传真实文件。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MOCK_PORT,
  MOCK_PATHS,
  PLACEHOLDER_IMAGE_ROUTE,
  PLACEHOLDER_PNG,
} from "./article-ssr-fixture.mjs";
import {
  BASE_MARKER,
  EDITOR_ARTICLE_ID,
  EDITOR_ARTICLE_SLUG,
  FOOTER_MARKER,
  LOSSY_MARKDOWN,
  MOCK_UPLOAD_URL,
  SAFE_MARKDOWN,
} from "./mock-admin-api.mjs";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  if (error?.code === "ERR_MODULE_NOT_FOUND") {
    console.error(
      "缺少 Playwright。先运行 `npm install --no-save playwright`；Windows 也可用系统 Edge（$env:PW_CHANNEL='msedge'）。"
    );
    process.exit(2);
  }
  throw error;
}

const BASE = (process.env.BASE || "http://localhost:4321").replace(/\/+$/, "");
const MOCK_PORT = Number(process.env.MOCK_PORT || DEFAULT_MOCK_PORT);
if (!Number.isInteger(MOCK_PORT) || MOCK_PORT <= 0 || MOCK_PORT > 65535) {
  throw new Error(`非法 MOCK_PORT：${process.env.MOCK_PORT}`);
}
const MOCK_ORIGIN = `http://127.0.0.1:${MOCK_PORT}`;
const MOCK_SCRIPT = fileURLToPath(
  new URL("./mock-article-api.mjs", import.meta.url)
);
const CHANNEL = process.env.PW_CHANNEL;
const TOKEN = "regression-token";
const DRAFT_PREFIX = "blog:article-draft:v1:u1:";
const ARTICLE_PATH = `/articles/${EDITOR_ARTICLE_SLUG}`;

/** 控制台报错白名单：按 URL + 错误文本精确匹配，不做笼统忽略。 */
const IGNORABLE_ERRORS = [
  { url: /\/favicon\.ico$/, text: /Failed to load resource/i },
  { url: /@vite\/client/, text: /WebSocket|ws:/i },
];

/**
 * 故障注入场景里由 /__control **故意**制造的非 2xx。按 URL + 错误文本精确
 * 匹配、且只在该场景放行；其它任何 500 / 409 仍会让检查单第 9 条失败。
 */
const EXPECTED_LOAD_FAILURE = {
  url: /\/api\/v1\/articles\/\d+\/edit$/,
  text: /status of 500 \(Internal Server Error\)/,
};
const EXPECTED_SAVE_FAILURE = {
  url: /\/api\/v1\/articles\/\d+$/,
  text: /status of 500 \(Internal Server Error\)/,
};
const EXPECTED_LOCK_CONFLICT = {
  url: /\/api\/v1\/articles\/\d+\/edit-lock$/,
  text: /status of 409 \(Conflict\)/,
};

function isIgnorable(entry, allow = []) {
  return [...IGNORABLE_ERRORS, ...allow].some(
    (rule) => rule.url.test(entry.url) && rule.text.test(entry.text)
  );
}

const results = [];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    await sleep(150);
  }
  throw new Error(`mock 未能在 ${timeoutMs}ms 内就绪：${url}；${lastError}`);
}

async function startMock() {
  const child = spawn(
    process.execPath,
    [MOCK_SCRIPT, "--port", String(MOCK_PORT)],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  try {
    await waitForOk(`${MOCK_ORIGIN}/health`);
  } catch (error) {
    child.kill();
    throw new Error(`${error.message}\n${stderr}`);
  }
  return child;
}

async function control(patch) {
  const res = await fetch(`${MOCK_ORIGIN}${MOCK_PATHS.control}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  assert.equal(res.status, 200, "故障注入端点应返回 200");
}

async function resetMock() {
  const res = await fetch(`${MOCK_ORIGIN}${MOCK_PATHS.reset}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 200, "重置端点应返回 200");
}

async function stats() {
  const res = await fetch(`${MOCK_ORIGIN}${MOCK_PATHS.stats}`);
  assert.equal(res.status, 200);
  return res.json();
}

/** 直接改 mock 内存文章，用于布置 lossy / 保存前语料，不经编辑器。 */
async function setArticleContent(content) {
  const res = await fetch(
    `${MOCK_ORIGIN}/api/v1/articles/${EDITOR_ARTICLE_ID}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        title: "编辑器回归基线文章",
        slug: EDITOR_ARTICLE_SLUG,
        status: "published",
      }),
    }
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).code, 0);
}

/** 证明 dev server 的 SSR 取数确实打到了本次 mock，否则后续断言会自证。 */
async function assertDevServerUsesMock() {
  const before = (await stats()).articleRequests;
  const res = await fetch(BASE + ARTICLE_PATH);
  const html = await res.text();
  const after = (await stats()).articleRequests;
  assert.ok(
    after > before,
    `dev server（${BASE}）没有把文章 SSR 取数指向本次 mock（${MOCK_ORIGIN}）。` +
      `\n请重启 dev server：$env:ARTICLE_API_ORIGIN='${MOCK_ORIGIN}'; npx astro dev --port 4321`
  );
  assert.equal(res.status, 200, "文章页 SSR 应返回 200");
  assert.ok(html.includes(BASE_MARKER), "SSR 首屏应含 mock 文章正文标记");
}

/**
 * 每个场景一个独立 context：登录态、API 转发、报错收集、beforeunload 处理，
 * 场景结束后统一按 URL + 文本过滤并断言控制台干净（检查单第 9 条）。
 */
async function withScenario(name, browser, run, { allow = [] } = {}) {
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(
    ({ token }) => {
      try {
        localStorage.setItem("locale", "zh");
        localStorage.setItem("admin_token", token);
        localStorage.setItem("admin_role", "admin");
        localStorage.setItem("admin_user_id", "1");
      } catch {
        // about:blank 等非 http 文档没有 localStorage。
      }
    },
    { token: TOKEN }
  );
  const errors = [];
  const beforeUnload = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => {
    errors.push({ url: page.url(), text: `pageerror: ${error.message}` });
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    errors.push({
      url: message.location().url || page.url(),
      text: message.text(),
    });
  });
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "beforeunload") {
      beforeUnload.push(dialog.message());
      await dialog.accept();
      return;
    }
    errors.push({ url: page.url(), text: `dialog: ${dialog.message()}` });
    await dialog.dismiss();
  });

  await page.route(PLACEHOLDER_IMAGE_ROUTE, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: PLACEHOLDER_PNG,
    });
  });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: MOCK_ORIGIN + url.pathname + url.search,
      timeout: 15000,
    });
    await route.fulfill({ response });
  });

  try {
    await page.goto(`${BASE}/admin`, { waitUntil: "load" });
    await page.waitForSelector(".admin-layout", { timeout: 20000 });
    await run({ page, context, beforeUnload });
    const unexpected = errors.filter((entry) => !isIgnorable(entry, allow));
    assert.deepEqual(unexpected, [], `${name}: 控制台 / 页面不得有报错`);
    results.push(name);
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`verify-article-editor: 场景「${name}」控制台记录:`, errors);
    throw error;
  } finally {
    await context.close();
  }
}

async function openEditor(page, { fresh = false } = {}) {
  if (fresh) {
    await page.locator('[data-editor-entry="new-article"]').click();
  } else {
    await page
      .locator(".data-table tbody tr")
      .first()
      .getByRole("button", { name: /编辑/ })
      .click();
  }
  await page.waitForSelector(".article-editor-overlay", { timeout: 15000 });
}

async function waitForWysiwyg(page) {
  await page.waitForSelector(".milkdown-host .ProseMirror", {
    state: "visible",
    timeout: 25000,
  });
  await page.waitForFunction(
    () => !document.querySelector(".editor-textarea"),
    undefined,
    { timeout: 10000 }
  );
}

/**
 * 切到源码模式并确认它稳定。
 *
 * 打开编辑器时 `runInitialGuard()` 是异步的（Milkdown headless 往返），
 * 它完成后会重设 guard.mode，可能把刚切过去的源码模式覆盖回 WYSIWYG。
 * 因此这里循环点击 + 双次确认 textarea 持续存在，而不是一次 waitForSelector。
 */
async function switchToSource(page) {
  const button = page
    .locator(".preview-toggle")
    .getByRole("button", { name: "源码", exact: true });
  const textarea = page.locator(".editor-textarea");
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await button.count()) await button.click().catch(() => {});
    await page.waitForTimeout(350);
    if ((await textarea.count()) > 0 && (await textarea.isVisible())) {
      await page.waitForTimeout(350);
      if ((await textarea.count()) > 0 && (await textarea.isVisible())) {
        return textarea;
      }
    }
  }
  throw new Error("无法稳定切换到源码模式（回写守卫可能仍在异步重判）");
}

async function waitForDraft(page) {
  await page.waitForFunction(
    (prefix) => Object.keys(localStorage).some((key) => key.startsWith(prefix)),
    DRAFT_PREFIX,
    { timeout: 12000 }
  );
}

/**
 * 等待 WYSIWYG 的 onChange → update-form → 1.5s 草稿落盘链路完成。
 * 草稿里含 form.content，因此它是「表单已收到编辑结果」的行为证据，
 * 比固定 sleep 可靠，也不需要切到源码模式去打断编辑器。
 */
async function waitForFormContent(page, marker) {
  try {
    await page.waitForFunction(
      ({ prefix, expected }) => {
        for (const key of Object.keys(localStorage)) {
          if (!key.startsWith(prefix)) continue;
          const raw = localStorage.getItem(key);
          // Milkdown 会把 `_` 序列化成 `\_`，草稿又是 JSON（反斜杠再转义一次）。
          if (raw && raw.replace(/\\+/g, "").includes(expected)) return true;
        }
        return false;
      },
      { prefix: DRAFT_PREFIX, expected: marker },
      { timeout: 15000 }
    );
  } catch (error) {
    const drafts = await page.evaluate(
      (prefix) =>
        Object.fromEntries(
          Object.keys(localStorage)
            .filter((key) => key.startsWith(prefix))
            .map((key) => [
              key,
              (localStorage.getItem(key) || "").slice(0, 400),
            ])
        ),
      DRAFT_PREFIX
    );
    console.error("DEBUG 草稿未含期望标记，实际草稿：", JSON.stringify(drafts));
    throw error;
  }
}

/** 在源码模式里改正文，制造稳定的脏状态（不依赖 ProseMirror 输入时序）。 */
async function makeDirty(page, content) {
  const textarea = await switchToSource(page);
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await textarea.fill(content, { timeout: 10000 });
      break;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(300);
    }
  }
  // 用最终 DOM 值校验 fill 真的生效，避免 detached 重试被误判为成功。
  await page
    .waitForFunction(
      (expected) =>
        document.querySelector(".editor-textarea")?.value === expected,
      content,
      { timeout: 10000 }
    )
    .catch((error) => {
      throw lastError || error;
    });
}

async function insertLink(page, { url, text, mode }) {
  await page.locator(".editor-toolbar .toolbar-btn").first().click();
  const dialog = page.locator(".link-dialog");
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  await dialog.locator("input").nth(0).fill(url);
  await dialog.locator("input").nth(1).fill(text);
  // radio 被自定义 label 覆盖（视觉隐藏），点 label 才会真正触发 v-model。
  await dialog
    .locator(".link-mode-option")
    .nth(mode === "embed" ? 1 : 0)
    .click();
  assert.equal(
    await dialog.locator(`input.link-mode-input[value="${mode}"]`).isChecked(),
    true,
    `应选中 ${mode} 预览方式`
  );
  await dialog.locator(".btn-primary").click();
  await dialog.waitFor({ state: "detached", timeout: 10000 });
}

/* ------------------------------------------------------------------ *
 * 检查单 1：安全语料进 WYSIWYG；lossy 语料进源码模式并提示。
 * ------------------------------------------------------------------ */
async function scenarioGuardModes(browser) {
  await resetMock();
  await withScenario("1. 安全语料进入 WYSIWYG", browser, async ({ page }) => {
    await openEditor(page);
    await waitForWysiwyg(page);
    assert.equal(
      await page.locator(".editor-guard-bar").count(),
      0,
      "安全语料不应出现回写守卫提示"
    );
    const prose = await page.locator(".milkdown-host .ProseMirror").innerText();
    assert.ok(prose.includes(BASE_MARKER), "WYSIWYG 应保留引用段落标记");
    assert.ok(prose.includes("内嵌预览"), "WYSIWYG 应保留 data-embed 锚点文本");
  });

  await setArticleContent(LOSSY_MARKDOWN);
  await withScenario(
    "1. 有损语料进入源码模式并提示",
    browser,
    async ({ page }) => {
      await openEditor(page);
      await page.waitForSelector(".editor-textarea", {
        state: "visible",
        timeout: 25000,
      });
      assert.equal(
        await page.locator(".milkdown-host .ProseMirror").count(),
        0,
        "lossy 不应渲染 WYSIWYG 内核"
      );
      const message = await page.locator(".editor-guard-message").innerText();
      assert.ok(message.trim().length > 0, "应显示有损回写提示");
      assert.equal(
        await page.locator(".editor-textarea").inputValue(),
        LOSSY_MARKDOWN,
        "打开未编辑不得改写存量正文字节"
      );
      assert.equal(
        await page.locator(".editor-guard-bar .toolbar-btn").count(),
        1,
        "应提供显式覆盖入口"
      );
    }
  );
  await resetMock();
}

/* ------------------------------------------------------------------ *
 * 检查单 1b（#122）：Crepe common 布局样式确实进入产物。
 *
 * `classic.css` 只有颜色变量，布局在 `theme/common/style.css`。依赖包声明
 * `sideEffects: false`，直接从包内 import 会被 tree-shake；这里用 computed
 * style 证明布局真的生效，而不是只看某个 class 是否存在。
 * ------------------------------------------------------------------ */
async function scenarioLayoutStyles(browser) {
  await resetMock();
  await withScenario(
    "1b. Crepe 布局样式生效（toolbar / slash menu / list）",
    browser,
    async ({ page }) => {
      await openEditor(page, { fresh: true });
      await waitForWysiwyg(page);
      const prose = page.locator(".milkdown-host .ProseMirror");
      await prose.click();

      // toolbar：common 未加载时 position 为 static，图标会被挤进文档流。
      // 必须限定在可见 `.milkdown-host` 内：回写守卫另有一个隐藏的往返实例
      // （`[data-editor-roundtrip]`），它也会生成 toolbar / slash menu。
      await page.waitForSelector(".milkdown-host .milkdown-toolbar", {
        state: "attached",
        timeout: 10000,
      });
      const toolbarPosition = await page.evaluate(
        () =>
          getComputedStyle(
            document.querySelector(".milkdown-host .milkdown-toolbar")
          ).position
      );
      assert.equal(
        toolbarPosition,
        "absolute",
        "浮动工具栏必须绝对定位（theme/common/toolbar.css）"
      );

      // slash menu：默认 data-show=false → display:none；输入 / 后成为浮层。
      const slash = page.locator(".milkdown-host .milkdown-slash-menu");
      await slash.waitFor({ state: "attached", timeout: 10000 });
      assert.equal(
        await slash.getAttribute("data-show"),
        "false",
        "slash 菜单默认应隐藏"
      );
      assert.equal(
        await slash.evaluate((el) => getComputedStyle(el).display),
        "none",
        "未输入 / 时 slash 菜单不得占据文档流"
      );
      await page.keyboard.type("/");
      await page.waitForFunction(
        () =>
          document.querySelector(".milkdown-host .milkdown-slash-menu")?.dataset
            .show === "true",
        undefined,
        { timeout: 10000 }
      );
      const slashStyle = await slash.evaluate((el) => {
        const style = getComputedStyle(el);
        return { display: style.display, position: style.position };
      });
      assert.equal(slashStyle.display, "block", "slash 菜单显示时应为浮层");
      assert.equal(
        slashStyle.position,
        "absolute",
        "slash 菜单必须绝对定位（theme/common/block-edit.css）"
      );
      await page.keyboard.press("Backspace");
      await page.waitForFunction(
        () =>
          document.querySelector(".milkdown-host .milkdown-slash-menu")?.dataset
            .show === "false",
        undefined,
        { timeout: 10000 }
      );

      // list：common 未加载时 li 是普通 block、标签与正文没有 flex 间距。
      await page.keyboard.type("- 列表项");
      await page.waitForSelector(".milkdown-host .milkdown-list-item-block", {
        state: "visible",
        timeout: 10000,
      });
      const listStyle = await page.evaluate(() => {
        const block = document.querySelector(
          ".milkdown-host .milkdown-list-item-block"
        );
        const item = block?.querySelector(":scope > .list-item");
        const label = item?.querySelector(".label-wrapper");
        if (!block || !item || !label) return null;
        return {
          itemDisplay: getComputedStyle(item).display,
          itemGap: getComputedStyle(item).gap,
          labelHeight: getComputedStyle(label).height,
        };
      });
      assert.ok(listStyle, "列表项应渲染 Crepe 的 NodeView 结构");
      assert.equal(
        listStyle.itemDisplay,
        "flex",
        "列表项应 flex 排布标签与正文（theme/common/list-item.css）"
      );
      assert.equal(listStyle.itemGap, "10px", "列表项标签与正文间距应为 10px");
      assert.equal(listStyle.labelHeight, "32px", "列表标签槽高度应为 32px");
    }
  );
  await resetMock();
}

/* ------------------------------------------------------------------ *
 * 检查单 2 + 3：WYSIWYG 编辑 / 链接 / 上传 → 保存只含 Markdown →
 * 回读 SSR 页，正文 / 表格 / 代码 / 内嵌链接仍渲染。
 * ------------------------------------------------------------------ */
async function scenarioSaveAndSsr(browser) {
  await resetMock();
  await withScenario(
    "2/3. WYSIWYG 保存只含 Markdown 且 SSR 语义等价",
    browser,
    async ({ page }) => {
      await openEditor(page);
      await waitForWysiwyg(page);

      await insertLink(page, {
        url: "https://example.com/plain",
        text: "普通链接",
        mode: "link",
      });
      // #74：WYSIWYG 下「内嵌网页预览」必须写成带 data-embed 的专用节点，
      // 不能再降级成普通 Markdown 链接。新插入的这条以独特文本
      // 「内嵌网页预览」与存量语料的「内嵌预览」区分，请求体里精确断言其属性。
      await insertLink(page, {
        url: "https://example.com/embed",
        text: "内嵌网页预览",
        mode: "embed",
      });
      // #74 验收：插入后编辑器内是专用 embed 节点（data-editor-embed 由 NodeView 写入），
      // 不是普通链接；编辑态点击不导航由 embedLinkView 的 onClick preventDefault 保证。
      await page.waitForSelector(
        '.milkdown-host a[data-editor-embed="1"]:has-text("内嵌网页预览")',
        { timeout: 10000 }
      );

      await page.locator(".editor-image-input").setInputFiles({
        name: "photo.png",
        mimeType: "image/png",
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      });
      await page.waitForFunction(
        () => document.querySelectorAll(".milkdown-host img[src]").length >= 2,
        undefined,
        { timeout: 15000 }
      );

      // 键盘输入放最后：Milkdown 的 markdownUpdated 是异步批合并，后续再开
      // 弹窗 / 上传会用旧表单快照覆盖 onChange。输入完等待草稿落盘，用
      // 行为证据确认 form.content 已收到编辑结果，再保存。
      const prose = page.locator(".milkdown-host .ProseMirror");
      await prose.click();
      await page.keyboard.type(FOOTER_MARKER);
      await waitForFormContent(page, FOOTER_MARKER);
      await page.locator(".editor-footer .btn-primary").click();
      await page.waitForSelector(".article-editor-overlay", {
        state: "detached",
        timeout: 20000,
      });

      const snapshot = await stats();
      assert.equal(snapshot.putRequests, 1, "保存应恰好发送一次 PUT");
      assert.equal(snapshot.uploadRequests, 1, "图片应上传一次");
      const payload = snapshot.savedBodies.at(-1);
      assert.ok(payload, "应记录保存请求体");
      assert.equal(
        typeof payload.content,
        "string",
        "正文应为 Markdown 字符串"
      );
      assert.ok(!("content_html" in payload), "保存请求体不得含 content_html");
      // Milkdown 序列化会转义 `_` 等 Markdown 元字符；还原后再比对语义标记。
      const restored = payload.content.replace(/\\([_*[\]()#`])/g, "$1");
      assert.ok(
        restored.includes(FOOTER_MARKER),
        `应保留 WYSIWYG 输入，实际正文：${JSON.stringify(payload.content.slice(0, 800))}`
      );
      assert.ok(
        payload.content.includes('data-embed="1"'),
        "语料里的存量内嵌链接必须无损保留 data-embed 属性"
      );
      assert.match(
        payload.content,
        /<a\s+href="https:\/\/example\.com\/embed"[^>]*data-embed="1"[^>]*>内嵌网页预览<\/a>/,
        '#74：WYSIWYG 新插入的内嵌链接必须带 data-embed="1"，不得降级为普通链接'
      );
      assert.ok(
        payload.content.includes("![photo](" + MOCK_UPLOAD_URL),
        "上传图片应写成 Markdown 图片语法（允许内核附加 title）"
      );
      assert.ok(
        !/<div|<\/p>|<h1/.test(payload.content),
        "请求体不得夹带预览 HTML"
      );

      // 同一份内存数据：直接取 SSR HTML，不经过浏览器 JS。
      const res = await fetch(BASE + ARTICLE_PATH);
      assert.equal(res.status, 200);
      const html = await res.text();
      for (const marker of [FOOTER_MARKER, BASE_MARKER]) {
        assert.ok(html.includes(marker), `SSR 首屏应含 ${marker}`);
      }
      assert.ok(html.includes("<table"), "SSR 应渲染 GFM 表格");
      assert.ok(html.includes("<pre"), "SSR 应渲染围栏代码");
      assert.ok(html.includes('data-embed="1"'), "SSR 应保留内嵌链接属性");
      assert.ok(html.includes("photo"), "SSR 应渲染上传的图片 alt");
    }
  );
  await resetMock();
}

/* ------------------------------------------------------------------ *
 * 检查单 4：取消 / X / Esc / 刷新触发未保存保护；放弃后锁被释放。
 * ------------------------------------------------------------------ */
async function scenarioUnsavedProtection(browser) {
  await resetMock();
  await withScenario(
    "4. 未保存保护与放弃后释放编辑锁",
    browser,
    async ({ page, beforeUnload }) => {
      await openEditor(page);
      await makeDirty(page, `${SAFE_MARKDOWN}\n\n脏状态甲`);

      await page.locator(".editor-footer .btn-secondary").click();
      const dialog = page.locator(".unsaved-dialog");
      await dialog.waitFor({ state: "visible", timeout: 10000 });
      await dialog.locator(".btn-secondary").click();
      await dialog.waitFor({ state: "detached" });
      assert.equal(
        await page.locator(".article-editor-overlay").count(),
        1,
        "继续编辑应保持编辑器打开"
      );

      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "visible", timeout: 10000 });
      await dialog.locator(".btn-secondary").click();
      await dialog.waitFor({ state: "detached" });

      await page.locator(".editor-header .close-btn").click();
      await dialog.waitFor({ state: "visible", timeout: 10000 });
      const beforeDiscard = (await stats()).lockDeleteRequests;
      await dialog.locator(".btn-danger").click();
      await page.waitForSelector(".article-editor-overlay", {
        state: "detached",
        timeout: 10000,
      });
      const afterDiscard = await stats();
      assert.ok(
        afterDiscard.lockDeleteRequests > beforeDiscard,
        "放弃修改必须调用 DELETE /edit-lock"
      );
      assert.equal(afterDiscard.putRequests, 0, "放弃修改不得发送 PUT");

      // 刷新：脏状态下 beforeunload 必须被注册并弹浏览器确认。
      await openEditor(page);
      await makeDirty(page, `${SAFE_MARKDOWN}\n\n脏状态乙`);
      const beforeReload = beforeUnload.length;
      await page.reload({ waitUntil: "load" });
      await page.waitForSelector(".admin-layout", { timeout: 20000 });
      assert.ok(
        beforeUnload.length > beforeReload,
        "脏状态刷新必须触发 beforeunload 保护"
      );
    }
  );
  await resetMock();
}

/* ------------------------------------------------------------------ *
 * 检查单 5：加载失败不可编辑；保存失败保持编辑器与锁。
 * ------------------------------------------------------------------ */
async function scenarioFailureStates(browser) {
  await resetMock();
  await control({ failLoad: true });
  await withScenario(
    "5. 加载失败不可编辑",
    browser,
    async ({ page }) => {
      await openEditor(page);
      await page.waitForSelector(".editor-state-panel", {
        state: "visible",
        timeout: 15000,
      });
      assert.equal(
        await page.locator(".editor-textarea").count(),
        0,
        "加载失败不得渲染可编辑 textarea"
      );
      assert.equal(
        await page.locator(".milkdown-host .ProseMirror").count(),
        0,
        "加载失败不得渲染 WYSIWYG"
      );
      assert.equal(
        await page.locator(".editor-toolbar").count(),
        0,
        "加载失败不得渲染工具栏"
      );
    },
    { allow: [EXPECTED_LOAD_FAILURE] }
  );

  await control({ failLoad: false, failSave: true });
  await withScenario(
    "5. 保存失败保持编辑器与编辑锁",
    browser,
    async ({ page }) => {
      await openEditor(page);
      // failLoad 已关闭：这次应正常加载，直接进 WYSIWYG（无重试面板）。
      await waitForWysiwyg(page);
      await makeDirty(page, `${SAFE_MARKDOWN}\n\n保存会失败`);
      const before = await stats();
      await page.locator(".editor-footer .btn-primary").click();
      await page.waitForSelector(".editor-error", {
        state: "visible",
        timeout: 15000,
      });
      assert.equal(
        await page.locator(".article-editor-overlay").count(),
        1,
        "保存失败不得关闭编辑器"
      );
      const after = await stats();
      assert.equal(after.putRequests, before.putRequests + 1, "应发出保存请求");
      assert.equal(
        after.lockDeleteRequests,
        before.lockDeleteRequests,
        "保存失败不得释放编辑锁"
      );
      assert.equal(
        await page.locator(".editor-textarea").inputValue(),
        `${SAFE_MARKDOWN}\n\n保存会失败`,
        "保存失败必须保留作者正文"
      );
    },
    { allow: [EXPECTED_SAVE_FAILURE] }
  );
  await control({ failSave: false });
  await resetMock();
}

/* ------------------------------------------------------------------ *
 * 检查单 6：本地草稿恢复 / 丢弃两条路径。
 * ------------------------------------------------------------------ */
async function scenarioDraftRecovery(browser) {
  await resetMock();
  await withScenario("6. 本地草稿恢复与丢弃", browser, async ({ page }) => {
    const recovered = `${SAFE_MARKDOWN}\n\n草稿恢复标记`;
    await openEditor(page);
    await makeDirty(page, recovered);
    await waitForDraft(page);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".admin-layout", { timeout: 20000 });
    await openEditor(page);
    const bar = page.locator(".editor-draft-bar");
    await bar.waitFor({ state: "visible", timeout: 10000 });
    await bar.locator(".btn-primary").click();
    await bar.waitFor({ state: "detached" });
    await switchToSource(page);
    assert.equal(
      await page.locator(".editor-textarea").inputValue(),
      recovered,
      "恢复草稿应写回作者正文"
    );

    // 丢弃路径：草稿不改动服务端基线。
    await makeDirty(page, `${SAFE_MARKDOWN}\n\n会被丢弃的草稿`);
    await waitForDraft(page);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".admin-layout", { timeout: 20000 });
    await openEditor(page);
    await bar.waitFor({ state: "visible", timeout: 10000 });
    await bar.locator(".btn-secondary").click();
    await bar.waitFor({ state: "detached" });
    await switchToSource(page);
    assert.equal(
      await page.locator(".editor-textarea").inputValue(),
      SAFE_MARKDOWN,
      "丢弃草稿应保留服务端正文"
    );
    const snapshot = await stats();
    assert.equal(snapshot.putRequests, 0, "草稿恢复 / 丢弃都不得保存");
  });
  await resetMock();
}

/* ------------------------------------------------------------------ *
 * 检查单 7：锁冲突 / 校验失锁禁止保存，且有可操作出口。
 * ------------------------------------------------------------------ */
async function scenarioLockConflicts(browser) {
  await resetMock();
  await control({ lockConflict: true });
  await withScenario(
    "7. 打开时锁冲突与强制接管",
    browser,
    async ({ page }) => {
      await openEditor(page);
      const overlay = page.locator(".lock-conflict-overlay");
      await overlay.waitFor({ state: "visible", timeout: 15000 });
      assert.ok(
        (await overlay.innerText()).includes("另一位编辑"),
        "应展示持有人与可操作出口"
      );
      assert.equal(
        await page.locator(".editor-textarea").count(),
        0,
        "锁冲突时不得进入可编辑状态"
      );
      await overlay.locator(".btn-danger").click();
      await overlay.waitFor({ state: "detached", timeout: 15000 });
      await waitForWysiwyg(page);
      const snapshot = await stats();
      assert.ok(snapshot.lockForceRequests >= 1, "应调用强制接管端点");
    },
    { allow: [EXPECTED_LOCK_CONFLICT] }
  );

  await control({ lockConflict: false, verifyConflict: false });
  await withScenario(
    "7. 保存前校验失锁禁止保存",
    browser,
    async ({ page }) => {
      await openEditor(page);
      await waitForWysiwyg(page);
      // 一次性标志必须在 acquire 之后注入：下一次 POST /edit-lock 才是
      // save() 的保存前持有权校验，而不是打开时的取锁。
      await control({ verifyConflict: true });
      await makeDirty(page, `${SAFE_MARKDOWN}\n\n失锁前编辑`);
      const before = await stats();
      await page.locator(".editor-footer .btn-primary").click();
      await page.waitForSelector(".editor-lock-lost", {
        state: "visible",
        timeout: 15000,
      });
      const after = await stats();
      assert.equal(after.putRequests, before.putRequests, "失锁不得发送 PUT");
      assert.equal(
        await page.locator(".article-editor-overlay").count(),
        1,
        "失锁应保持编辑器打开供复制正文"
      );
      assert.ok(
        (await page.locator(".editor-lock-lost").innerText()).includes("复制"),
        "应提供复制正文 / 保留草稿等可操作出口"
      );
    },
    { allow: [EXPECTED_LOCK_CONFLICT] }
  );
  await control({ verifyConflict: false });
  await resetMock();
}

/* ------------------------------------------------------------------ *
 * 检查单 8：280 / 375 / 1280 响应式。
 * ------------------------------------------------------------------ */
async function scenarioResponsive(browser) {
  await resetMock();
  for (const [name, width, height] of [
    ["280px", 280, 720],
    ["375px", 375, 812],
  ]) {
    await withScenario(
      `8. ${name} 编辑器无横向滚动且工具栏可用`,
      browser,
      async ({ page }) => {
        await page.setViewportSize({ width, height });
        await openEditor(page);
        await waitForWysiwyg(page);
        const geometry = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth,
          pageClient: document.documentElement.clientWidth,
          overlay: document.querySelector(".article-editor-overlay")
            ?.scrollWidth,
          overlayClient: document.querySelector(".article-editor-overlay")
            ?.clientWidth,
          body: document.querySelector(".editor-body")?.scrollWidth,
          bodyClient: document.querySelector(".editor-body")?.clientWidth,
        }));
        assert.ok(
          geometry.page <= geometry.pageClient + 1,
          `${name}: 页面不得横向滚动 ${JSON.stringify(geometry)}`
        );
        assert.ok(
          geometry.overlay <= geometry.overlayClient + 1,
          `${name}: 编辑器全屏壳不得横向滚动`
        );
        assert.ok(
          geometry.body <= geometry.bodyClient + 1,
          `${name}: 编辑器主体不得横向滚动`
        );
        assert.equal(
          await page.locator(".editor-toolbar").isVisible(),
          true,
          `${name}: 工具栏应可见`
        );
        assert.equal(
          await page.locator(".meta-drawer-toggle").isVisible(),
          true,
          `${name}: 元信息抽屉入口应可见`
        );
        assert.equal(
          await page.locator(".preview-toggle").isVisible(),
          true,
          `${name}: 模式切换应可见`
        );
      }
    );
  }

  await withScenario("8. 1280px 分屏并排", browser, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openEditor(page);
    await waitForWysiwyg(page);
    await page
      .locator(".preview-toggle")
      .getByRole("button", { name: "分屏", exact: true })
      .click();
    await page.waitForSelector(".editor-content-area.split .editor-preview", {
      state: "visible",
      timeout: 15000,
    });
    const boxes = await page.evaluate(() => {
      const editor = document.querySelector(".milkdown-host");
      const preview = document.querySelector(".editor-preview");
      return {
        editor: editor?.getBoundingClientRect().toJSON(),
        preview: preview?.getBoundingClientRect().toJSON(),
      };
    });
    assert.ok(boxes.editor && boxes.preview, "分屏两侧都应渲染");
    assert.ok(
      boxes.preview.left >= boxes.editor.right - 2,
      `1280px 分屏应左右并排，实际 ${JSON.stringify(boxes)}`
    );
  });
  await resetMock();
}

async function run() {
  const mock = await startMock();
  let browser;
  try {
    await assertDevServerUsesMock();
    browser = await chromium.launch({
      headless: true,
      ...(CHANNEL ? { channel: CHANNEL } : {}),
    });

    await scenarioGuardModes(browser);
    await scenarioLayoutStyles(browser);
    await scenarioSaveAndSsr(browser);
    await scenarioUnsavedProtection(browser);
    await scenarioFailureStates(browser);
    await scenarioDraftRecovery(browser);
    await scenarioLockConflicts(browser);
    await scenarioResponsive(browser);

    const snapshot = await stats();
    assert.ok(
      snapshot.articles.some((a) => a.slug === EDITOR_ARTICLE_SLUG),
      "mock 状态应保持可查询"
    );
    console.log(
      `\nverify-article-editor: PASS（${results.length} 个场景，spec §10.3 的 9 条全部覆盖）`
    );
  } catch (error) {
    console.error("verify-article-editor: FAIL");
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    mock.kill();
  }
}

await run();
