// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  generateSlug,
  isValidSlug,
  SLUG_MAX_LENGTH,
} from "../src/utils/editor/slug";

/**
 * issue #62（编辑器 T1）slug 行为基线。
 *
 * 服务端 worker/src/services/article_service.ts 的 generateSlug 规则（独立来源，
 * 逐字抄录用于人工推导期望值）：
 *   trim → .replace(/\s+/g,"-") → .replace(/-+/g,"-")
 *        → .replace(/[^\p{L}\p{N}\s-]/gu,"") → .slice(0,120)
 * 下表是与该实现相同的一组样例，期望值全部手写字面量，不跨包 import Worker
 * 实现、也不从被测函数反推；服务端或客户端任一侧改规则，这里都会变红。
 */
const SERVER_ALIGNED_SAMPLES: [title: string, expected: string][] = [
  ["Hello World", "Hello-World"],
  ["  多个   空格  ", "多个-空格"],
  ["中文 标题", "中文-标题"],
  ["A/B:C?D#E", "ABCDE"],
  ["a---b", "a-b"],
  ["a_b.c", "abc"],
  ["数字123 abc", "数字123-abc"],
  ["   ", ""],
  ["C++ 入门 🚀", "C-入门-"],
  ["- 标题 -", "-标题-"],
];

describe("generateSlug 与服务端规则对齐", () => {
  it.each(SERVER_ALIGNED_SAMPLES)("%j → %j", (title, expected) => {
    expect(generateSlug(title)).toBe(expected);
  });

  it("按 120 个字符截断，中文按 UTF-16 code unit 与服务端一致", () => {
    expect(SLUG_MAX_LENGTH).toBe(120);
    expect(generateSlug("x".repeat(130))).toBe("x".repeat(120));
    expect(generateSlug("中".repeat(121))).toBe("中".repeat(120));
    expect(generateSlug("x".repeat(130)).length).toBe(120);
  });
});

describe("isValidSlug 手改输入校验", () => {
  it("Unicode 字母 / 数字 / 连字符合法，中文 slug 保留", () => {
    expect(isValidSlug("hello-world")).toBe(true);
    expect(isValidSlug("中文-slug")).toBe(true);
    expect(isValidSlug("abc123")).toBe(true);
    expect(isValidSlug("数字123")).toBe(true);
  });

  it("空值、空白、路径分隔符与生成规则会删除的字符均非法", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("a/b")).toBe(false);
    expect(isValidSlug("a b")).toBe(false);
    expect(isValidSlug("a?b")).toBe(false);
    expect(isValidSlug("a_b")).toBe(false);
    expect(isValidSlug("a.b")).toBe(false);
  });

  it("长度上限与生成侧一致", () => {
    expect(isValidSlug("a".repeat(120))).toBe(true);
    expect(isValidSlug("a".repeat(121))).toBe(false);
  });

  it("允许首尾连字符：生成规则本身可能产出，校验不得自相矛盾", () => {
    expect(isValidSlug("-")).toBe(true);
    expect(isValidSlug("C-入门-")).toBe(true);
    expect(isValidSlug("-标题-")).toBe(true);
  });
});
