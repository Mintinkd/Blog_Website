/**
 * #66（编辑器 T5）图片上传 / 粘贴 / 拖拽与本地草稿恢复的手动 Playwright 回归。
 *
 * 用法（需先启动 dev server）：
 *   npx astro dev --port 4321
 *   node scripts/verify-article-editor.mjs
 *   # Windows 用系统 Edge：PW_CHANNEL=msedge node scripts/verify-article-editor.mjs
 *   # 自定义地址：BASE=http://localhost:4321 node scripts/verify-article-editor.mjs
 *
 * 只拦截 /api/v1/** 返回本地 fixture，不访问真实 Worker、不上传真实文件；
 * 覆盖：源码模式工具栏上传（Bearer + FormData）、WYSIWYG 粘贴 / 拖拽同一适配器、
 * 1.5s 草稿落盘、刷新后恢复 / 丢弃、保存成功清理草稿、控制台无报错。
 *
 * 粘贴 / 拖拽用浏览器内构造的 DataTransfer 事件驱动真实 ProseMirror 监听器；
 * 若浏览器升级后 synthetic event 不再触发，脚本会失败而不是静默跳过。
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:4321";
const CHANNEL = process.env.PW_CHANNEL;
const TOKEN = "regression-token";
const UPLOAD_URL = "/api/v1/media/serve/media/2026/11/mock.png";
const DRAFT_PREFIX = "blog:article-draft:v1:u1:";

const ok = (data) => ({ code: 0, message: "ok", data });
const emptyList = () =>
  ok({ items: [], total: 0, page: 1, page_size: 20, total_pages: 0 });

let uploadCalls = 0;
let savedPayload = null;

function fixtureFor(pathname) {
  if (pathname === "/api/v1/media/upload") {
    uploadCalls += 1;
    return {
      status: 200,
      body: {
        code: 0,
        message: "ok",
        data: {
          url: UPLOAD_URL,
          // 每次上传给不同 alt，便于断言粘贴 / 拖拽真的各走了一次适配器。
          original_name:
            uploadCalls === 1
              ? "photo.png"
              : uploadCalls === 2
                ? "paste.png"
                : "drop.png",
        },
      },
    };
  }
  if (
    pathname.endsWith("/edit-lock") ||
    pathname.endsWith("/edit-lock/force")
  ) {
    return { status: 200, body: ok(null) };
  }
  if (pathname.endsWith("/users")) return { status: 200, body: ok([]) };
  return { status: 200, body: emptyList() };
}

async function openAdmin(browser) {
  const context = await browser.newContext({ locale: "zh-CN" });
  await context.addInitScript(
    ({ token }) => {
      try {
        localStorage.setItem("locale", "zh");
        localStorage.setItem("admin_token", token);
        localStorage.setItem("admin_role", "admin");
        localStorage.setItem("admin_user_id", "1");
      } catch {
        // about:blank 等非 http 文档没有 localStorage，忽略。
      }
    },
    { token: TOKEN }
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("dialog", async (dialog) => {
    // 刷新时编辑器处于脏状态，beforeunload 会弹浏览器确认；接受以继续回归。
    if (dialog.type() === "beforeunload") {
      await dialog.accept();
      return;
    }
    errors.push(`dialog: ${dialog.message()}`);
    await dialog.dismiss();
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === "/api/v1/articles") {
      // App 用 JSON 发 POST（不是 FormData），留下请求体供最终断言。
      savedPayload = JSON.parse(request.postData() || "{}");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ok({ id: 123 })),
      });
      return;
    }
    if (url.pathname === "/api/v1/media/upload") {
      assert.equal(
        request.headers().authorization,
        `Bearer ${TOKEN}`,
        "上传请求必须带 Bearer token"
      );
      const body = request.postDataBuffer();
      assert.ok(body && body.length > 0, "上传请求必须带 multipart body");
      assert.ok(
        body.includes(Buffer.from("photo.png")) ||
          body.includes(Buffer.from("paste.png")) ||
          body.includes(Buffer.from("drop.png")),
        "FormData 必须包含 file 字段"
      );
    }
    const fixture = fixtureFor(url.pathname);
    await route.fulfill({
      status: fixture.status,
      contentType: "application/json",
      body: JSON.stringify(fixture.body),
    });
  });

  await page.goto(`${BASE}/admin`, { waitUntil: "load" });
  await page.waitForSelector(".admin-layout", { timeout: 15000 });
  return { context, page, errors };
}

async function openNewArticle(page) {
  await page.getByRole("button", { name: "新建文章" }).click();
  await page.waitForSelector(".article-editor-overlay", { timeout: 10000 });
}

async function switchToSource(page) {
  await page
    .locator(".preview-toggle")
    .getByRole("button", { name: "源码", exact: true })
    .click();
  await page.waitForSelector(".editor-textarea", { timeout: 10000 });
}

async function waitForDraft(page) {
  await page.waitForFunction(
    (prefix) => Object.keys(localStorage).some((key) => key.startsWith(prefix)),
    DRAFT_PREFIX,
    { timeout: 10000 }
  );
}

async function typeContent(page, content) {
  await switchToSource(page);
  const textarea = page.locator(".editor-textarea");
  await textarea.fill(content);
  // 光标放到末尾，模拟作者继续输入后按工具栏插入图片。
  await textarea.evaluate((element) => {
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  });
}

async function run() {
  const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
  const { context, page, errors } = await openAdmin(browser);
  try {
    /* 1. 源码模式工具栏上传：Bearer + FormData，插入 Markdown 并选中 alt。 */
    await openNewArticle(page);
    await typeContent(page, "正文开头\n\n");
    await page.locator(".editor-image-input").setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    await page.waitForFunction(
      () =>
        document.querySelector(".editor-textarea")?.value.includes("![photo]("),
      undefined,
      { timeout: 10000 }
    );
    assert.equal(uploadCalls, 1, "工具栏上传应只请求一次");
    const source = await page.locator(".editor-textarea").inputValue();
    assert.equal(source, `正文开头\n\n![photo](${UPLOAD_URL})`);
    const selection = await page.locator(".editor-textarea").evaluate((el) => ({
      start: el.selectionStart,
      end: el.selectionEnd,
      value: el.value,
    }));
    const altStart = selection.value.indexOf("![photo](") + 2;
    assert.equal(selection.start, altStart, "插入后光标应落在 alt 开头");
    assert.equal(selection.end, altStart + "photo".length, "应选中整段 alt");

    /* 2. WYSIWYG 粘贴 / 拖拽复用同一上传适配器。 */
    await page
      .locator(".preview-toggle")
      .getByRole("button", { name: "所见即所得", exact: true })
      .click();
    const prose = page.locator(".milkdown-host .ProseMirror");
    await prose.waitFor({ state: "visible", timeout: 15000 });
    // ProseMirror 会在图片旁插 .ProseMirror-separator <img>；只数真正带 src 的图片节点。
    await page.waitForFunction(
      () => document.querySelectorAll(".milkdown-host img[src]").length === 1,
      undefined,
      { timeout: 10000 }
    );

    await prose.click();
    await page.evaluate(() => {
      const target = document.querySelector(".milkdown-host .ProseMirror");
      const data = new DataTransfer();
      data.items.add(
        new File([new Uint8Array([1, 2, 3])], "paste.png", {
          type: "image/png",
        })
      );
      target.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        })
      );
    });
    await page.waitForFunction(
      () => document.querySelectorAll(".milkdown-host img[src]").length === 2,
      undefined,
      { timeout: 10000 }
    );

    await page.evaluate(() => {
      const target = document.querySelector(".milkdown-host .ProseMirror");
      const rect = target.getBoundingClientRect();
      // ProseMirror 的 drop 需要真实坐标解析落点；取编辑器可见区域内的点。
      const clientX = rect.left + 24;
      const clientY = rect.top + 24;
      const data = new DataTransfer();
      data.items.add(
        new File([new Uint8Array([4, 5, 6])], "drop.png", {
          type: "image/png",
        })
      );
      target.dispatchEvent(
        new DragEvent("dragover", {
          dataTransfer: data,
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
        })
      );
      target.dispatchEvent(
        new DragEvent("drop", {
          dataTransfer: data,
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
        })
      );
    });
    await page.waitForFunction(
      () => document.querySelectorAll(".milkdown-host img[src]").length === 3,
      undefined,
      { timeout: 10000 }
    );
    assert.equal(uploadCalls, 3, "粘贴 / 拖拽各应请求一次上传");

    /* 3. 刷新后恢复：草稿含粘贴 / 拖拽结果，服务端新文章基线仍为空。 */
    await waitForDraft(page);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".admin-layout", { timeout: 15000 });
    await openNewArticle(page);
    await page.waitForSelector(".editor-draft-bar", { timeout: 10000 });
    await page.getByRole("button", { name: "恢复草稿" }).click();
    await page.waitForSelector(".editor-draft-bar", { state: "detached" });
    await switchToSource(page);
    const restored = await page.locator(".editor-textarea").inputValue();
    assert.ok(restored.includes("![photo]("), "恢复后应保留工具栏上传的图片");
    assert.ok(restored.includes("![paste]("), "恢复后应保留粘贴的图片");
    assert.ok(restored.includes("![drop]("), "恢复后应保留拖拽的图片");

    /* 4. 丢弃：再次编辑等草稿落盘，刷新后丢弃不得改动服务端空正文。 */
    await typeContent(page, "准备丢弃的草稿");
    await waitForDraft(page);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector(".admin-layout", { timeout: 15000 });
    await openNewArticle(page);
    await page.waitForSelector(".editor-draft-bar", { timeout: 10000 });
    await page.getByRole("button", { name: "丢弃草稿" }).click();
    await page.waitForSelector(".editor-draft-bar", { state: "detached" });
    await switchToSource(page);
    assert.equal(
      await page.locator(".editor-textarea").inputValue(),
      "",
      "丢弃草稿后应保留服务端内容"
    );

    /* 5. 保存成功清理该文章的全部本地草稿（新建键为 a new）。 */
    await page.locator(".editor-meta-fields input").first().fill("T5 回归文章");
    await typeContent(page, "保存后的正文");
    await waitForDraft(page);
    await page.locator(".editor-footer .btn-primary").click();
    await page.waitForSelector(".article-editor-overlay", {
      state: "detached",
      timeout: 10000,
    });
    assert.ok(savedPayload, "保存应发送 POST /articles");
    assert.equal(savedPayload.title, "T5 回归文章");
    const draftKeys = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        key.startsWith("blog:article-draft:v1:u1:")
      )
    );
    assert.deepEqual(draftKeys, [], "保存成功后不得残留本地草稿");

    assert.deepEqual(errors, [], "控制台 / 页面不得有报错");
    console.log("verify-article-editor: PASS");
  } catch (error) {
    console.error("verify-article-editor: page errors:", errors);
    console.error("verify-article-editor: uploadCalls:", uploadCalls);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error("verify-article-editor: FAIL");
  console.error(error);
  process.exitCode = 1;
});
