// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parseTagParam,
  buildTagFilterUrl,
  isValidTagSlug,
  renderFilterChips,
  resolveActiveTagSlug,
  renderFilteredEmpty,
  buildCategoryArticlesQuery,
} from "../src/utils/taxonomyFilter";

/**
 * issue #81 §5（taxonomy v2）：分类详情页 ?tag= 筛选的 URL 契约纯函数。
 * #117 起同文件钉住 SSR / 客户端共用的 chip HTML、筛选空态与列表 query。
 * 期望值均为手写字面量，不从被测函数反推。
 */

describe("isValidTagSlug — 解码后 slug 的合法性（中文 slug 合法）", () => {
  it("放行字母 / 数字 / 中文 / URL-safe 标点", () => {
    expect(isValidTagSlug("vue")).toBe(true);
    expect(isValidTagSlug("v1.0")).toBe(true);
    expect(isValidTagSlug("my-tag")).toBe(true);
    expect(isValidTagSlug("前端")).toBe(true);
    expect(isValidTagSlug("生活_随笔~1")).toBe(true);
  });

  it("拒绝空串与注入载体（空格 / 斜杠 / 引号 / 尖括号 / 百分号）", () => {
    expect(isValidTagSlug("")).toBe(false);
    expect(isValidTagSlug("a b")).toBe(false);
    expect(isValidTagSlug("<script>")).toBe(false);
    expect(isValidTagSlug('a"b')).toBe(false);
    expect(isValidTagSlug("a/b")).toBe(false);
    expect(isValidTagSlug("../etc")).toBe(false);
    expect(isValidTagSlug("%E5%89%8D")).toBe(false); // 已编码形态：本函数校验解码后的值
  });
});

describe("parseTagParam — ?tag= 解析（非法值一律 null）", () => {
  it("缺失 / 空 → null", () => {
    expect(parseTagParam("")).toBeNull();
    expect(parseTagParam("?page=2")).toBeNull();
    expect(parseTagParam("?tag=")).toBeNull();
  });

  it("合法值返回解码后的 slug（URLSearchParams 自动解码）", () => {
    expect(parseTagParam("?tag=vue")).toBe("vue");
    expect(parseTagParam("?tag=v1.0")).toBe("v1.0");
    expect(parseTagParam("?tag=%E5%89%8D%E7%AB%AF")).toBe("前端");
  });

  it("非法值（空格 / 注入 / 点段）→ null", () => {
    expect(parseTagParam("?tag=a+b")).toBeNull();
    expect(parseTagParam("?tag=<script>")).toBeNull();
    expect(parseTagParam("?tag=../etc")).toBeNull();
  });
});

describe("buildTagFilterUrl — 构造（「全部」= 无参 basePath）", () => {
  it("null / 非法值 → basePath", () => {
    expect(buildTagFilterUrl("/categories/tech", null)).toBe(
      "/categories/tech"
    );
    expect(buildTagFilterUrl("/categories/tech", "a b")).toBe(
      "/categories/tech"
    );
    expect(buildTagFilterUrl("/categories/tech", "")).toBe("/categories/tech");
  });

  it("合法值 → ?tag=（encodeURIComponent，中文 slug 编码为合法 URL）", () => {
    expect(buildTagFilterUrl("/categories/tech", "vue")).toBe(
      "/categories/tech?tag=vue"
    );
    expect(buildTagFilterUrl("/categories/tech", "v1.0")).toBe(
      "/categories/tech?tag=v1.0"
    );
    expect(buildTagFilterUrl("/categories/tech", "前端")).toBe(
      "/categories/tech?tag=%E5%89%8D%E7%AB%AF"
    );
  });
});

describe("resolveActiveTagSlug — 归属校验（SSR 与客户端共用）", () => {
  const tags = [{ slug: "vue", name: "Vue", article_count: 3 }];

  it("属于给定标签集 → 原样返回；缺失 / 越界 → null（全部）", () => {
    expect(resolveActiveTagSlug(tags, "vue")).toBe("vue");
    expect(resolveActiveTagSlug(tags, "react")).toBeNull();
    expect(resolveActiveTagSlug(tags, null)).toBeNull();
    expect(resolveActiveTagSlug([], "vue")).toBeNull();
  });
});

describe("renderFilteredEmpty — 筛选空态（SSR 与客户端共用）", () => {
  it("清除筛选是回无参 basePath 的链接，文案转义", () => {
    expect(
      renderFilteredEmpty("/categories/tech", "该标签暂无文章", "清除筛选")
    ).toBe(
      '<div class="filtered-empty"><p>该标签暂无文章</p><a href="/categories/tech" id="clear-tag-filter">清除筛选</a></div>'
    );
    expect(
      renderFilteredEmpty("/categories/tech", "<b>空</b>", "清除筛选")
    ).toBe(
      '<div class="filtered-empty"><p>&lt;b&gt;空&lt;/b&gt;</p><a href="/categories/tech" id="clear-tag-filter">清除筛选</a></div>'
    );
  });
});

describe("buildCategoryArticlesQuery — 服务端 / 客户端共用 query", () => {
  it("status / page / page_size / category_slug，筛选时追加 tag_slug", () => {
    expect(
      buildCategoryArticlesQuery({ categorySlug: "tech", tagSlug: "vue" })
    ).toBe(
      "status=published&page=1&page_size=10&category_slug=tech&tag_slug=vue"
    );
  });

  it("页码与中文 slug 均正确编码", () => {
    expect(
      buildCategoryArticlesQuery({
        categorySlug: "前端",
        tagSlug: "前端",
        page: 2,
      })
    ).toBe(
      "status=published&page=2&page_size=10&category_slug=%E5%89%8D%E7%AB%AF&tag_slug=%E5%89%8D%E7%AB%AF"
    );
  });
});

describe("renderFilterChips — 服务端与客户端共用的筛选 chip（#117）", () => {
  const tags = [
    { slug: "vue", name: "Vue", article_count: 3 },
    { slug: "react", name: "React", article_count: 0 },
  ];

  it("「全部」回无参 basePath，选中态用 aria-current=page（不用 aria-pressed）", () => {
    expect(renderFilterChips("/categories/tech", tags, null, "全部")).toBe(
      '<a class="filter-chip" href="/categories/tech" data-tag="" aria-current="page">全部</a>' +
        '<a class="filter-chip" href="/categories/tech?tag=vue" data-tag="vue">Vue</a>' +
        '<a class="filter-chip" href="/categories/tech?tag=react" data-tag="react">React</a>'
    );
  });

  it("选中标签 → 该 chip 带 aria-current=page，恰一个", () => {
    const html = renderFilterChips("/categories/tech", tags, "vue", "全部");
    expect(html).toBe(
      '<a class="filter-chip" href="/categories/tech" data-tag="">全部</a>' +
        '<a class="filter-chip" href="/categories/tech?tag=vue" data-tag="vue" aria-current="page">Vue</a>' +
        '<a class="filter-chip" href="/categories/tech?tag=react" data-tag="react">React</a>'
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("中文 slug 编码进 href，名称与属性均转义", () => {
    expect(
      renderFilterChips(
        "/categories/tech",
        [{ slug: "前端", name: '<b>"前端"</b>', article_count: 1 }],
        "前端",
        "全部"
      )
    ).toBe(
      '<a class="filter-chip" href="/categories/tech" data-tag="">全部</a>' +
        '<a class="filter-chip" href="/categories/tech?tag=%E5%89%8D%E7%AB%AF" data-tag="前端" aria-current="page">&lt;b&gt;&quot;前端&quot;&lt;/b&gt;</a>'
    );
  });

  it("非法 / 不属于本分类的选中值 → 回退到「全部」，不标任何标签", () => {
    const html = renderFilterChips("/categories/tech", tags, "missing", "全部");
    expect(html).toContain(
      '<a class="filter-chip" href="/categories/tech" data-tag="" aria-current="page">全部</a>'
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("非法标签 slug 不进入筛选 URL（href 回 basePath），data-tag 仍转义", () => {
    expect(
      renderFilterChips(
        "/categories/tech",
        [{ slug: 'a"b', name: "坏标签" }],
        null,
        "全部"
      )
    ).toContain(
      '<a class="filter-chip" href="/categories/tech" data-tag="a&quot;b">坏标签</a>'
    );
  });
});
