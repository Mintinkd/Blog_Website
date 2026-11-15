// @vitest-environment node

import assert from "node:assert/strict";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createAdminApiState,
  EDITOR_ARTICLE_ID,
  EDITOR_ARTICLE_SLUG,
  FOOTER_MARKER,
} from "../scripts/mock-admin-api.mjs";
import type {
  AdminApiResponse,
  AdminApiState,
} from "../scripts/mock-admin-api.mjs";

/**
 * #68 / T7：有状态 admin mock 的行为基线。
 *
 * 这里只钉「服务端状态机」这一条 seam：编辑器的 PUT 与文章页 SSR 的 GET
 * 必须读到同一份内存数据，否则端到端回归会用两份互不相干的 fixture 自证。
 * 期望值全部是手写字面量，不从被测实现反推；HTTP 适配与浏览器交互由
 * scripts/verify-article-editor.mjs 覆盖，不在本文件重复。
 */

const SAVED_MARKDOWN = [
  "# 保存后的标题",
  "",
  "| 列 A | 列 B |",
  "| --- | --- |",
  "| 值 1 | 值 2 |",
  "",
  "```js",
  "const saved = true;",
  "```",
  "",
  '<a href="https://example.com/embed" data-embed="1">内嵌预览</a>',
  "",
  FOOTER_MARKER,
].join("\n");

/** 测试里的调用都指向 admin 端点；null 表示分派漏了，直接让用例失败。 */
const call = (
  state: AdminApiState,
  method: string,
  path: string,
  body?: Record<string, unknown>
): AdminApiResponse => {
  const result = state.handle(method, path, body);
  assert.ok(result, `admin 层应处理 ${method} ${path}`);
  return result;
};

describe("有状态 admin mock", () => {
  let state!: AdminApiState;

  beforeEach(() => {
    state = createAdminApiState();
  });

  it("列表返回种子文章，编辑详情不含 content_html", () => {
    const list = call(state, "GET", "/api/v1/articles?page=1", undefined);
    expect(list.status).toBe(200);
    expect(list.body.code).toBe(0);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0].slug).toBe(EDITOR_ARTICLE_SLUG);

    const detail = call(
      state,
      "GET",
      `/api/v1/articles/${EDITOR_ARTICLE_ID}/edit`,
      undefined
    );
    expect(detail.status).toBe(200);
    expect(detail.body.code).toBe(0);
    expect(detail.body.data.content).toContain("EDITOR_BASE_MARKER_68");
    expect(detail.body.data).not.toHaveProperty("content_html");
    expect(Object.keys(detail.body.data).sort()).toEqual(
      [
        "author_id",
        "category",
        "category_id",
        "content",
        "cover_image",
        "created_at",
        "id",
        "slug",
        "status",
        "summary",
        "tags",
        "title",
        "updated_at",
      ].sort()
    );
  });

  it("PUT 写入的 Markdown 会被公开文章 GET 原样读到（同一份内存数据）", () => {
    const put = call(state, "PUT", `/api/v1/articles/${EDITOR_ARTICLE_ID}`, {
      title: "保存后的标题",
      slug: EDITOR_ARTICLE_SLUG,
      content: SAVED_MARKDOWN,
      summary: "摘要",
      cover_image: "",
      category_id: null,
      tags: [],
      status: "published",
    });
    expect(put.status).toBe(200);
    expect(put.body.code).toBe(0);

    const published = call(
      state,
      "GET",
      `/api/v1/articles/${EDITOR_ARTICLE_SLUG}`,
      undefined
    );
    expect(published.status).toBe(200);
    expect(published.body.data.content).toBe(SAVED_MARKDOWN);
    expect(published.body.data.content).toContain('data-embed="1"');
    expect(published.body.data.status).toBe("published");

    const detail = call(
      state,
      "GET",
      `/api/v1/articles/${EDITOR_ARTICLE_ID}/edit`,
      undefined
    );
    expect(detail.body.data.content).toBe(SAVED_MARKDOWN);
  });

  it("保存请求体被记账，且不含 content_html 时不补写", () => {
    call(state, "PUT", `/api/v1/articles/${EDITOR_ARTICLE_ID}`, {
      content: SAVED_MARKDOWN,
    });
    expect(state.stats().putRequests).toBe(1);
    expect(state.stats().savedBodies).toHaveLength(1);
    expect(state.stats().savedBodies[0]).not.toHaveProperty("content_html");
  });

  it("POST 新建后列表可见，且草稿不出现在公开读取里", () => {
    const created = call(state, "POST", "/api/v1/articles", {
      title: "新草稿",
      content: "草稿正文",
      status: "draft",
      slug: "new-draft-68",
    });
    expect(created.body.code).toBe(0);
    expect(created.body.data.id).toBe(8);

    const list = call(state, "GET", "/api/v1/articles", undefined);
    expect(list.body.data.items).toHaveLength(2);

    const hidden = call(
      state,
      "GET",
      "/api/v1/articles/new-draft-68",
      undefined
    );
    expect(hidden.status).toBe(404);
  });

  it("锁冲突返回 10006，强制接管后重新获取成功", () => {
    state.control({ lockConflict: true });
    const conflict = call(
      state,
      "POST",
      `/api/v1/articles/${EDITOR_ARTICLE_ID}/edit-lock`,
      undefined
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe(10006);
    expect(conflict.body.data.holder_name).toBe("另一位编辑");

    call(
      state,
      "POST",
      `/api/v1/articles/${EDITOR_ARTICLE_ID}/edit-lock/force`,
      undefined
    );
    const acquired = call(
      state,
      "POST",
      `/api/v1/articles/${EDITOR_ARTICLE_ID}/edit-lock`,
      undefined
    );
    expect(acquired.body.code).toBe(0);
  });

  it("保存前校验失锁只影响下一次取锁请求", () => {
    state.control({ verifyConflict: true });
    const first = call(
      state,
      "POST",
      `/api/v1/articles/${EDITOR_ARTICLE_ID}/edit-lock`,
      undefined
    );
    expect(first.body.code).toBe(10006);
    const second = call(
      state,
      "POST",
      `/api/v1/articles/${EDITOR_ARTICLE_ID}/edit-lock`,
      undefined
    );
    expect(second.body.code).toBe(0);
  });

  it("加载失败不改状态；保存失败不改内存正文", () => {
    state.control({ failLoad: true });
    const load = call(
      state,
      "GET",
      `/api/v1/articles/${EDITOR_ARTICLE_ID}/edit`,
      undefined
    );
    expect(load.body.code).toBe(10008);

    state.control({ failLoad: false, failSave: true });
    const save = call(state, "PUT", `/api/v1/articles/${EDITOR_ARTICLE_ID}`, {
      content: "不该落库的正文",
    });
    expect(save.body.code).toBe(10008);
    const published = call(
      state,
      "GET",
      `/api/v1/articles/${EDITOR_ARTICLE_SLUG}`,
      undefined
    );
    expect(published.body.data.content).not.toContain("不该落库的正文");
  });

  it("不吞掉 #41 的 SSR 三态 slug，交回原 mock 分支", () => {
    for (const slug of ["ssr-regression", "missing-fixture", "boom-fixture"]) {
      expect(state.handle("GET", `/api/v1/articles/${slug}`, {})).toBeNull();
    }
  });

  it("锁释放 / 上传 / 重置与统计计数", () => {
    call(state, "POST", `/api/v1/articles/${EDITOR_ARTICLE_ID}/edit-lock`);
    call(state, "DELETE", `/api/v1/articles/${EDITOR_ARTICLE_ID}/edit-lock`);
    const upload = call(state, "POST", "/api/v1/media/upload", {
      original_name: "photo.png",
    });
    expect(upload.body.data.url).toBe(
      "/api/v1/media/serve/media/2026/11/mock.png"
    );
    expect(upload.body.data.original_name).toBe("photo.png");

    const stats = state.stats();
    expect(stats.lockDeleteRequests).toBe(1);
    expect(stats.lockAcquireRequests).toBe(1);
    expect(stats.uploadRequests).toBe(1);

    state.reset();
    expect(state.stats().putRequests).toBe(0);
    expect(
      call(state, "GET", `/api/v1/articles/${EDITOR_ARTICLE_SLUG}`).body.data
        .content
    ).toContain("EDITOR_BASE_MARKER_68");
  });
});
