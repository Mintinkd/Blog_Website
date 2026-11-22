import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 平板滚动「UI 丢失」回归守卫（Android Chrome）。
 *
 * 现场：平板上反复上下滑动首页，文章卡片（或某个区块）整片空白，继续滑动又恢复。
 * 机制：入场动画元素常驻 `will-change: opacity, transform` 会把每张卡片永久提升为
 * 独立合成层；再叠加固定背景层每帧位移（视差）与大面积毛玻璃，平板的 GPU 瓦片预算
 * 吃紧时被丢弃，表现为「整片空白」，重新栅格化后又出现。
 *
 * 约束：常驻图层提升（will-change）只允许出现在 fine pointer（鼠标）设备上；
 * 触屏设备不启用视差；reveal 元素在动画被丢弃时也必须可见（fail-open）。
 *
 * 这里锁的是机制契约（CSS / 模块源码），视觉现象本身需真机复核——
 * 桌面 Chromium 复现不出 GPU 瓦片丢弃，`scripts` 侧的手动探针只覆盖 DOM 层。
 */

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

/** 粗略按大括号分层，返回 index 处由外到内的 at-rule / 选择器链。 */
function enclosingBlocks(css: string, index: number): string[] {
  const stack: string[] = [];
  for (let i = 0; i < index; i++) {
    if (css[i] === "{") {
      let j = i - 1;
      while (j >= 0 && css[j] !== "}" && css[j] !== "{" && css[j] !== ";") j--;
      stack.push(css.slice(j + 1, i).trim());
    } else if (css[i] === "}") {
      stack.pop();
    }
  }
  return stack;
}

function willChangeDeclarations(
  css: string
): Array<{ index: number; value: string; blocks: string[] }> {
  const out: Array<{ index: number; value: string; blocks: string[] }> = [];
  const re = /will-change\s*:\s*([^;}]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    out.push({
      index: match.index,
      value: match[1].trim(),
      blocks: enclosingBlocks(css, match.index),
    });
  }
  return out;
}

/** 取出某个选择器的声明块（选择器须精确匹配，避免命中 .is-revealed 变体）。 */
function ruleBody(css: string, selectorPattern: RegExp): string {
  return css.match(selectorPattern)?.[1] ?? "";
}

describe("常驻合成层预算（平板滚动 UI 丢失）", () => {
  it("motion.css：所有 will-change 都限定在鼠标设备（fine pointer）", () => {
    const css = read("src/styles/motion.css");
    const decls = willChangeDeclarations(css).filter(
      (d) => !/^(auto|none)\b/i.test(d.value)
    );
    for (const decl of decls) {
      expect(
        decl.blocks.join(" > "),
        `will-change: ${decl.value} 出现在非鼠标设备也会命中的作用域：${decl.blocks.join(" > ")}`
      ).toMatch(/\(pointer:\s*fine\)/);
    }
  });

  it("motion.css：[data-reveal] 初始态不得常驻提升图层", () => {
    const css = read("src/styles/motion.css");
    const body = ruleBody(css, /(?:^|\n)\[data-reveal\]\s*\{([^}]*)\}/);
    expect(body, "未找到 [data-reveal] 基础规则").not.toBe("");
    expect(body).not.toContain("will-change");
    expect(body).toMatch(/opacity:\s*0\b/);
  });

  it("motion.css：已入场的 reveal 元素有非动画的可见兜底（动画被丢弃也不空白）", () => {
    const css = read("src/styles/motion.css");
    const body = ruleBody(css, /\[data-reveal\]\.is-revealed\s*\{([^}]*)\}/);
    expect(body, "缺少 [data-reveal].is-revealed 的静态可见兜底").toMatch(
      /opacity:\s*1\b/
    );
  });

  it("motion.ts：触屏设备不启用视差（避免全屏模糊层每帧位移）", () => {
    const ts = read("src/utils/motion.ts");
    expect(ts).toContain("pointer: coarse");
    const parallax =
      ts.match(/export function initParallax[\s\S]*?\n\}/)?.[0] ?? "";
    expect(parallax).not.toBe("");
    expect(parallax).toMatch(/isCoarsePointer\(\)/);
  });

  it("index.astro：首页装饰层的 will-change 只给鼠标设备", () => {
    const astro = read("src/pages/index.astro");
    const decls = willChangeDeclarations(astro).filter(
      (d) => !/^(auto|none)\b/i.test(d.value)
    );
    expect(decls.length).toBeGreaterThan(0);
    for (const decl of decls) {
      expect(
        decl.blocks.join(" > "),
        `首页 will-change: ${decl.value} 未限定鼠标设备：${decl.blocks.join(" > ")}`
      ).toMatch(/\(pointer:\s*fine\)/);
    }
  });
});
