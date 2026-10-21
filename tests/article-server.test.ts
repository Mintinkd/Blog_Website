// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  httpStatusForArticleResult,
  loadArticleForPage,
  type ArticleDetail,
} from "../src/utils/articleServer";

/**
 * #38 / #36：文章详情页服务端取数接缝。
 *
 * 页面只消费 `loadArticleForPage` 的三态结果：ok / not-found / error，
 * 再由 `httpStatusForArticleResult` 映射成 200 / 404 / 502。测试打桩 fetch，
 * 不依赖真实 Worker；Cookie 转发与 Set-Cookie 回传由 T4 在此接缝上补齐。
 */

const publishedArticle: ArticleDetail = {
  id: 7,
  title: "服务端渲染",
  slug: "服务端渲染",
  content: "# 标题\n\n正文",
  summary: "摘要",
  cover_image: "/cover.png",
  category: { id: 1, name: "技术", slug: "tech" },
  tags: [{ id: 2, name: "Astro", slug: "astro" }],
  status: "published",
  view_count: 3,
  like_count: 4,
  reading_time: 2,
  published_at: "2026-10-22T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(response: Response | Error) {
  const mock = vi.fn(() =>
    response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response)
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("文章页服务端取数", () => {
  it("取到已发布文章：直连 Worker origin 并编码 slug", async () => {
    const fetchMock = stubFetch(
      jsonResponse({ code: 0, message: "ok", data: publishedArticle })
    );

    const result = await loadArticleForPage("服务端 渲染", {
      origin: "https://api.example.test",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/v1/articles/%E6%9C%8D%E5%8A%A1%E7%AB%AF%20%E6%B8%B2%E6%9F%93"
    );
    expect(result).toEqual({ status: "ok", article: publishedArticle });
  });

  it("缺省可选字段归一为空值，不把 undefined 漏进页面", async () => {
    stubFetch(
      jsonResponse({
        code: 0,
        message: "ok",
        data: {
          id: 1,
          title: "最小文章",
          slug: "minimal",
          content: "正文",
          status: "published",
        },
      })
    );

    const result = await loadArticleForPage("minimal", {
      origin: "https://api.example.test",
    });

    expect(result).toEqual({
      status: "ok",
      article: {
        id: 1,
        title: "最小文章",
        slug: "minimal",
        content: "正文",
        summary: "",
        cover_image: "",
        category: null,
        tags: [],
        status: "published",
        view_count: 0,
        like_count: 0,
        reading_time: 1,
        published_at: null,
      },
    });
  });

  it("未知 slug 的 404 映射为 not-found", async () => {
    stubFetch(
      jsonResponse(
        { code: 10005, message: "Article not found", data: null },
        404
      )
    );

    await expect(
      loadArticleForPage("missing", { origin: "https://api.example.test" })
    ).resolves.toEqual({ status: "not-found" });
  });

  it("上游返回草稿时按未发布处理（not-found）", async () => {
    stubFetch(
      jsonResponse({
        code: 0,
        message: "ok",
        data: { ...publishedArticle, status: "draft" },
      })
    );

    await expect(
      loadArticleForPage("draft", { origin: "https://api.example.test" })
    ).resolves.toEqual({ status: "not-found" });
  });

  it("上游 5xx 映射为 error", async () => {
    stubFetch(jsonResponse({ code: 10008, message: "boom", data: null }, 500));

    await expect(
      loadArticleForPage("boom", { origin: "https://api.example.test" })
    ).resolves.toEqual({ status: "error" });
  });

  it("网络不可达映射为 error", async () => {
    stubFetch(new TypeError("fetch failed"));

    await expect(
      loadArticleForPage("offline", { origin: "https://api.example.test" })
    ).resolves.toEqual({ status: "error" });
  });

  it("响应不是合法 JSON 映射为 error", async () => {
    stubFetch(new Response("<html>bad gateway</html>", { status: 200 }));

    await expect(
      loadArticleForPage("bad-json", { origin: "https://api.example.test" })
    ).resolves.toEqual({ status: "error" });
  });

  it("业务码非 0 映射为 error", async () => {
    stubFetch(jsonResponse({ code: 10008, message: "boom", data: null }));

    await expect(
      loadArticleForPage("bad-code", { origin: "https://api.example.test" })
    ).resolves.toEqual({ status: "error" });
  });

  it("文章缺少正文等必要字段映射为 error", async () => {
    stubFetch(
      jsonResponse({
        code: 0,
        message: "ok",
        data: {
          id: 1,
          title: "缺正文",
          slug: "no-content",
          status: "published",
        },
      })
    );

    await expect(
      loadArticleForPage("no-content", { origin: "https://api.example.test" })
    ).resolves.toEqual({ status: "error" });
  });
});

describe("文章页状态码映射", () => {
  it("ok / not-found / error 分别映射为 200 / 404 / 502", () => {
    expect(
      httpStatusForArticleResult({ status: "ok", article: publishedArticle })
    ).toBe(200);
    expect(httpStatusForArticleResult({ status: "not-found" })).toBe(404);
    expect(httpStatusForArticleResult({ status: "error" })).toBe(502);
  });
});
