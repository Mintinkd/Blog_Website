// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildUpdateSql,
  calculateReadingTime,
  needsColumn,
} from "../scripts/migrate-reading-time.mjs";
import { calculateReadingTime as workerCalculateReadingTime } from "../worker/src/services/article_service";

/**
 * issue #90 / M2：reading_time 落库的迁移守卫。
 *
 * 迁移脚本在 Node 侧回填，Worker 在写入时落库——两处算法必须逐字一致，
 * 否则存量与新建文章的阅读时长口径漂移。本测试锁定二者对同一组样例同值。
 */

describe("reading_time 迁移算法与 Worker 一致", () => {
  const SAMPLES = [
    "",
    "纯英文 with several english words here",
    "中文短句",
    "中".repeat(350),
    "中".repeat(1000),
    "混合 Chinese 与 中文 content，还有标点！",
    "a b c d e f g h i j k",
  ];

  it.each(SAMPLES)("样例 %# 两处算法同值", (text) => {
    expect(calculateReadingTime(text)).toBe(workerCalculateReadingTime(text));
  });

  it("手写字面量：350 中文字 = 2 分钟，1000 中文字 = 4 分钟", () => {
    expect(calculateReadingTime("中".repeat(350))).toBe(2);
    expect(calculateReadingTime("中".repeat(1000))).toBe(4);
    expect(calculateReadingTime("")).toBe(1);
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
