// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildUpdateSql,
  calculateReadingTime,
  needsColumn,
} from "../scripts/migrate-reading-time.mjs";
import { calculateReadingTime as workerCalculateReadingTime } from "../worker/src/services/article_service";

/**
 * issue #90 / M2 + #111 item 1：reading_time 落库的迁移守卫。
 *
 * 迁移脚本在 Node 侧回填，Worker 在写入时落库——两处算法必须逐字一致，
 * 否则存量与新建文章的阅读时长口径漂移。
 *
 * #111 item 1 假绿风险修复：原测试跨包 import Worker 实现做互证
 * （`expect(script(text)).toBe(worker(text))`），若两侧共享同一份代码
 * 或被同时改错，互证仍绿。改为两侧各写手写字面量：每侧独立断言期望值，
 * 改一侧不会让另一侧自动变绿。
 */

/**
 * 手写字面量：样例文本 → 期望阅读时长（分钟）。
 * 两份实现算法相同（中文 300 字/分 + 英文 200 词/分，向上取整，最小 1），
 * 但各自独立断言——改任一侧的实现，只有该侧的用例红。
 */
const EXPECTED: Array<[string, number]> = [
  ["", 1],
  ["纯英文 with several english words here", 1],
  ["中文短句", 1],
  ["中".repeat(350), 2],
  ["中".repeat(1000), 4],
  ["混合 Chinese 与 中文 content，还有标点！", 1],
  ["a b c d e f g h i j k", 1],
  // 边界：纯标点无中英文词 → 0/300 + 0/200 = 0 → max(1, ceil(0)) = 1
  ["！？。，", 1],
  // 200 英文词 → 1 分钟
  [Array.from({ length: 200 }, (_, i) => `word${i}`).join(" "), 1],
  // 201 英文词 → ceil(201/200) = 2 分钟
  [Array.from({ length: 201 }, (_, i) => `word${i}`).join(" "), 2],
  // 300 中文字 → 1 分钟
  ["中".repeat(300), 1],
  // 301 中文字 → ceil(301/300) = 2 分钟
  ["中".repeat(301), 2],
];

describe("迁移脚本 calculateReadingTime（手写字面量，#111 item 1）", () => {
  it.each(EXPECTED)("样例 %# → %i 分钟", (text, expected) => {
    expect(calculateReadingTime(text)).toBe(expected);
  });
});

describe("Worker calculateReadingTime（手写字面量，#111 item 1）", () => {
  it.each(EXPECTED)("样例 %# → %i 分钟", (text, expected) => {
    expect(workerCalculateReadingTime(text)).toBe(expected);
  });
});

/**
 * 交叉一致性断言：两侧对同一组样例必须同值。
 * 这是额外安全网——即使手写字面量两侧都写对了，
 * 如果两侧算法本身不一致（如一边改了速率），这里会红。
 * 与 #111 item 1 不矛盾：手写字面量保证「改一侧不会另一侧自动绿」，
 * 交叉断言保证「两侧算法本身一致」。
 */
describe("两侧算法一致性（交叉验证）", () => {
  it.each(EXPECTED)("样例 %# 两侧同值", (text) => {
    expect(calculateReadingTime(text)).toBe(workerCalculateReadingTime(text));
  });
});

describe("迁移幂等判定与 UPDATE 形状", () => {
  it("无列 / 空结果时需要加列；已有列时跳过", () => {
    expect(needsColumn([])).toBe(true);
    expect(needsColumn(null)).toBe(true);
    expect(needsColumn([{ name: "id" }, { name: "content" }])).toBe(true);
    expect(needsColumn([{ name: "id" }, { name: "reading_time" }])).toBe(false);
  });

  it("UPDATE 为参数化的单条语句，列与绑定分离", () => {
    expect(buildUpdateSql()).toBe(
      "UPDATE articles SET reading_time = ? WHERE id = ?"
    );
    expect(buildUpdateSql()).not.toMatch(/\$\{|`/);
  });
});
