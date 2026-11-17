// @vitest-environment node
// issue #69 / T8 阶段2：内容类 4 个面板抽出的纯逻辑 + shared.logic。
// 期望值均为手写字面量，不从被测函数反推。
import { describe, it, expect } from "vitest";
import { buildCategoryRequest } from "../src/admin/panels/categories.logic";
import {
  buildTagRequest,
  buildMoveTagRequest,
} from "../src/admin/panels/tags.logic";
import { commentsPath } from "../src/admin/composables/useAdminCatalog";
import { resolveMediaUrl } from "../src/admin/panels/media.logic";
import {
  formatDate,
  canEditCategory,
  canManageTag,
} from "../src/admin/panels/shared.logic";

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

  it("taxonomy v2（#80）：新建带分类 → body 含 category_id；移动归属 → PUT /tags/:id 只含 category_id", () => {
    expect(
      buildTagRequest({ name: "前端", slug: "frontend", category_id: 2 })
    ).toEqual({
      method: "POST",
      path: "/tags",
      body: { name: "前端", slug: "frontend", category_id: 2 },
    });
    expect(buildMoveTagRequest(11, 3)).toEqual({
      method: "PUT",
      path: "/tags/11",
      // name/slug 为占位空值：worker PUT 只消费 category_id，name/slug 刻意不变
      body: { name: "", slug: "", category_id: 3 },
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

  it("canManageTag 权限矩阵（#79 / ADR 0008 决策 5）：admin 全部；editor 仅创建者或目标分类所有者；无主从严拒绝", () => {
    // admin 不受限
    expect(canManageTag("admin", null, null, 1)).toBe(true);
    expect(canManageTag("admin", 42, 42, 1)).toBe(true);
    // editor 是标签创建者 → 可管理（目标分类无主也可）
    expect(canManageTag("editor", 1, null, 1)).toBe(true);
    // editor 是目标分类所有者 → 可管理（即使不是标签创建者）
    expect(canManageTag("editor", 42, 1, 1)).toBe(true);
    // 两边都不是 → 403
    expect(canManageTag("editor", 42, 42, 1)).toBe(false);
    // 无主标签 + 无主分类（迁移期遗留形态）→ 从严拒绝，与 worker handleUpdateTag 同口径
    expect(canManageTag("editor", null, null, 1)).toBe(false);
    // undefined 同 null 处理
    expect(canManageTag("editor", undefined, undefined, 1)).toBe(false);
  });
});
