import { setOverrides, refreshDomTranslations } from "./i18n";

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
    /** 背景图亮度（0.7~1.3，1=原样），暗色主题下调低可避免亮图刺眼 */
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

/* ── P1-6 / issue #11：字段级白名单（读侧兜底） ──
 * 与 worker/src/handlers/settings.ts 的 validateSettings 同一套规则：
 * 写入侧非法值会被 400 拒绝；此处负责读侧兜底——历史脏数据/绕过校验的数据
 * 一律按字段回落默认值，从根上消除「值未校验即拼进 CSS」的注入面（报告 M1/L1）。 */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const SIZE_RE = /^\d{1,4}(px|rem|em|%)$/;
/** 站内相对路径（媒体库/静态资源） */
const LOCAL_PATH_RE = /^\/[A-Za-z0-9\-._~/%]+$/;
/** 仅 https 外链；字符集排除引号/尖括号/反斜杠/圆括号，杜绝 CSS 字符串逃逸与标签闭合 */
const HTTPS_URL_RE = /^https:\/\/[A-Za-z0-9\-._~:/?#@!$&*+,;=%]+$/;

function pickStr(v: unknown, re: RegExp, fallback: string): string {
  return typeof v === "string" && re.test(v) ? v : fallback;
}

function pickNum(
  v: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : fallback;
}

function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function pickCopy(src: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (src && typeof src === "object" && !Array.isArray(src)) {
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === "string" && v.length <= 2000) out[k] = v;
    }
  }
  return out;
}

/** 把任意形状的输入收敛为「全字段合法」的 SiteSettings（非法字段按字段回落默认值） */
export function sanitizeSettings(input: unknown): SiteSettings {
  const d = getDefaultSettings();
  const s = (
    input && typeof input === "object" && !Array.isArray(input) ? input : {}
  ) as Record<string, any>;

  const theme = { light: { ...d.theme.light }, dark: { ...d.theme.dark } };
  for (const mode of ["light", "dark"] as const) {
    const src =
      s.theme && typeof s.theme === "object" && !Array.isArray(s.theme)
        ? s.theme[mode]
        : undefined;
    if (src && typeof src === "object" && !Array.isArray(src)) {
      for (const k of Object.keys(d.theme[mode]) as (keyof ThemeColors)[]) {
        theme[mode][k] = pickStr(src[k], HEX_COLOR_RE, d.theme[mode][k]);
      }
    }
  }

  const ly =
    s.layout && typeof s.layout === "object" && !Array.isArray(s.layout)
      ? s.layout
      : {};
  const layout = {
    contentMaxWidth: pickStr(
      ly.contentMaxWidth,
      SIZE_RE,
      d.layout.contentMaxWidth
    ),
    headerHeight: pickStr(ly.headerHeight, SIZE_RE, d.layout.headerHeight),
    radiusSm: pickStr(ly.radiusSm, SIZE_RE, d.layout.radiusSm),
    radiusMd: pickStr(ly.radiusMd, SIZE_RE, d.layout.radiusMd),
    radiusLg: pickStr(ly.radiusLg, SIZE_RE, d.layout.radiusLg),
  };

  const bgs =
    s.background &&
    typeof s.background === "object" &&
    !Array.isArray(s.background)
      ? s.background
      : {};
  const bgImage =
    typeof bgs.bgImage === "string" &&
    (LOCAL_PATH_RE.test(bgs.bgImage) || HTTPS_URL_RE.test(bgs.bgImage))
      ? bgs.bgImage
      : d.background.bgImage;
  const background = {
    bgImage,
    bgOpacity: pickNum(bgs.bgOpacity, 0, 1, d.background.bgOpacity),
    bgBlur: pickNum(bgs.bgBlur, 0, 30, d.background.bgBlur),
    bgBrightness: pickNum(
      bgs.bgBrightness,
      0.7,
      1.3,
      d.background.bgBrightness
    ),
  };

  const fsrc =
    s.features && typeof s.features === "object" && !Array.isArray(s.features)
      ? s.features
      : {};
  const features = { ...d.features };
  for (const k of Object.keys(
    d.features
  ) as (keyof SiteSettings["features"])[]) {
    features[k] = pickBool(fsrc[k], d.features[k]);
  }

  const msrc =
    s.motion && typeof s.motion === "object" && !Array.isArray(s.motion)
      ? s.motion
      : {};
  const intensity = msrc.intensity;
  const motion = {
    intensity: (intensity === "normal" ||
    intensity === "reduced" ||
    intensity === "off"
      ? intensity
      : d.motion.intensity) as SiteSettings["motion"]["intensity"],
    parallax: pickBool(msrc.parallax, d.motion.parallax),
    parallaxSpeed: pickNum(msrc.parallaxSpeed, 0, 0.1, d.motion.parallaxSpeed),
  };

  const copySrc =
    s.copy && typeof s.copy === "object" && !Array.isArray(s.copy)
      ? s.copy
      : {};
  const copy = { zh: pickCopy(copySrc.zh), en: pickCopy(copySrc.en) };

  return { theme, layout, background, features, copy, motion };
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

/**
 * 背景遮罩：用主题背景色按「图片强度」生成渐变，保证前景文字对比度
 * - 语义约定：opacity = 图片穿透蒙版的可见度（0=几乎全遮挡、1=几乎全透出图）
 * - 实际蒙版 alpha = (1 - opacity) * 0.55，封顶 55%，确保最不透明时文字仍有清晰对比度
 *   这样用户拖滑杆时，「图更明显 / 图更淡」与直觉一致；以前是相反的「蒙版浓度」
 */
function buildOverlay(bg: string, opacity: number): string {
  const [r, g, b] = hexToRgb(bg);
  const o = Math.max(0, Math.min(1, Number(opacity) || 0));
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
    `  --bg-blur: ${Math.max(0, Math.min(30, Number(bg.bgBlur) || 0))}px !important;`
  );
  lines.push(
    `  --bg-brightness: ${Math.max(0.7, Math.min(1.3, Number(bg.bgBrightness) || 1))} !important;`
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
