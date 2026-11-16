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
  it("categories：code=0 数组 → ok，items 含 name/slug/article_count", async () => {
    const fetchMock = stubFetch(
      jsonResponse({
        code: 0,
        data: [
          { id: 1, name: "技术", slug: "tech", article_count: 3 },
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
        { name: "技术", slug: "tech", article_count: 3, description: "" },
        { name: "生活", slug: "life", article_count: 0, description: "" },
      ]);
    }
  });

  it("tags：data.items 形式也支持（兼容分页响应）", async () => {
    stubFetch(
      jsonResponse({
        code: 0,
        data: {
          items: [{ id: 3, name: "Astro", slug: "astro", article_count: 2 }],
        },
      })
    );
    const result = await loadTaxonomyForPage("tags", {
      origin: "https://worker.test",
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.items).toEqual([
        { name: "Astro", slug: "astro", article_count: 2, description: "" },
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
