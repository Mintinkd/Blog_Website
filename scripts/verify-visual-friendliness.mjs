/**
 * 页面观感友好度检查（Playwright 浏览器实测）。
 *
 * 功能回归回答「点了会发生什么」；本脚本量「画出来好不好看」：在真实渲染
 * 结果上读取 computed style 与几何盒模型，把标题与描述连读、留白不足、
 * 选中态难辨、文本裁切、对比度不足、触控目标过小、键盘焦点不可见、
 * 横向溢出等常见观感问题，转成带「规则 ID / 场景 / 元素 / 实测值 /
 * 期望值 / 源码定位」的可定位断言。
 *
 * 用法（需先启动 dev server）：
 *   npx astro dev --port 4321
 *   node scripts/verify-visual-friendliness.mjs
 *   npm run verify:visual                       # 等价入口
 *   # Windows 用系统 Edge：PW_CHANNEL=msedge node scripts/verify-visual-friendliness.mjs
 *   # 自定义地址：BASE=http://localhost:4321 node ...
 *   # 机器可读报告：VISUAL_REPORT_JSON=/tmp/visual.json node ...
 *   # 各场景弹窗截图：VISUAL_SHOT_DIR=/tmp/visual-shots node ...
 *
 * 退出码：0 = 通过；1 = 存在观感问题；2 = 环境/脚本异常。
 * 扩展检查范围：往 TARGETS 加一条 target（parts 指向同类元素即可复用全部规则）。
 * T6 #67：另设 EDITOR_TARGETS / EDITOR_VIEWPORTS，专测文章编辑器元信息面板
 * （280 / 375 / 1280 × light / dark 的文本对比度、裁切、触控目标、焦点环、
 * 横向溢出与控制台），因为元信息面板没有卡片式 radio 结构，不能复用
 * TARGETS 那套 parts 引擎；两者共用 RULES 编号与对比度工具。
 * T7 #68：核对票面四类编辑器目标——工具栏（.editor-toolbar / .preview-toggle
 * button）、元信息（.editor-meta-panel）、弹窗（.article-editor-overlay 全屏壳
 * 与 TARGETS[0] 的 .link-dialog）、选中态（.toggle-btn.active 与
 * .link-mode-option.active）——已由 TARGETS[0] + EDITOR_TARGETS[0] 的现有采集
 * 与 RULES 编号覆盖；仅把模式切换按钮补进 EDITOR 采集并加一条 VF-07 断言，
 * 不新增 target 条目、不复制规则引擎。api fixture 走共享 editor-meta-fixture。
 * 所有 /api/v1/** 由本地 fixture 返回，不依赖真实 Worker 与账号。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  parseColor,
  contrastRatio,
  colorDistance,
  effectiveBackground,
  effectiveForeground,
  formatRgb,
} from "./visual-contrast.mjs";
import {
  EDITOR_ENTRY_SELECTOR,
  EDITOR_VIEWPORTS,
  fixtureFor,
} from "./editor-meta-fixture.mjs";

const BASE = process.env.BASE || "http://localhost:4321";
const CHANNEL = process.env.PW_CHANNEL;
const REPORT_JSON = process.env.VISUAL_REPORT_JSON;
const SHOT_DIR = process.env.VISUAL_SHOT_DIR;

/* ===== 阈值：单一事实源，报告里的「期望」直接引用这些常量 ===== */
const MIN_TEXT_CONTRAST = 4.5; // WCAG 2.1 AA 正文
const MIN_GRAPHIC_CONTRAST = 3; // WCAG 2.1 AA 非文本图形
const MIN_PADDING = 12;
const MIN_GAP = 8;
const MIN_TOUCH_TARGET = 44;
const MIN_STATE_DELTA = 0.9;
const MIN_BORDER_DELTA = 30;
const MIN_BG_DELTA = 8;
const EPS = 1; // 亚像素 / 边框舍入容差

const VIEWPORTS = [
  { name: "375px", width: 375, height: 812 },
  { name: "1280px", width: 1280, height: 800 },
];
const THEMES = ["light", "dark"];

/** 规则元数据：source 指向实现位置，报告里每条问题都能顺着它改代码 */
const RULES = {
  "VF-01": {
    name: "文本对比度",
    source: ".link-mode-name / .link-mode-desc / 分组标签的 color",
  },
  "VF-02": {
    name: "图标图形对比度",
    source: ".link-mode-icon 的 color 与 background",
  },
  "VF-03": {
    name: "未选中指示器对比度",
    source: ".link-mode-indicator 的 border-color",
  },
  "VF-04": {
    name: "文案分行且元素不重叠",
    source: ".link-mode-option 的 grid-template-columns / .link-mode-copy",
  },
  "VF-05": {
    name: "卡片内边距",
    source: ".link-mode-option 的 padding",
  },
  "VF-06": {
    name: "选项间距",
    source: ".link-mode-options 的 gap",
  },
  "VF-07": {
    name: "选中态多通道可辨识",
    source: ".link-mode-option.active / ::before / .link-mode-indicator::after",
  },
  "VF-08": {
    name: "文本无裁切",
    source: ".link-mode-copy / .link-mode-name / .link-mode-desc 的宽度约束",
  },
  "VF-09": {
    name: "触控目标高度",
    source: ".link-mode-option 的 min-height / padding",
  },
  "VF-10": {
    name: "键盘焦点可见",
    source: ".link-mode-option:has(.link-mode-input:focus-visible) 的 outline",
  },
  "VF-11": {
    name: "无横向溢出",
    source: ".link-dialog / .link-mode-options / .link-mode-option 宽度",
  },
  "VF-12": {
    name: "选中态与 radio 状态同步",
    source: ".link-mode-option 的 :class active 绑定与 v-model",
  },
  "VF-13": {
    name: "控制台无报错",
    source: "页面脚本 / 组件挂载",
  },
};

/**
 * 可扩展的检查目标清单。
 * 每条 target 只需给出作用域、选项选择器、各部件选择器与「如何打开页面」，
 * 规则引擎对任意同类结构复用；当前默认只盯插入链接弹窗，避免存量页面误报。
 */
const TARGETS = [
  {
    id: "link-dialog",
    name: "插入链接弹窗 · 预览方式",
    scope: ".link-mode-options",
    dialog: ".link-dialog",
    option: ".link-mode-option",
    focusStart: ".link-dialog .form-group input",
    parts: {
      icon: ".link-mode-icon",
      copy: ".link-mode-copy",
      name: ".link-mode-name",
      desc: ".link-mode-desc",
      indicator: ".link-mode-indicator",
      input: "input.link-mode-input",
    },
    source: "src/admin/App.vue（<style scoped> 内 .link-mode-* 规则）",
    async prepare(page) {
      await page.goto(`${BASE}/admin`, { waitUntil: "load" });
      await page.waitForSelector(".admin-layout", { timeout: 15000 });
      await page
        .locator(".btn-primary")
        .filter({ hasText: "新建文章" })
        .first()
        .click();
      await page.waitForSelector(".article-editor-overlay", { timeout: 10000 });
      await page.locator(".editor-toolbar .toolbar-btn").first().click();
      await page.waitForSelector(".link-mode-options", { timeout: 10000 });
    },
  },
];

/* ===== 浏览器侧采集：只取原始量，判定全部留在 Node 侧 =====
 * 该函数被 page.evaluate 序列化，不能引用外部闭包，只能用 config 参数。 */
function collectSnapshot(config) {
  const { scope, dialog, option, parts } = config;
  const root = document.querySelector(scope);
  if (!root) return null;

  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    };
  };
  const backgroundLayers = (el) => {
    const layers = [];
    let node = el;
    while (node) {
      layers.push(getComputedStyle(node).backgroundColor);
      node = node.parentElement;
    }
    layers.push("rgb(255, 255, 255)"); // 不透明白兜底
    return layers;
  };
  const overflow = (el) => ({
    sw: el.scrollWidth,
    cw: el.clientWidth,
    sh: el.scrollHeight,
    ch: el.clientHeight,
  });
  const textInfo = (el) => {
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      rect: rect(el),
      color: style.color,
      layers: backgroundLayers(el),
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      text: (el.textContent || "").trim(),
      overflow: overflow(el),
    };
  };
  const box = (el) => (el ? { rect: rect(el), overflow: overflow(el) } : null);

  const groupLabel = root.parentElement
    ? root.parentElement.querySelector(":scope > label")
    : null;

  const options = [...root.querySelectorAll(option)].map((el, index) => {
    const style = getComputedStyle(el);
    const icon = el.querySelector(parts.icon);
    const iconStyle = icon ? getComputedStyle(icon) : null;
    const indicator = el.querySelector(parts.indicator);
    const indicatorStyle = indicator ? getComputedStyle(indicator) : null;
    const dotStyle = indicator ? getComputedStyle(indicator, "::after") : null;

    return {
      index,
      selector: `${option}:nth-child(${index + 1})`,
      active: el.classList.contains("active"),
      checked: el.querySelector(parts.input)?.checked ?? null,
      rect: rect(el),
      overflow: overflow(el),
      borderColor: style.borderTopColor,
      layers: backgroundLayers(el),
      barOpacity: Number(getComputedStyle(el, "::before").opacity),
      parts: {
        icon: icon
          ? {
              rect: rect(icon),
              color: iconStyle.color,
              layers: backgroundLayers(icon),
              overflow: overflow(icon),
              hasSvg: !!icon.querySelector("svg"),
            }
          : null,
        copy: rect(el.querySelector(parts.copy)),
        name: textInfo(el.querySelector(parts.name)),
        desc: textInfo(el.querySelector(parts.desc)),
        indicator: indicator
          ? {
              rect: rect(indicator),
              borderColor: indicatorStyle.borderTopColor,
              layers: backgroundLayers(indicator),
              dotOpacity: Number(dotStyle.opacity),
              dotColor: dotStyle.backgroundColor,
            }
          : null,
      },
    };
  });

  return {
    page: {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    },
    scope: box(root),
    dialog: box(dialog ? document.querySelector(dialog) : null),
    groupLabel: textInfo(groupLabel),
    options,
  };
}

/* ===== Node 侧判定 ===== */
const backgroundOf = (layers) =>
  effectiveBackground(layers.map(parseColor).filter(Boolean));
const foregroundOf = (color, background) =>
  effectiveForeground(parseColor(color), background);
const ratioOf = (color, layers) => {
  const background = backgroundOf(layers);
  const foreground = foregroundOf(color, background);
  return foreground ? contrastRatio(foreground, background) : null;
};

function makeChecker(ctx, target, scene) {
  return (ruleId, element, pass, actual, expected) => {
    ctx.assertions += 1;
    if (pass) return;
    ctx.problems.push({
      ruleId,
      rule: RULES[ruleId].name,
      scene,
      element,
      actual: String(actual),
      expected: String(expected),
      source: `${target.source} → ${RULES[ruleId].source}`,
    });
  };
}

function checkContrast(check, ruleId, element, info, minimum, note) {
  if (!info) {
    check(ruleId, element, false, "元素缺失", "元素存在且可读");
    return;
  }
  const background = backgroundOf(info.layers);
  const ratio = ratioOf(info.color, info.layers);
  check(
    ruleId,
    element,
    ratio !== null && ratio >= minimum,
    `${ratio === null ? "无法解析" : `${ratio.toFixed(2)}:1`}（前景 ${info.color} / 背景 ${formatRgb(background)}）`,
    `≥ ${minimum}:1（${note}）`
  );
}

function checkOverflow(check, ruleId, element, box) {
  if (!box) {
    check(ruleId, element, false, "元素缺失", "元素存在");
    return;
  }
  const { sw, cw, sh, ch } = box.overflow;
  check(
    ruleId,
    element,
    sw <= cw + EPS && sh <= ch + EPS,
    `scroll ${sw}×${sh} / client ${cw}×${ch}`,
    `scroll ≤ client + ${EPS}（无裁切）`
  );
}

function runRules(snapshot, target, scene, ctx) {
  const check = makeChecker(ctx, target, scene);
  if (!snapshot) {
    check("VF-04", target.scope, false, "作用域不存在", "作用域可渲染");
    return;
  }

  const { options } = snapshot;
  check(
    "VF-04",
    target.scope,
    options.length >= 2,
    `${options.length} 个选项`,
    "≥ 2 个可比较的选项"
  );

  // VF-01 文本对比度：分组标签 + 每个选项的标题与描述
  checkContrast(
    check,
    "VF-01",
    `${target.scope} 上级 label（预览方式）`,
    snapshot.groupLabel,
    MIN_TEXT_CONTRAST,
    "WCAG 2.1 AA 正文"
  );

  // VF-06 选项间距
  const gap =
    options.length >= 2 ? options[1].rect.top - options[0].rect.bottom : null;
  check(
    "VF-06",
    `${target.scope} 相邻选项`,
    gap !== null && gap >= MIN_GAP - EPS,
    gap === null ? "选项不足" : `${gap.toFixed(1)}px`,
    `≥ ${MIN_GAP}px`
  );

  // VF-11 页面 / 弹窗 / 选项组 / 卡片无横向溢出
  checkOverflow(check, "VF-11", "document.documentElement", {
    overflow: { sw: snapshot.page.sw, cw: snapshot.page.cw, sh: 0, ch: 0 },
  });
  for (const [label, box] of [
    [target.dialog, snapshot.dialog],
    [target.scope, snapshot.scope],
  ]) {
    checkOverflow(check, "VF-11", label, box);
  }

  for (const option of options) {
    const at = option.selector;
    const { parts } = option;

    // VF-01 文案
    checkContrast(
      check,
      "VF-01",
      `${at} ${target.parts.name}`,
      parts.name,
      MIN_TEXT_CONTRAST,
      "WCAG 2.1 AA 正文"
    );
    checkContrast(
      check,
      "VF-01",
      `${at} ${target.parts.desc}`,
      parts.desc,
      MIN_TEXT_CONTRAST,
      "WCAG 2.1 AA 正文"
    );

    // VF-02 图标图形对比度（描边用 currentColor）
    if (!parts.icon) {
      check(
        "VF-02",
        `${at} ${target.parts.icon}`,
        false,
        "元素缺失",
        "存在图标"
      );
    } else {
      check(
        "VF-02",
        `${at} ${target.parts.icon}`,
        parts.icon.hasSvg,
        parts.icon.hasSvg ? "含 SVG 图形" : "无 SVG 图形",
        "含 SVG 图形"
      );
      checkContrast(
        check,
        "VF-02",
        `${at} ${target.parts.icon}`,
        { color: parts.icon.color, layers: parts.icon.layers },
        MIN_GRAPHIC_CONTRAST,
        "WCAG 2.1 AA 非文本图形"
      );
    }

    // VF-03 未选中指示器的边框必须能从卡片底色上辨认出来；
    // 选中态由 VF-07 的「状态差异」覆盖，避免重复用绝对对比度卡住设计系统。
    if (!parts.indicator) {
      check(
        "VF-03",
        `${at} ${target.parts.indicator}`,
        false,
        "元素缺失",
        "存在指示器"
      );
    } else if (!option.active) {
      checkContrast(
        check,
        "VF-03",
        `${at} ${target.parts.indicator} border`,
        {
          color: parts.indicator.borderColor,
          layers: option.layers,
        },
        MIN_GRAPHIC_CONTRAST,
        "WCAG 2.1 AA 非文本图形（未选中态）"
      );
    }

    // VF-04 图标 / 两行文案 / 指示器分行且不重叠
    if (
      !parts.name ||
      !parts.desc ||
      !parts.copy ||
      !parts.icon ||
      !parts.indicator
    ) {
      check("VF-04", at, false, "部件缺失", "图标 / 文案 / 指示器齐全");
    } else {
      check(
        "VF-04",
        `${at} 标题 → 描述`,
        parts.name.rect.bottom <= parts.desc.rect.top + EPS,
        `标题 bottom=${parts.name.rect.bottom.toFixed(1)} / 描述 top=${parts.desc.rect.top.toFixed(1)}`,
        "标题与描述各占一行（不连读、不重叠）"
      );
      check(
        "VF-04",
        `${at} 图标 → 文案 → 指示器`,
        parts.icon.rect.right <= parts.copy.left + EPS &&
          parts.copy.right <= parts.indicator.rect.left + EPS,
        `icon.right=${parts.icon.rect.right.toFixed(1)} / copy=${parts.copy.left.toFixed(1)}~${parts.copy.right.toFixed(1)} / indicator.left=${parts.indicator.rect.left.toFixed(1)}`,
        "三栏从左到右互不重叠"
      );
      const inside =
        parts.icon.rect.left >= option.rect.left - EPS &&
        parts.indicator.rect.right <= option.rect.right + EPS &&
        parts.name.rect.top >= option.rect.top - EPS &&
        parts.desc.rect.bottom <= option.rect.bottom + EPS;
      check(
        "VF-04",
        `${at} 内容边界`,
        inside,
        `卡片 ${option.rect.left.toFixed(1)}~${option.rect.right.toFixed(1)} / ${option.rect.top.toFixed(1)}~${option.rect.bottom.toFixed(1)}`,
        "所有部件落在卡片内"
      );
    }

    // VF-05 四边内边距
    if (parts.icon && parts.indicator && parts.name && parts.desc) {
      const paddings = {
        left: parts.icon.rect.left - option.rect.left,
        right: option.rect.right - parts.indicator.rect.right,
        top:
          Math.min(parts.icon.rect.top, parts.name.rect.top) - option.rect.top,
        bottom:
          option.rect.bottom -
          Math.max(parts.icon.rect.bottom, parts.desc.rect.bottom),
      };
      for (const [side, value] of Object.entries(paddings)) {
        check(
          "VF-05",
          `${at} padding-${side}`,
          value >= MIN_PADDING - EPS,
          `${value.toFixed(1)}px`,
          `≥ ${MIN_PADDING}px`
        );
      }
    }

    // VF-08 文本无裁切
    for (const [label, info] of [
      [target.parts.name, parts.name],
      [target.parts.desc, parts.desc],
    ]) {
      checkOverflow(check, "VF-08", `${at} ${label}`, info);
    }

    // VF-09 触控目标
    check(
      "VF-09",
      at,
      option.rect.height >= MIN_TOUCH_TARGET - EPS,
      `${option.rect.height.toFixed(1)}px`,
      `≥ ${MIN_TOUCH_TARGET}px`
    );

    // VF-11 卡片自身无横向溢出
    checkOverflow(check, "VF-11", at, option);
  }

  // VF-07 选中态：边框 / 背景 / 圆点 / 强调条四通道都要有差异，
  // 单靠一个浅底色很容易在暗色主题或高亮屏上看不出来。
  const active = options.find((item) => item.active);
  const inactive = options.find((item) => !item.active);
  if (!active || !inactive) {
    check(
      "VF-07",
      target.scope,
      false,
      `active=${options.filter((o) => o.active).length} / inactive=${options.filter((o) => !o.active).length}`,
      "恰好一个选中项 + 至少一个未选中项"
    );
  } else {
    const borderDelta = colorDistance(
      parseColor(active.borderColor),
      parseColor(inactive.borderColor)
    );
    check(
      "VF-07",
      `${target.option} border-color`,
      borderDelta >= MIN_BORDER_DELTA,
      `${borderDelta.toFixed(1)}（${inactive.borderColor} → ${active.borderColor}）`,
      `色距 ≥ ${MIN_BORDER_DELTA}`
    );

    const bgDelta = colorDistance(
      backgroundOf(active.layers),
      backgroundOf(inactive.layers)
    );
    check(
      "VF-07",
      `${target.option} background`,
      bgDelta >= MIN_BG_DELTA,
      `${bgDelta.toFixed(1)}（${formatRgb(backgroundOf(inactive.layers))} → ${formatRgb(backgroundOf(active.layers))}）`,
      `色距 ≥ ${MIN_BG_DELTA}`
    );

    const dotDelta = Math.abs(
      (active.parts.indicator?.dotOpacity ?? 0) -
        (inactive.parts.indicator?.dotOpacity ?? 0)
    );
    check(
      "VF-07",
      `${target.parts.indicator}::after`,
      dotDelta >= MIN_STATE_DELTA,
      `选中 ${active.parts.indicator?.dotOpacity} / 未选中 ${inactive.parts.indicator?.dotOpacity}`,
      `圆点透明度差 ≥ ${MIN_STATE_DELTA}`
    );

    const barDelta = Math.abs(active.barOpacity - inactive.barOpacity);
    check(
      "VF-07",
      `${target.option}::before`,
      barDelta >= MIN_STATE_DELTA,
      `选中 ${active.barOpacity} / 未选中 ${inactive.barOpacity}`,
      `强调条透明度差 ≥ ${MIN_STATE_DELTA}`
    );
  }
}

async function settle(page) {
  // 鼠标移出卡片，避免 :hover 把未选中态的边框/底色带进测量结果。
  await page.mouse.move(2, 2);
  // context 用 reducedMotion: reduce，transition 已退化为瞬时；两帧确保样式提交。
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
}

async function snapshot(page, target) {
  return page.evaluate(collectSnapshot, {
    scope: target.scope,
    dialog: target.dialog,
    option: target.option,
    parts: target.parts,
  });
}

async function checkKeyboard(page, target, scene, ctx) {
  const check = makeChecker(ctx, target, scene);
  // 从弹窗第一个输入框起，用真实 Tab 走到 radio：程序性 focus() 不保证
  // 命中 :focus-visible，键盘事件才会触发「仅键盘可见」的焦点环。
  await page.locator(target.focusStart).first().focus();
  let reached = false;
  for (let step = 0; step < 4; step += 1) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(
      (selector) => !!document.activeElement?.matches(selector),
      target.parts.input
    );
    if (reached) break;
  }
  const ring = reached
    ? await page.evaluate((optionSelector) => {
        const input = document.activeElement;
        const option = input?.closest(optionSelector);
        if (!option) return null;
        const style = getComputedStyle(option);
        return {
          focusVisible: input.matches(":focus-visible"),
          outlineStyle: style.outlineStyle,
          outlineWidth: parseFloat(style.outlineWidth) || 0,
        };
      }, target.option)
    : null;

  check(
    "VF-10",
    target.parts.input,
    reached,
    reached ? "Tab 可聚焦到 radio" : "Tab 4 次内未聚焦到 radio",
    "Tab 可聚焦到 radio（原生语义保留）"
  );
  check(
    "VF-10",
    `${target.option} 焦点环`,
    !!ring &&
      ring.focusVisible &&
      ring.outlineStyle !== "none" &&
      ring.outlineWidth >= 2,
    ring
      ? `focus-visible=${ring.focusVisible} / outline=${ring.outlineStyle} ${ring.outlineWidth}px`
      : "未取得焦点",
    "focus-visible 命中且 outline ≥ 2px"
  );
}

async function checkStateSync(page, target, scene, ctx) {
  const check = makeChecker(ctx, target, scene);
  const readState = () =>
    page.evaluate(
      (config) =>
        [...document.querySelectorAll(config.option)].map((el) => ({
          active: el.classList.contains("active"),
          checked: el.querySelector(config.parts.input)?.checked ?? null,
        })),
      { option: target.option, parts: target.parts }
    );

  const options = page.locator(target.option);
  for (const index of [0, 1]) {
    await options.nth(index).click();
    const states = await readState();
    const exactlyOne =
      states.length === 2 &&
      states[index].active &&
      states[index].checked === true &&
      states.every(
        (state, i) =>
          state.active === (i === index) && state.checked === (i === index)
      );
    check(
      "VF-12",
      `点击 ${target.option}:nth-child(${index + 1}) 后`,
      exactlyOne,
      JSON.stringify(states),
      "仅被点击项 active + checked，另一项两者皆 false"
    );
  }
}

function checkConsole(errors, target, scene, ctx) {
  const check = makeChecker(ctx, target, scene);
  check(
    "VF-13",
    "页面控制台",
    errors.length === 0,
    errors.length ? `${errors.length} 条：${errors.join(" | ")}` : "0 条错误",
    "0 条 pageerror / console.error"
  );
}

async function openScene(browser, target, viewport, theme) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    locale: "zh-CN",
    colorScheme: theme,
    hasTouch: viewport.width < 768,
    // 动效退化为瞬时，测量结果不受 transition 中间态干扰
    reducedMotion: "reduce",
  });
  await context.addInitScript((activeTheme) => {
    try {
      localStorage.setItem("locale", "zh");
      localStorage.setItem("theme", activeTheme);
      localStorage.setItem("admin_token", "regression-token");
      localStorage.setItem("admin_role", "admin");
      localStorage.setItem("admin_user_id", "1");
    } catch {
      // about:blank 等非 http 文档没有 localStorage
    }
  }, theme);
  await context.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fixtureFor(url.pathname)),
    });
  });

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  // T6 #67：编辑器目标需要按视口决定「是否先展开元信息抽屉」。
  await target.prepare(page, viewport, theme);
  return { context, page, errors };
}

/* ===== T6 #67：文章编辑器元信息面板目标 =====
   与卡片式 link-dialog 结构不同，这里单独采集并在 Node 侧判定，复用
   RULES 的 VF-01 / VF-08 / VF-09 / VF-10 / VF-11 / VF-13 编号与阈值。 */
const EDITOR_RULE_SOURCE = {
  "VF-01":
    "src/admin/admin-shared.css → .meta-hint / .form-group label / .tag-chip 的 color",
  "VF-04": "src/admin/admin-shared.css → .editor-meta-panel",
  "VF-07":
    "src/admin/admin-shared.css → .preview-toggle .toggle-btn.active 的 background",
  "VF-08":
    "src/admin/admin-shared.css → .meta-inline-row / .meta-cover-placeholder 宽度",
  "VF-09": "src/admin/admin-shared.css → 触控目标 ≥44px 规则块",
  "VF-10": "src/admin/admin-shared.css → :focus-visible 焦点环规则块",
  "VF-11":
    "src/admin/admin-shared.css → .editor-body / .editor-meta-panel 宽度",
  "VF-13": "页面脚本 / 组件挂载",
};

const EDITOR_TARGETS = [
  {
    id: "editor-meta",
    name: "文章编辑器 · 元信息面板",
    source:
      "src/admin/editor/EditorMetaFields.vue + src/admin/admin-shared.css",
    async prepare(page, viewport) {
      await page.goto(`${BASE}/admin`, { waitUntil: "load" });
      await page.waitForSelector(".admin-layout", { timeout: 15000 });
      // EDITOR_ENTRY_SELECTOR 与文案无关，中英文 locale 下都能稳定定位。
      await page.locator(EDITOR_ENTRY_SELECTOR).click();
      await page.waitForSelector(".article-editor-overlay", { timeout: 10000 });
      if (viewport.width <= 767) {
        // 窄屏元信息默认折叠，先展开抽屉，#meta-title 才会变为可见。
        await page.locator(".meta-drawer-toggle").click();
        await page.waitForSelector(".editor-meta-panel.open", {
          timeout: 5000,
        });
      }
      await page.waitForSelector("#meta-title", { timeout: 10000 });
    },
  },
];

function makeEditorChecker(ctx, target, scene) {
  return (ruleId, element, pass, actual, expected) => {
    ctx.assertions += 1;
    if (pass) return;
    ctx.problems.push({
      ruleId,
      rule: RULES[ruleId].name,
      scene,
      element,
      actual: String(actual),
      expected: String(expected),
      source: `${target.source} → ${EDITOR_RULE_SOURCE[ruleId]}`,
    });
  };
}

/** 只查横向：documentElement / 滚动容器的 scrollHeight 天然大于 clientHeight。 */
function checkHorizontalOverflow(check, element, box) {
  if (!box) {
    check("VF-11", element, false, "元素缺失", "元素存在");
    return;
  }
  const { sw, cw } = box;
  check(
    "VF-11",
    element,
    sw <= cw + EPS,
    `scrollWidth ${sw} / clientWidth ${cw}`,
    `scrollWidth ≤ clientWidth + ${EPS}（无横向溢出）`
  );
}

async function collectEditorSnapshot(page) {
  // page.evaluate 内不能引用外部闭包，常量与辅助函数全部内联。
  return page.evaluate(() => {
    const panel = document.querySelector(".editor-meta-panel");
    if (!panel) return null;
    const layersOf = (el) => {
      const out = [];
      let node = el;
      while (node) {
        out.push(getComputedStyle(node).backgroundColor);
        node = node.parentElement;
      }
      out.push("rgb(255, 255, 255)");
      return out;
    };
    const info = (el, selector, index) => {
      const style = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        selector: `${selector}[${index}]`,
        color: style.color,
        layers: layersOf(el),
        rect: { width: r.width, height: r.height },
        overflow: {
          sw: el.scrollWidth,
          cw: el.clientWidth,
          sh: el.scrollHeight,
          ch: el.clientHeight,
        },
        text: (el.textContent || "").trim(),
      };
    };
    // 隐藏元素（宽屏的抽屉开关 / 抽屉头、窄屏的分屏入口）不参与量测：
    // 它们的 rect 全为 0，混进来会产生假的对比度 / 触控目标失败。
    const all = (selector) =>
      [...document.querySelectorAll(selector)]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })
        .map((el, i) => info(el, selector, i));
    const overflowTargets = [
      ["html", document.documentElement],
      [
        ".article-editor-overlay",
        document.querySelector(".article-editor-overlay"),
      ],
      [".editor-body", document.querySelector(".editor-body")],
      [".editor-meta-panel", panel],
    ]
      .filter(([, el]) => el)
      .map(([name, el]) => ({
        selector: name,
        overflow: {
          sw: el.scrollWidth,
          cw: el.clientWidth,
          sh: el.scrollHeight,
          ch: el.clientHeight,
        },
      }));

    return {
      labels: all(".editor-meta-panel .form-group label"),
      hints: all(
        ".editor-meta-panel .meta-hint, .editor-meta-panel .meta-stats, .editor-meta-panel .meta-cover-placeholder"
      ),
      inputs: all(
        ".editor-meta-panel input, .editor-meta-panel select, .editor-meta-panel textarea"
      ),
      chips: all(".editor-meta-panel .tag-chip"),
      buttons: all(
        ".editor-meta-panel button, .meta-drawer-toggle, " +
          ".article-editor-overlay .editor-header button, " +
          ".article-editor-overlay .editor-footer button, " +
          ".article-editor-overlay .editor-toolbar button, " +
          // T7 #68：模式切换按钮同属工具栏，纳入触控目标（VF-09）量测。
          ".article-editor-overlay .preview-toggle .toggle-btn"
      ),
      // T7 #68「选中态」目标：采集模式切换按钮的 active / 未选中态，
      // 由 VF-07 在 Node 侧比对底色差异，复用现有采集函数与规则编号。
      toggles: [
        ...document.querySelectorAll(".preview-toggle .toggle-btn"),
      ].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          active: el.classList.contains("active"),
          visible: r.width > 0 && r.height > 0,
          layers: layersOf(el),
        };
      }),
      overflowTargets,
    };
  });
}

function runEditorRules(snap, target, scene, ctx) {
  const check = makeEditorChecker(ctx, target, scene);
  if (!snap) {
    check("VF-04", ".editor-meta-panel", false, "作用域不存在", "作用域可渲染");
    return;
  }

  const textItems = [
    ...snap.labels,
    ...snap.hints,
    ...snap.chips,
    ...snap.inputs,
  ];
  for (const item of textItems) {
    checkContrast(
      check,
      "VF-01",
      item.selector,
      item,
      MIN_TEXT_CONTRAST,
      "WCAG 2.1 AA 正文"
    );
    // 只查横向裁切；textarea 等多行控件的 scrollHeight > clientHeight 属正常。
    checkHorizontalOverflow(check, item.selector, item.overflow);
  }

  for (const item of [...snap.buttons, ...snap.inputs, ...snap.chips]) {
    check(
      "VF-09",
      item.selector,
      item.rect.height >= MIN_TOUCH_TARGET - EPS,
      `${item.rect.height.toFixed(1)}px`,
      `≥ ${MIN_TOUCH_TARGET}px`
    );
  }

  for (const box of snap.overflowTargets) {
    checkHorizontalOverflow(check, box.selector, box.overflow);
  }

  // T7 #68「选中态」目标：复用 VF-07 编号与 colorDistance / backgroundOf 工具，
  // 确认模式切换（WYSIWYG / 源码 / 分屏）的选中态能从底色上辨认。
  const activeToggle = snap.toggles.find((item) => item.visible && item.active);
  const inactiveToggle = snap.toggles.find(
    (item) => item.visible && !item.active
  );
  if (!activeToggle || !inactiveToggle) {
    check(
      "VF-07",
      ".preview-toggle .toggle-btn",
      false,
      `active=${snap.toggles.filter((i) => i.visible && i.active).length} / inactive=${snap.toggles.filter((i) => i.visible && !i.active).length}`,
      "至少一个可见选中项 + 一个未选中项"
    );
  } else {
    const bgDelta = colorDistance(
      backgroundOf(activeToggle.layers),
      backgroundOf(inactiveToggle.layers)
    );
    check(
      "VF-07",
      ".preview-toggle .toggle-btn background",
      bgDelta >= MIN_BG_DELTA,
      `${bgDelta.toFixed(1)}（${formatRgb(backgroundOf(inactiveToggle.layers))} → ${formatRgb(backgroundOf(activeToggle.layers))}）`,
      `色距 ≥ ${MIN_BG_DELTA}`
    );
  }
}

async function checkEditorKeyboard(page, target, scene, ctx) {
  const check = makeEditorChecker(ctx, target, scene);
  await page.locator("#meta-title").focus();
  await page.keyboard.press("Tab");
  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      width: parseFloat(style.outlineWidth) || 0,
      style: style.outlineStyle,
    };
  });
  check(
    "VF-10",
    "Tab 后的焦点元素",
    ring !== null && ring.width >= 2 && ring.style !== "none",
    ring ? `${ring.tag}: ${ring.width}px ${ring.style}` : "未找到焦点元素",
    "≥ 2px 可见 outline"
  );
}

const sceneLabel = (target, viewport, theme, mode) =>
  `${target.id} / ${viewport.name} / ${theme} / 选中=${mode}`;

async function run() {
  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    viewports: VIEWPORTS.map((v) => v.name),
    editorViewports: EDITOR_VIEWPORTS.map((v) => v.name),
    themes: THEMES,
    rules: RULES,
    scenes: [],
    assertions: 0,
    problems: [],
  };

  console.log("页面观感友好度检查（Playwright 浏览器实测）");
  console.log(
    `目标：${[...TARGETS, ...EDITOR_TARGETS].map((t) => `${t.id} — ${t.name}`).join("、")}`
  );
  console.log(
    `场景：卡片目标 ${VIEWPORTS.length} 视口 × ${THEMES.length} 主题 × 2 选中态；` +
      `编辑器目标 ${EDITOR_VIEWPORTS.length} 视口 × ${THEMES.length} 主题\n`
  );

  if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
  try {
    for (const target of TARGETS) {
      for (const viewport of VIEWPORTS) {
        for (const theme of THEMES) {
          const { context, page, errors } = await openScene(
            browser,
            target,
            viewport,
            theme
          );
          const sceneCtx = { assertions: 0, problems: [] };
          const scenes = [];
          try {
            await settle(page);
            const link = await snapshot(page, target);
            const linkScene = sceneLabel(target, viewport, theme, "link");
            runRules(link, target, linkScene, sceneCtx);
            scenes.push({ scene: linkScene, mode: "link" });
            if (SHOT_DIR) {
              await page.locator(target.dialog).screenshot({
                path: join(
                  SHOT_DIR,
                  `${target.id}-${viewport.name}-${theme}-link.png`
                ),
              });
            }

            await page.locator(target.option).nth(1).click();
            await settle(page);
            const embed = await snapshot(page, target);
            const embedScene = sceneLabel(target, viewport, theme, "embed");
            runRules(embed, target, embedScene, sceneCtx);
            scenes.push({ scene: embedScene, mode: "embed" });
            if (SHOT_DIR) {
              await page.locator(target.dialog).screenshot({
                path: join(
                  SHOT_DIR,
                  `${target.id}-${viewport.name}-${theme}-embed.png`
                ),
              });
            }

            const uiScene = sceneLabel(target, viewport, theme, "交互");
            await checkKeyboard(page, target, uiScene, sceneCtx);
            await checkStateSync(page, target, uiScene, sceneCtx);
            checkConsole(errors, target, uiScene, sceneCtx);
            scenes.push({ scene: uiScene, mode: "交互" });
          } finally {
            await context.close();
          }

          report.assertions += sceneCtx.assertions;
          report.problems.push(...sceneCtx.problems);
          const failed = sceneCtx.problems.length;
          report.scenes.push({
            target: target.id,
            viewport: viewport.name,
            theme,
            modes: scenes,
            assertions: sceneCtx.assertions,
            problems: failed,
          });
          const mark = failed === 0 ? "✓" : "✗";
          console.log(
            `  ${mark} ${viewport.name.padEnd(7)} / ${theme.padEnd(5)} — ${sceneCtx.assertions} 条断言，${failed} 处问题`
          );
        }
      }
    }

    // T6 #67：编辑器元信息面板目标，独立的 280 / 375 / 1280 视口矩阵。
    for (const target of EDITOR_TARGETS) {
      for (const viewport of EDITOR_VIEWPORTS) {
        for (const theme of THEMES) {
          const { context, page, errors } = await openScene(
            browser,
            target,
            viewport,
            theme
          );
          const sceneCtx = { assertions: 0, problems: [] };
          const scene = `${target.id} / ${viewport.name} / ${theme}`;
          try {
            await settle(page);
            runEditorRules(
              await collectEditorSnapshot(page),
              target,
              scene,
              sceneCtx
            );
            await checkEditorKeyboard(page, target, scene, sceneCtx);
            checkConsole(errors, target, scene, sceneCtx);
          } finally {
            await context.close();
          }

          report.assertions += sceneCtx.assertions;
          report.problems.push(...sceneCtx.problems);
          const failed = sceneCtx.problems.length;
          report.scenes.push({
            target: target.id,
            viewport: viewport.name,
            theme,
            modes: [{ scene, mode: "元信息面板" }],
            assertions: sceneCtx.assertions,
            problems: failed,
          });
          const mark = failed === 0 ? "✓" : "✗";
          console.log(
            `  ${mark} ${viewport.name.padEnd(7)} / ${theme.padEnd(5)} — ${sceneCtx.assertions} 条断言，${failed} 处问题`
          );
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (REPORT_JSON) {
    report.result = report.problems.length === 0 ? "PASS" : "FAIL";
    writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`\n机器可读报告：${REPORT_JSON}`);
  }

  if (report.problems.length > 0) {
    console.error(`\nFAIL：发现 ${report.problems.length} 处观感问题\n`);
    report.problems.forEach((problem, index) => {
      console.error(
        `  ${index + 1}. [${problem.ruleId} ${problem.rule}] ${problem.scene}\n` +
          `     元素：${problem.element}\n` +
          `     实测：${problem.actual}\n` +
          `     期望：${problem.expected}\n` +
          `     定位：${problem.source}`
      );
    });
    console.error(
      `\n共 ${report.assertions} 条断言，${report.problems.length} 条未通过。`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nPASS：${report.scenes.length} 组场景 × ${report.assertions} 条断言全部通过，未发现观感问题。`
  );
}

run().catch((error) => {
  console.error("观感检查脚本异常（退出码 2）：", error);
  process.exitCode = 2;
});
