// @vitest-environment node
// issue #69 / T8 阶段2：内容类 4 个面板抽出的纯逻辑 + shared.logic。
// 期望值均为手写字面量，不从被测函数反推。
import { describe, it, expect } from "vitest";
import { buildCategoryRequest } from "../src/admin/panels/categories.logic";
import { buildTagRequest } from "../src/admin/panels/tags.logic";
import { commentsPath } from "../src/admin/composables/useAdminCatalog";
import { resolveMediaUrl } from "../src/admin/panels/media.logic";
import { formatDate, canEditCategory } from "../src/admin/panels/shared.logic";

describe("CategoriesPanel — buildCategoryRequest 纯 payload 构造", () => {
  it("编辑（有 id）用 PUT /categories/:id，新建（null）用 POST /categories，body 原样", () => {
    const form = { name: "随笔", slug: "essay", description: "说明" };
    expect(buildCategoryRequest(form, 7)).toEqual({
      method: "PUT",
      path: "/categories/7",
      body: { name: "随笔", slug: "essay", description: "说明" },
    });
    expect(buildCategoryRequest(form, null)).toEqual({
      method: "POST",
      path: "/categories",
      body: { name: "随笔", slug: "essay", description: "说明" },
    });
  });
});

describe("TagsPanel — buildTagRequest 纯 payload 构造", () => {
  it("保存标签固定 POST /tags，body 为 name/slug", () => {
    expect(buildTagRequest({ name: "猫", slug: "cat" })).toEqual({
      method: "POST",
      path: "/tags",
      body: { name: "猫", slug: "cat" },
    });
  });
});

describe("CommentsPanel — commentsPath 纯判定", () => {
  it("空 filter 为 /comments，带 filter 拼 ?status=", () => {
    expect(commentsPath("")).toBe("/comments");
    expect(commentsPath("pending")).toBe("/comments?status=pending");
    expect(commentsPath("approved")).toBe("/comments?status=approved");
  });
});

describe("MediaPanel — resolveMediaUrl 纯 URL 解析", () => {
  it("相对路径按 origin 补全，绝对 URL 原样返回", () => {
    expect(resolveMediaUrl("/media/a.png", "https://example.com")).toBe(
      "https://example.com/media/a.png"
    );
    expect(
      resolveMediaUrl("https://cdn.example.com/x.png", "https://example.com")
    ).toBe("https://cdn.example.com/x.png");
  });
});

describe("shared.logic — formatDate / canEditCategory", () => {
  it("覆盖 formatDate 空值/日期串 与 canEditCategory 权限判定", () => {
    expect(formatDate("", "zh")).toBe("-");
    expect(formatDate("2024-06-15T12:00:00", "en")).toBe("6/15/2024");
    expect(canEditCategory("admin", 42, 1)).toBe(true);
    expect(canEditCategory("editor", null, 1)).toBe(true);
    expect(canEditCategory("editor", 1, 1)).toBe(true);
    expect(canEditCategory("editor", 42, 1)).toBe(false);
  });
});
