/**
 * 观感友好度检查共用的颜色数学：零依赖、可单测。
 *
 * 浏览器 computed style 返回的是 rgb()/rgba() 字符串，且元素背景常常是
 * 多层半透明叠加（例如 --color-accent-subtle 叠在 --color-bg-secondary 上）。
 * 这里把「从元素到根」的背景层合成为不透明色，再按 WCAG 2.1 计算对比度，
 * 保证检查脚本不会因为漏算祖先背景而误判。
 *
 * 本模块只做数值计算，不触碰 DOM，供 scripts/verify-visual-friendliness.mjs
 * 与 tests/visual-contrast.test.ts 共用，避免对比度口径出现第二份实现。
 */

/** 解析 rgb(29, 29, 31) / rgba(73, 177, 245, 0.08) / rgb(29 29 31 / 0.5) */
export function parseColor(value) {
  if (typeof value !== "string") return null;
  const match = value
    .trim()
    .match(
      /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i
    );
  if (!match) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/**
 * Porter-Duff "source over" 逐层合成。
 * @param {{r:number,g:number,b:number,a:number}[]} layers 由内到外（最外层应不透明）
 * @returns {{r:number,g:number,b:number,a:number}} 0-255 通道，a 为累计不透明度
 */
export function compositeLayers(layers) {
  let out = { r: 0, g: 0, b: 0, a: 0 };
  // 由最外层（底）向最内层（顶）叠加
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (!layer) continue;
    const a = clamp01(layer.a);
    if (a === 0) continue;
    const outA = a + out.a * (1 - a);
    out = {
      r: (layer.r * a + out.r * out.a * (1 - a)) / outA,
      g: (layer.g * a + out.g * out.a * (1 - a)) / outA,
      b: (layer.b * a + out.b * out.a * (1 - a)) / outA,
      a: outA,
    };
  }
  return {
    r: Math.round(out.r),
    g: Math.round(out.g),
    b: Math.round(out.b),
    a: out.a,
  };
}

/** 有效背景色：逐层合成后以不透明白兜底，保证返回可比较的不透明 RGB */
export function effectiveBackground(layers) {
  const withFallback = [...layers, { r: 255, g: 255, b: 255, a: 1 }];
  const { r, g, b } = compositeLayers(withFallback);
  return { r, g, b };
}

/** 半透明前景（如带 alpha 的文字色）先合成到不透明背景上 */
export function effectiveForeground(foreground, background) {
  if (!foreground) return null;
  if (foreground.a >= 1) {
    return { r: foreground.r, g: foreground.g, b: foreground.b };
  }
  const { r, g, b } = compositeLayers([foreground, { ...background, a: 1 }]);
  return { r, g, b };
}

/** WCAG 2.1 相对亮度 */
export function relativeLuminance({ r, g, b }) {
  const linear = (channel) => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2.1 对比度，范围 1 - 21 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** 简单 RGB 欧氏距离，用于判断「选中态与未选中态是否足够不同」 */
export function colorDistance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

export function formatRgb({ r, g, b }) {
  return `rgb(${r}, ${g}, ${b})`;
}
