// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CHINESE_CHARS_PER_MINUTE,
  countWords,
  ENGLISH_WORDS_PER_MINUTE,
  readingTimeMinutes,
} from "../src/utils/editor/wordCount";

/**
 * issue #62（编辑器 T1）字数 / 阅读时长行为基线。
 *
 * 服务端 worker/src/services/article_service.ts 的 calculateReadingTime 规则
 * （独立来源，逐字抄录用于人工推导期望值）：
 *   chinese = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
 *   english = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, " ")
 *                 .split(/\s+/).filter(w => w.length > 0).length
 *   minutes = chinese / 300 + english / 200
 *   return Math.max(1, Math.ceil(minutes))
 * 下表是与服务端相同的一组样例，期望值全部手写字面量；Markdown 标记与中文
 * 标点被计入「英文词」是服务端既有口径，客户端不得擅自修正。
 */
const SERVER_ALIGNED_SAMPLES: [
  text: string,
  chinese: number,
  english: number,
  total: number,
  minutes: number,
][] = [
  ["", 0, 0, 0, 1],
  ["你好世界", 4, 0, 4, 1],
  ["hello world", 0, 2, 2, 1],
  ["中文 hello 世界", 4, 1, 5, 1],
  ["㐀", 1, 0, 1, 1],
  ["，。", 0, 1, 1, 1],
  ["# 标题", 2, 1, 3, 1],
  ["a  b", 0, 2, 2, 1],
  ["a", 0, 1, 1, 1],
];

describe("countWords / readingTimeMinutes 与服务端规则对齐", () => {
  it.each(SERVER_ALIGNED_SAMPLES)(
    "%j → 中 %i / 英 %i / 共 %i / %i 分钟",
    (text, chinese, english, total, minutes) => {
      expect(countWords(text)).toEqual({ chinese, english, total });
      expect(readingTimeMinutes(text)).toBe(minutes);
    }
  );

  it("速率常量与服务端一致", () => {
    expect(CHINESE_CHARS_PER_MINUTE).toBe(300);
    expect(ENGLISH_WORDS_PER_MINUTE).toBe(200);
  });

  it("中文 300 字边界：300 → 1 分钟，301 → 2 分钟", () => {
    expect(countWords("中".repeat(300))).toEqual({
      chinese: 300,
      english: 0,
      total: 300,
    });
    expect(readingTimeMinutes("中".repeat(300))).toBe(1);
    expect(readingTimeMinutes("中".repeat(301))).toBe(2);
  });

  it("英文 200 词边界：200 → 1 分钟，201 → 2 分钟", () => {
    expect(countWords("word ".repeat(200).trim())).toEqual({
      chinese: 0,
      english: 200,
      total: 200,
    });
    expect(readingTimeMinutes("word ".repeat(200).trim())).toBe(1);
    expect(readingTimeMinutes("word ".repeat(201).trim())).toBe(2);
  });

  it("中英混合按两项速率相加后向上取整", () => {
    const mixed = "中".repeat(150) + " " + "word ".repeat(100).trim();
    expect(countWords(mixed)).toEqual({
      chinese: 150,
      english: 100,
      total: 250,
    });
    expect(readingTimeMinutes(mixed)).toBe(1);
    const longer = "中".repeat(300) + " " + "word ".repeat(100).trim();
    expect(readingTimeMinutes(longer)).toBe(2);
  });

  it("空正文最少 1 分钟（Math.max(1, …)）", () => {
    expect(readingTimeMinutes("")).toBe(1);
    expect(readingTimeMinutes("   \n  ")).toBe(1);
  });
});
