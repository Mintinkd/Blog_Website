// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadTaxonomyForPage,
  type TaxonomyResult,
} from "../src/utils/taxonomyServer";

/**
 * issue #97 / M17：分类 / 标签页服务端取数首屏（方案 A）。
 *
 * 接缝：loadTaxonomyForPage —— 四页面 frontmatter 调用的取数函数。
 * 四类 kind：categories / tags（目录），category-articles / tag-articles（详情文章列表）。
 * 三态结果：ok（含 items）/ empty / error（网络失败 / 非 2xx / 非法响应体）。
 * 测试打桩 fetch，不依赖真实 Worker（与 article-server.test.ts 同构）。
 */

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
  vi.restoreAllMocks();
});

describe("loadTaxonomyForPage 取数与三态（issue #97）", () => {
  it("categories：保留 id / tag_count（#119），缺 tag_count 降级为 0", async () => {
    const fetchMock = stubFetch(
      jsonResponse({
        code: 0,
        data: [
          { id: 1, name: "技术", slug: "tech", article_count: 3, tag_count: 5 },
          { id: 2, name: "生活", slug: "life", article_count: 0 },
        ],
      })
    );
    const result = await loadTaxonomyForPage("categories", {
      origin: "https://worker.test",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://worker.test/api/v1/categories"
    );
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.items).toEqual([
        {
          id: 1,
          name: "技术",
          slug: "tech",
          article_count: 3,
          description: "",
          tag_count: 5,
        },
        {
          id: 2,
          name: "生活",
          slug: "life",
          article_count: 0,
          description: "",
          tag_count: 0,
        },
      ]);
    }
  });

  it("tags：data.items 形式也支持，保留 category_id / category（#119）", async () => {
    stubFetch(
      jsonResponse({
        code: 0,
        data: {
          items: [
            {
              id: 3,
              name: "Astro",
              slug: "astro",
              article_count: 2,
              category_id: 7,
              category: { id: 7, name: "前端", slug: "frontend" },
            },
          ],
        },
      })
    );
    const result = await loadTaxonomyForPage("tags", {
      origin: "https://worker.test",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.items).toEqual([
        {
          id: 3,
          name: "Astro",
          slug: "astro",
          article_count: 2,
          description: "",
          category_id: 7,
          category: { id: 7, name: "前端", slug: "frontend" },
        },
      ]);
    }
  });

  it("目录项畸形字段降级为 0 / null，不影响同批其它项（#119）", async () => {
    stubFetch(
      jsonResponse({
        code: 0,
        data: [
          {
            id: 1,
            name: "坏计数",
            slug: "bad-count",
            article_count: "3",
            tag_count: null,
          },
          {
            id: 2,
            name: "好计数",
            slug: "good-count",
            article_count: 2,
            tag_count: 4,
          },
        ],
      })
    );
    const result = await loadTaxonomyForPage("categories", {
      origin: "https://worker.test",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.items).toEqual([
        {
          id: 1,
          name: "坏计数",
          slug: "bad-count",
          article_count: 0,
          description: "",
          tag_count: 0,
        },
        {
          id: 2,
          name: "好计数",
          slug: "good-count",
          article_count: 2,
          description: "",
          tag_count: 4,
        },
      ]);
    }
  });

  it("tags：category 畸形 / 缺字段降级为 null，不影响同批其它项（#119）", async () => {
    stubFetch(
      jsonResponse({
        code: 0,
        data: [
          {
            id: 1,
            name: "好归属",
            slug: "good",
            article_count: 1,
            category_id: 7,
            category: { id: 7, name: "前端", slug: "frontend" },
          },
          {
            id: 2,
            name: "坏归属",
            slug: "bad",
            article_count: 0,
            category_id: "7",
            category: { name: "缺 id", slug: "no-id" },
          },
          { id: 3, name: "无归属", slug: "none", article_count: 0 },
        ],
      })
    );
    const result = await loadTaxonomyForPage("tags", {
      origin: "https://worker.test",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.items).toEqual([
        {
          id: 1,
          name: "好归属",
          slug: "good",
          article_count: 1,
          description: "",
          category_id: 7,
          category: { id: 7, name: "前端", slug: "frontend" },
        },
        {
          id: 2,
          name: "坏归属",
          slug: "bad",
          article_count: 0,
          description: "",
          category_id: null,
          category: null,
        },
        {
          id: 3,
          name: "无归属",
          slug: "none",
          article_count: 0,
          description: "",
          category_id: null,
          category: null,
        },
      ]);
    }
  });

  it("category-articles：URL 带 category_slug 参数，items 为文章列表", async () => {
    const fetchMock = stubFetch(
      jsonResponse({
        code: 0,
        data: {
          items: [
            {
              slug: "hello",
              title: "你好",
              summary: "摘要",
              published_at: "2026-01-01",
              view_count: 5,
              tags: [],
            },
          ],
          total_pages: 1,
        },
      })
    );
    const result = await loadTaxonomyForPage("category-articles", {
      origin: "https://worker.test",
      slug: "tech",
    });
    expect(fetchMock.mock.calls[0][0]).toContain("category_slug=tech");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.items[0]).toMatchObject({ slug: "hello", title: "你好" });
      expect(result.totalPages).toBe(1);
    }
  });

  it("category-articles + tagSlug：URL 追加 tag_slug（经 encodeURIComponent）", async () => {
    const fetchMock = stubFetch(
      jsonResponse({ code: 0, data: { items: [], total_pages: 0 } })
    );
    await loadTaxonomyForPage("category-articles", {
      origin: "https://worker.test",
      slug: "tech",
      tagSlug: "前端",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://worker.test/api/v1/articles?status=published&page=1&page_size=10&category_slug=tech&tag_slug=%E5%89%8D%E7%AB%AF"
    );
  });

  it("tags + categorySlug：URL 带 category_slug（经 encodeURIComponent）", async () => {
    const fetchMock = stubFetch(jsonResponse({ code: 0, data: [] }));
    await loadTaxonomyForPage("tags", {
      origin: "https://worker.test",
      categorySlug: "前端",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://worker.test/api/v1/tags?category_slug=%E5%89%8D%E7%AB%AF"
    );
  });

  it("category-articles：内嵌标签解析 category 映射（缺省 null）", async () => {
    stubFetch(
      jsonResponse({
        code: 0,
        data: {
          items: [
            {
              slug: "hello",
              title: "你好",
              tags: [
                {
                  name: "Vue",
                  slug: "vue",
                  category: { id: 2, name: "前端", slug: "frontend" },
                },
                { name: "旧标签", slug: "legacy" },
              ],
            },
          ],
          total_pages: 1,
        },
      })
    );
    const result = await loadTaxonomyForPage("category-articles", {
      origin: "https://worker.test",
      slug: "tech",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.items[0]).toMatchObject({
        tags: [
          {
            name: "Vue",
            slug: "vue",
            category: { name: "前端", slug: "frontend" },
          },
          { name: "旧标签", slug: "legacy", category: null },
        ],
      });
    }
  });

  it("tag-articles：URL 带 tag_slug 参数（slug 经 encodeURIComponent）", async () => {
    const fetchMock = stubFetch(
      jsonResponse({ code: 0, data: { items: [], total_pages: 0 } })
    );
    const result = await loadTaxonomyForPage("tag-articles", {
      origin: "https://worker.test",
      slug: "中文标签",
    });
    expect(fetchMock.mock.calls[0][0]).toContain(
      `tag_slug=${encodeURIComponent("中文标签")}`
    );
    expect(result.status).toBe("empty");
  });

  it("空数组 / 空 items → empty", async () => {
    stubFetch(jsonResponse({ code: 0, data: [] }));
    expect(
      (await loadTaxonomyForPage("categories", { origin: "x" })).status
    ).toBe("empty");
  });

  it("网络失败 / 非 2xx / 非法响应体 → error", async () => {
    stubFetch(new Error("network"));
    expect((await loadTaxonomyForPage("tags", { origin: "x" })).status).toBe(
      "error"
    );

    stubFetch(jsonResponse({ code: 1, message: "x" }));
    expect((await loadTaxonomyForPage("tags", { origin: "x" })).status).toBe(
      "error"
    );

    stubFetch(jsonResponse({ code: 0, data: "not-array" }));
    expect((await loadTaxonomyForPage("tags", { origin: "x" })).status).toBe(
      "error"
    );
  });

  it("超时 abort 映射为 error（不抛异常）", async () => {
    stubFetch(new Error("aborted"));
    const result: TaxonomyResult = await loadTaxonomyForPage("categories", {
      origin: "x",
    });
    expect(result.status).toBe("error");
  });
});
