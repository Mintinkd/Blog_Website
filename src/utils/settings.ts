import { setOverrides, refreshDomTranslations } from "./i18n";
import {
  PATTERNS,
  SETTINGS_RULES,
  type SettingsRule,
} from "../generated/settings-rules";

/**
 * 全站可视化配置 —— 前端运行时注入器
 *
 * 职责：把后台下发的 SiteSettings 转成可直接生效的「视觉与行为」：
 *   1. 配色 / 布局 / 背景  -> 注入 CSS 变量（覆盖 variables.css 默认值，!important 保证生效）
 *   2. 功能开关           -> 在 <html> 上写 data-feature-<name>="off"，配合 [data-feature] 钩子隐藏
 *   3. 文案覆盖           -> 写入 i18n 覆盖层并刷新页面上 [data-i18n] 文本
 *
 * 不破坏既有约束：
 *   - 配色按 [data-theme="light"/"dark"] 分写，日/夜切换照常生效
 *   - 文案覆盖按当前 locale 生效，中/英切换照常生效
 *   - 仅用 transform/opacity 之外的「变量覆盖」手段，不触发重排
 */

export interface ThemeColors {
  accent: string;
  accentHover: string;
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  borderLight: string;
}

export interface SiteSettings {
  theme: { light: ThemeColors; dark: ThemeColors };
  layout: {
    contentMaxWidth: string;
    headerHeight: string;
    radiusSm: string;
    radiusMd: string;
    radiusLg: string;
  };
  background: {
    bgImage: string;
    bgOpacity: number;
    /** 背景图雾化模糊（px，0=不模糊），提升前景文字可读性 */
    bgBlur: number;
    /** 背景图亮度（可配区间以 settings.rules.json 为准，1=原样），暗色主题下调低可避免亮图刺眼 */
    bgBrightness: number;
  };
  features: {
    comments: boolean;
    likes: boolean;
    friendLinks: boolean;
    search: boolean;
    rss: boolean;
    darkMode: boolean;
    i18n: boolean;
  };
  copy: {
    zh: Record<string, string>;
    en: Record<string, string>;
  };
  /** 动效强度与视差开关（后台可配） */
  motion: {
    /** normal=全部动效；reduced=仅保留轻量入场与进度条，禁用磁吸/视差；off=全部禁用 */
    intensity: "normal" | "reduced" | "off";
    /** 是否启用视差（含背景层极轻微视差） */
    parallax: boolean;
    /** 视差速度系数 0~0.1，越大位移越明显；背景层默认 0.04 */
    parallaxSpeed: number;
  };
}

export function getDefaultSettings(): SiteSettings {
  return {
    theme: {
      light: {
        accent: "#49b1f5",
        accentHover: "#3a9de8",
        bgPrimary: "#fafafa",
        bgSecondary: "#ffffff",
        bgTertiary: "#f5f5f5",
        textPrimary: "#1d1d1f",
        textSecondary: "#5d5d64",
        textTertiary: "#76767e",
        border: "#e8e8ed",
        borderLight: "#f0f0f5",
      },
      dark: {
        accent: "#7cb8f0",
        accentHover: "#a6d4f8",
        bgPrimary: "#0a0a0a",
        bgSecondary: "#1c1c1e",
        bgTertiary: "#2c2c2e",
        textPrimary: "#f5f5f7",
        textSecondary: "#a1a1a6",
        textTertiary: "#6e6e73",
        border: "#38383a",
        borderLight: "#15151a",
      },
    },
    layout: {
      contentMaxWidth: "1200px",
      headerHeight: "64px",
      radiusSm: "6px",
      radiusMd: "10px",
      radiusLg: "16px",
    },
    background: {
      bgImage: "/bg-placeholder.svg",
      bgOpacity: 0.55,
      bgBlur: 6,
      bgBrightness: 1,
    },
    features: {
      comments: true,
      likes: true,
      friendLinks: true,
      search: true,
      rss: true,
      darkMode: true,
      i18n: true,
    },
    copy: { zh: {}, en: {} },
    motion: {
      intensity: "normal",
      parallax: true,
      parallaxSpeed: 0.04,
    },
  };
}

/* ── P1-6 / issue #11 → issue #27：字段级白名单（读侧兜底） ──
 * 规则不再双端各手写一份：全部来自 src/generated/settings-rules.ts ——
 * 仓库根 settings.rules.json 规则描述符的生成物，写侧（worker，非法即 400 拒绝）
 * 与本读侧共享同一单源，「双端同一套」由 CI 漂移断言守护。
 * 此处职责为兜底：历史脏数据/绕过校验的数据一律按字段回落默认值，
 * 从根上消除「值未校验即拼进 CSS」的注入面（报告 M1）。 */

/** 普通对象（非 null / 非数组）：读侧容器语义 —— 整形污染的容器不展开，逐字段走回落 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** 读侧逐级取值：每一级都必须是普通对象（与既有逐字段实现的容器判定同构） */
function readValue(src: unknown, path: string): unknown {
  let cur: unknown = src;
  for (const key of path.split(".")) {
    cur = isPlainObject(cur) ? cur[key] : undefined;
  }
  return cur;
}

/** 读侧逐叶写回（out 为 getDefaultSettings() 产物：各分区均为普通对象，逐级必然贯通） */
function writeLeaf(
  out: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  let cur: unknown = out;
  const segs = path.split(".");
  for (const key of segs.slice(0, segs.length - 1)) {
    cur = (cur as Record<string, unknown>)[key];
  }
  (cur as Record<string, unknown>)[segs[segs.length - 1]] = value;
}

/** copy 覆盖地图：只收字符串且长度 ≤ 上限（上限随生成物携带，与写侧同源） */
function pickCopy(src: unknown, cap: number): Record<string, string> {
  const out: Record<string, string> = {};
  if (isPlainObject(src)) {
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === "string" && v.length <= cap) out[k] = v;
    }
  }
  return out;
}

/** 按 kind 逐字段落地：合法 → 原值，非法 → 按字段回落默认值（语义与逐字段手写版逐字对应） */
function applyLeaf(rule: SettingsRule, v: unknown, fallback: unknown): unknown {
  switch (rule.kind) {
    case "string":
      // 命中任一命名 pattern 即合法（bgImage = 站内相对路径 或 https 外链，语义见 PATTERNS 注释）
      return typeof v === "string" &&
        rule.patterns.some((name) => PATTERNS[name].test(v))
        ? v
        : fallback;
    case "number":
      return typeof v === "number" &&
        Number.isFinite(v) &&
        v >= rule.min &&
        v <= rule.max
        ? v
        : fallback;
    case "enum":
      return typeof v === "string" && rule.values.includes(v) ? v : fallback;
    case "bool":
      return typeof v === "boolean" ? v : fallback;
    case "copy":
      return pickCopy(v, rule.cap);
  }
}

/** 把任意形状的输入收敛为「全字段合法」的 SiteSettings（非法字段按字段回落默认值） */
export function sanitizeSettings(input: unknown): SiteSettings {
  const out = getDefaultSettings() as unknown as Record<string, unknown>;
  const src =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  for (const [path, rule] of Object.entries(SETTINGS_RULES)) {
    // 回落值与判定先于写回：默认值即为该字段的回落基线（逐字段与旧实现一致）
    writeLeaf(
      out,
      path,
      applyLeaf(rule, readValue(src, path), readValue(out, path))
    );
  }
  return out as unknown as SiteSettings;
}

const STYLE_ID = "dynamic-settings";
const VERSION_KEY = "site-settings-version";

function kebab(k: string): string {
  return k.replace(/([A-Z])/g, (m) => "-" + m.toLowerCase());
}

function hexToRgb(hex: string): [number, number, number] {
  let h = (hex || "").trim().replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt((h + "000000").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** buildOverlay/bgBlur/bgBrightness 的防御性钳制区间与 sanitize 白名单同源：
 * 直接引用生成物规则，不再在此复述数值（区间改变只发生在描述符） */
function numericRangeAt(path: string): { min: number; max: number } {
  const rule = SETTINGS_RULES[path];
  if (rule.kind !== "number") {
    throw new Error("参照的规则不是 number 形状：" + path);
  }
  return { min: rule.min, max: rule.max };
}

const BG_OPACITY_RANGE = numericRangeAt("background.bgOpacity");
const BG_BLUR_RANGE = numericRangeAt("background.bgBlur");
const BG_BRIGHTNESS_RANGE = numericRangeAt("background.bgBrightness");

/**
 * 背景遮罩：用主题背景色按「图片强度」生成渐变，保证前景文字对比度
 * - 语义约定：opacity = 图片穿透蒙版的可见度（0=几乎全遮挡、1=几乎全透出图）
 * - 实际蒙版 alpha = (1 - opacity) * 0.55，封顶 55%，确保最不透明时文字仍有清晰对比度
 *   这样用户拖滑杆时，「图更明显 / 图更淡」与直觉一致；以前是相反的「蒙版浓度」
 */
function buildOverlay(bg: string, opacity: number): string {
  const [r, g, b] = hexToRgb(bg);
  const o = Math.max(
    BG_OPACITY_RANGE.min,
    Math.min(BG_OPACITY_RANGE.max, Number(opacity) || 0)
  );
  const mask = Math.max(0, Math.min(1, (1 - o) * 0.55));
  // 顶端略低、底端略高（深→浅阴影感），与原来方向一致；保留 0.05 的小跨度
  const a1 = Math.max(0, mask - 0.05);
  const a2 = Math.min(1, mask + 0.05);
  return `linear-gradient(180deg, rgba(${r}, ${g}, ${b}, ${a1}) 0%, rgba(${r}, ${g}, ${b}, ${a2}) 100%)`;
}

/** 构建完整 CSS 字符串（纯函数；入参必须已通过 sanitizeSettings——buildCss 入口净化一次后调用，applySettings 持自身净化产物直接调用，见 issue #25） */
function cssFrom(s: SiteSettings): string {
  const L = s.theme.light;
  const D = s.theme.dark;
  const ly = s.layout;
  const bg = s.background;
  const lines: string[] = [];

  lines.push(":root {");
  lines.push(`  --content-max-width: ${ly.contentMaxWidth} !important;`);
  lines.push(`  --header-height: ${ly.headerHeight} !important;`);
  lines.push(`  --radius-sm: ${ly.radiusSm} !important;`);
  lines.push(`  --radius-md: ${ly.radiusMd} !important;`);
  lines.push(`  --radius-lg: ${ly.radiusLg} !important;`);
  lines.push(`  --bg-image: url("${bg.bgImage}") !important;`);
  lines.push(
    `  --bg-blur: ${Math.max(BG_BLUR_RANGE.min, Math.min(BG_BLUR_RANGE.max, Number(bg.bgBlur) || 0))}px !important;`
  );
  lines.push(
    `  --bg-brightness: ${Math.max(BG_BRIGHTNESS_RANGE.min, Math.min(BG_BRIGHTNESS_RANGE.max, Number(bg.bgBrightness) || 1))} !important;`
  );
  lines.push("}");

  lines.push('[data-theme="light"] {');
  for (const [k, v] of Object.entries(L))
    lines.push(`  --color-${kebab(k)}: ${v} !important;`);
  lines.push(
    `  --bg-overlay: ${buildOverlay(L.bgPrimary, bg.bgOpacity)} !important;`
  );
  lines.push("}");

  lines.push('[data-theme="dark"] {');
  for (const [k, v] of Object.entries(D))
    lines.push(`  --color-${kebab(k)}: ${v} !important;`);
  lines.push(
    `  --bg-overlay: ${buildOverlay(D.bgPrimary, bg.bgOpacity)} !important;`
  );
  lines.push("}");

  for (const [k, on] of Object.entries(s.features)) {
    if (!on) {
      lines.push(
        `html[data-feature-${k}="off"] [data-feature="${k}"] { display: none !important; }`
      );
    }
  }

  return lines.join("\n");
}

/**
 * 公开入口：先按字段白名单回落（sanitizeSettings），意外异常再整体回落默认值。
 * 永不抛错 —— 即使设置形状被破坏（如 theme 被覆盖为字符串）或携带注入载荷，
 * SSR 也只会产出默认/安全 CSS，不会 500。
 *
 * issue #25：单次净化即分流——此处净化一次后直接产出 CSS；
 * 已持有净化产物（applySettings）的路径走 cssFrom，不对同一输入重复净化。
 */
export function buildCss(s: SiteSettings): string {
  try {
    return cssFrom(sanitizeSettings(s));
  } catch {
    return cssFrom(getDefaultSettings());
  }
}

export function applySettings(s: SiteSettings): void {
  // 读侧兜底：非法字段按字段回落，客户端行为与 SSR 一致
  // （issue #25：此处只净化这一次；产出 CSS 直接走 cssFrom，不再经 buildCss 重复净化）
  const safe = sanitizeSettings(s);

  // 1) 配色 / 布局 / 背景：注入 CSS 变量覆盖
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = cssFrom(safe);

  // 2) 功能开关：在 <html> 上标记 data-feature-<name>="off"
  const root = document.documentElement;
  for (const [k, on] of Object.entries(safe.features)) {
    if (on) root.removeAttribute(`data-feature-${k}`);
    else root.setAttribute(`data-feature-${k}`, "off");
  }

  // 4) 动效强度与视差开关：写 data 属性 + CSS 变量，供 motion.ts / motion.css 读取
  const m = safe.motion;
  root.setAttribute("data-motion-intensity", m.intensity);
  if (m.parallax) root.removeAttribute("data-parallax");
  else root.setAttribute("data-parallax", "off");
  root.style.setProperty("--parallax-speed", String(m.parallaxSpeed));

  // 5) 文案覆盖：写入 i18n 覆盖层并刷新 DOM 上 [data-i18n]
  setOverrides(safe.copy);
  refreshDomTranslations();
}

let listenersBound = false;

export async function initSettings(): Promise<void> {
  try {
    const res = await fetch("/api/v1/settings/public");
    const data = await res.json();
    if (data.code === 0 && data.data) {
      applySettings(data.data as SiteSettings);
    }
  } catch {
    /* 离线/接口异常时静默回退到代码内置默认值 */
  }

  if (!listenersBound) {
    listenersBound = true;
    // 跨标签页实时生效：后台保存后广播
    window.addEventListener("storage", (e) => {
      if (e.key === VERSION_KEY) initSettings();
    });
    window.addEventListener("settings-updated", () => initSettings());
    // SPA 跨页（astro:page-load）后重新拉取并应用，保证所有页面沿用最新 settings
    document.addEventListener("astro:page-load", () => initSettings());
  }
}

/** 后台保存成功后调用：通知其它标签页重新拉取并套用 */
export function broadcastSettingsChange(): void {
  localStorage.setItem(VERSION_KEY, String(Date.now()));
  window.dispatchEvent(new CustomEvent("settings-updated"));
}
