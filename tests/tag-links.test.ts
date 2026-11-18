// @vitest-environment node
import { describe, expect, it } from "vitest";
import { tagChipHref } from "../src/utils/tagLinks";

/**
 * #116：全站标签 chip 目标 URL 的单一事实源。
 * 期望值均为手写字面量。
 */
describe("tagChipHref — 标签 chip 主路径（#116）", () => {
  it("有归属分类 → 分类筛选页", () => {
    expect(
      tagChipHref({
        slug: "vue",
        category: { slug: "frontend" },
      })
    ).toBe("/categories/frontend?tag=vue");
  });

  it("无归属分类 / category 为 null → 兼容入口 /tags/:slug", () => {
    expect(tagChipHref({ slug: "go" })).toBe("/tags/go");
    expect(tagChipHref({ slug: "go", category: null })).toBe("/tags/go");
  });

  it("分类 slug 走路径编码、标签 slug 走查询编码，注入字符不逃逸", () => {
    expect(
      tagChipHref({
        slug: "tag&x=1",
        category: { slug: "../../etc" },
      })
    ).toBe("/categories/..%2F..%2Fetc?tag=tag%26x%3D1");
  });
});
