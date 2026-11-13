/**
 * scripts/visual-contrast.mjs 的类型声明（观感友好度检查的颜色数学单源）。
 * 导出面与实现成对维护：实现改动触及导出时同步本文件。
 */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** 解析 rgb()/rgba()（含空格分隔与 / alpha 写法）；无法解析返回 null */
export declare function parseColor(value: string): Rgba | null;

/** Porter-Duff source-over 合成，layers 由内到外 */
export declare function compositeLayers(layers: readonly (Rgba | null)[]): Rgba;

/** 逐层合成后以不透明白兜底 */
export declare function effectiveBackground(
  layers: readonly (Rgba | null)[]
): Rgb;

/** 半透明前景先合成到不透明背景上 */
export declare function effectiveForeground(
  foreground: Rgba | null,
  background: Rgb
): Rgb | null;

/** WCAG 2.1 相对亮度 */
export declare function relativeLuminance(color: Rgb): number;

/** WCAG 2.1 对比度，范围 1 - 21 */
export declare function contrastRatio(a: Rgb, b: Rgb): number;

/** 简单 RGB 欧氏距离 */
export declare function colorDistance(a: Rgb | null, b: Rgb | null): number;

export declare function formatRgb(color: Rgb): string;
