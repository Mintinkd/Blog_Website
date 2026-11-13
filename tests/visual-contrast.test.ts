/**
 * 观感友好度检查的颜色数学行为锁。
 *
 * 期望值全部手写、来自可独立验算的简单样本（纯黑 / 纯白 / 半透明黑叠白），
 * 不从被测实现反推：检查脚本一旦把对比度算错，就会对页面误报或漏报。
 */
import { describe, expect, it } from "vitest";
import {
  colorDistance,
  compositeLayers,
  contrastRatio,
  effectiveBackground,
  effectiveForeground,
  formatRgb,
  parseColor,
} from "../scripts/visual-contrast.mjs";

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };

describe("parseColor", () => {
  it("解析逗号、空格与斜杠 alpha 三种 computed style 写法", () => {
    expect(parseColor("rgb(29, 29, 31)")).toEqual({
      r: 29,
      g: 29,
      b: 31,
      a: 1,
    });
    expect(parseColor("rgba(73, 177, 245, 0.08)")).toEqual({
      r: 73,
      g: 177,
      b: 245,
      a: 0.08,
    });
    expect(parseColor("rgb(29 29 31 / 0.5)")).toEqual({
      r: 29,
      g: 29,
      b: 31,
      a: 0.5,
    });
    expect(parseColor("transparent")).toBeNull();
  });
});

describe("compositeLayers", () => {
  it("半透明黑 50% 叠不透明白得到中灰", () => {
    // layers 由内到外：顶层半透明黑，底层不透明白
    const result = compositeLayers([
      { r: 0, g: 0, b: 0, a: 0.5 },
      { ...WHITE, a: 1 },
    ]);
    expect(result).toEqual({ r: 128, g: 128, b: 128, a: 1 });
  });

  it("由内到外逐层叠加，跳过全透明层", () => {
    const result = compositeLayers([
      { r: 255, g: 0, b: 0, a: 0.5 },
      { r: 0, g: 0, b: 0, a: 0 },
      { ...WHITE, a: 1 },
    ]);
    expect(result.r).toBe(255);
    expect(result.g).toBe(128);
    expect(result.b).toBe(128);
  });

  it("effectiveBackground 对全透明层兜底为不透明白", () => {
    expect(effectiveBackground([{ r: 0, g: 0, b: 0, a: 0 }])).toEqual(WHITE);
  });

  it("effectiveForeground 把半透明文字色合成到背景上", () => {
    expect(effectiveForeground({ r: 0, g: 0, b: 0, a: 0.5 }, WHITE)).toEqual({
      r: 128,
      g: 128,
      b: 128,
    });
  });
});

describe("contrastRatio", () => {
  it("纯黑 / 纯白为 21:1，同色为 1:1", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
    // 交换前后景不得改变结果
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 5);
  });

  it("中灰 / 白约为 3.95:1（低于正文 4.5 门槛，应被判不达标）", () => {
    expect(contrastRatio({ r: 128, g: 128, b: 128 }, WHITE)).toBeGreaterThan(
      3.9
    );
    expect(contrastRatio({ r: 128, g: 128, b: 128 }, WHITE)).toBeLessThan(4.0);
    expect(contrastRatio({ r: 128, g: 128, b: 128 }, WHITE)).toBeLessThan(4.5);
  });

  it("--color-text-tertiary 亮色值在白底上仍达 AA 正文 4.5:1", () => {
    expect(
      contrastRatio({ r: 0x76, g: 0x76, b: 0x7e }, WHITE)
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("colorDistance / formatRgb", () => {
  it("同色距离 0，黑白距离约 441.67", () => {
    expect(colorDistance(WHITE, WHITE)).toBe(0);
    expect(colorDistance(BLACK, WHITE)).toBeCloseTo(Math.sqrt(3 * 255 ** 2), 5);
    expect(colorDistance(null, WHITE)).toBe(0);
  });

  it("formatRgb 稳定输出 rgb(r, g, b)", () => {
    expect(formatRgb({ r: 28, g: 28, b: 30 })).toBe("rgb(28, 28, 30)");
  });
});
