// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { guardHtmlResponse } from "../scripts/cloudflare-guards.mjs";
import {
  applyArticleResponseHeaders,
  httpStatusForArticleResult,
  loadArticleForPage,
  type ArticleDetail,
  type ArticleLoadResult,
} from "../src/utils/articleServer";

/**
 * #38 / #36 / #40：文章详情页服务端取数接缝。
 *
 * 页面只消费 `loadArticleForPage` 的三态结果：ok / not-found / error，
 * 再由 `httpStatusForArticleResult` 映射成 200 / 404 / 502，并由
 * `applyArticleResponseHeaders` 写入阅读量 Cookie 与私有缓存语义。
 * 测试打桩 fetch，不依赖真实 Worker。
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
  const mock = vi.fn((_url: string, _init?: RequestInit) =>
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
      "https://api.example.test/api/v1/articles/%E6%9C%8D%E5%8A%A1%E7%AB%AF%20%E6%B8%B2%E6%9F%93",
      { signal: expect.any(AbortSignal) }
    );
    expect(result).toEqual({
      status: "ok",
      article: publishedArticle,
      setCookies: [],
    });
  });

  it("转发访客 Cookie 与 cf-connecting-ip（IP 以 X-Real-IP 传给上游）", async () => {
    const fetchMock = stubFetch(
      jsonResponse({ code: 0, message: "ok", data: publishedArticle })
    );

    await loadArticleForPage("已发布", {
      origin: "https://api.example.test",
      request: new Request("https://blog.example.test/articles/已发布", {
        headers: {
          cookie: "view_7=1; theme=dark",
          "cf-connecting-ip": "203.0.113.9",
        },
      }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const forwarded = new Headers(init?.headers);
    expect(forwarded.get("cookie")).toBe("view_7=1; theme=dark");
    expect(forwarded.get("x-real-ip")).toBe("203.0.113.9");
  });

  it("没有 cf-connecting-ip 时不转发 X-Real-IP（不采信客户端 X-Forwarded-For）", async () => {
    const fetchMock = stubFetch(
      jsonResponse({ code: 0, message: "ok", data: publishedArticle })
    );

    await loadArticleForPage("forwarded", {
      origin: "https://api.example.test",
      request: new Request("https://blog.example.test/articles/forwarded", {
        headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.2" },
      }),
    });

    const forwarded = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(forwarded.get("x-real-ip")).toBeNull();
    expect(forwarded.get("cookie")).toBeNull();
  });

  it("访客请求没有 Cookie / IP 时不向上游附加请求头", async () => {
    const fetchMock = stubFetch(
      jsonResponse({ code: 0, message: "ok", data: publishedArticle })
    );

    await loadArticleForPage("anonymous", {
      origin: "https://api.example.test",
      request: new Request("https://blog.example.test/articles/anonymous", {
        headers: { "user-agent": "vitest" },
      }),
    });

    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      signal: expect.any(AbortSignal),
    });
  });

  it("回传上游 Set-Cookie：阅读量去重 Cookie 原样交给页面", async () => {
    const response = jsonResponse({
      code: 0,
      message: "ok",
      data: publishedArticle,
    });
    response.headers.append(
      "Set-Cookie",
      "view_7=1; Path=/; Max-Age=86400; SameSite=Lax"
    );
    stubFetch(response);

    const result = await loadArticleForPage("已发布", {
      origin: "https://api.example.test",
    });

    expect(result).toEqual({
      status: "ok",
      article: publishedArticle,
      setCookies: ["view_7=1; Path=/; Max-Age=86400; SameSite=Lax"],
    });
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
      setCookies: [],
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

  it("上游长时间不响应时超时映射为 error", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          (_url: string, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => {
                reject(new DOMException("Aborted", "AbortError"));
              });
            })
        )
      );

      const pending = loadArticleForPage("slow", {
        origin: "https://api.example.test",
      });
      await vi.advanceTimersByTimeAsync(8_000);

      await expect(pending).resolves.toEqual({ status: "error" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("响应不是合法 JSON 映射为 error", async () => {
    stubFetch(new Response("<html>bad gateway</html>", { status: 200 }));

    await expect(
      loadArticleForPage("bad-json", { origin: "https://api.example.test" })
    ).resolves.toEqual({ status: "error" });
  });

  it("2xx 但响应体非法时仍回传已下发的 Set-Cookie（避免重试再计数）", async () => {
    const response = new Response("<html>bad gateway</html>", { status: 200 });
    response.headers.append(
      "Set-Cookie",
      "view_7=1; Path=/; Max-Age=86400; SameSite=Lax"
    );
    stubFetch(response);

    await expect(
      loadArticleForPage("bad-json", { origin: "https://api.example.test" })
    ).resolves.toEqual({
      status: "error",
      setCookies: ["view_7=1; Path=/; Max-Age=86400; SameSite=Lax"],
    });
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
      httpStatusForArticleResult({
        status: "ok",
        article: publishedArticle,
        setCookies: [],
      })
    ).toBe(200);
    expect(httpStatusForArticleResult({ status: "not-found" })).toBe(404);
    expect(httpStatusForArticleResult({ status: "error" })).toBe(502);
  });
});

describe("文章页响应头", () => {
  it("所有结果都写入私有、不可共享缓存的 Cache-Control", () => {
    const results: ArticleLoadResult[] = [
      { status: "ok", article: publishedArticle, setCookies: [] },
      { status: "not-found" },
      { status: "error" },
    ];

    for (const result of results) {
      const headers = new Headers();
      applyArticleResponseHeaders(headers, result);
      expect(headers.get("cache-control")).toBe("private, no-cache");
    }
  });

  it("ok 时把上游 Set-Cookie 原样追加到页面响应", () => {
    const headers = new Headers();

    applyArticleResponseHeaders(headers, {
      status: "ok",
      article: publishedArticle,
      setCookies: [
        "view_7=1; Path=/; Max-Age=86400; SameSite=Lax",
        "view_8=1; Path=/; Max-Age=86400; SameSite=Lax",
      ],
    });

    expect(headers.getSetCookie()).toEqual([
      "view_7=1; Path=/; Max-Age=86400; SameSite=Lax",
      "view_8=1; Path=/; Max-Age=86400; SameSite=Lax",
    ]);
  });

  it("error 结果携带 Set-Cookie 时也原样回传", () => {
    const headers = new Headers();

    applyArticleResponseHeaders(headers, {
      status: "error",
      setCookies: ["view_7=1; Path=/; Max-Age=86400; SameSite=Lax"],
    });

    expect(headers.getSetCookie()).toEqual([
      "view_7=1; Path=/; Max-Age=86400; SameSite=Lax",
    ]);
  });

  it("与 HTML 护栏组合后仍保留私有缓存指令", () => {
    const headers = new Headers();

    applyArticleResponseHeaders(headers, {
      status: "ok",
      article: publishedArticle,
      setCookies: [],
    });
    guardHtmlResponse(headers, "text/html; charset=utf-8");

    const cacheControl = headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("private");
    expect(cacheControl).toContain("no-cache");
    expect(cacheControl).toContain("no-transform");
  });

  it("not-found / error 不带 Set-Cookie", () => {
    for (const result of [
      { status: "not-found" },
      { status: "error" },
    ] satisfies ArticleLoadResult[]) {
      const headers = new Headers();
      applyArticleResponseHeaders(headers, result);
      expect(headers.getSetCookie()).toEqual([]);
    }
  });
});
