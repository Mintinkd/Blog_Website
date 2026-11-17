// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parseTagParam,
  buildTagFilterUrl,
  isValidTagSlug,
} from "../src/utils/taxonomyFilter";

/**
 * issue #81 §5（taxonomy v2）：分类详情页 ?tag= 筛选的 URL 契约纯函数。
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
