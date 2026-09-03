import { setOverrides, refreshDomTranslations } from './i18n';

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
}

export function getDefaultSettings(): SiteSettings {
  return {
    theme: {
      light: {
        accent: '#6366f1',
        accentHover: '#4f46e5',
        bgPrimary: '#fafafa',
        bgSecondary: '#ffffff',
        bgTertiary: '#f5f5f5',
        textPrimary: '#1d1d1f',
        textSecondary: '#6e6e73',
        textTertiary: '#a1a1a6',
        border: '#e8e8ed',
        borderLight: '#f0f0f5',
      },
      dark: {
        accent: '#818cf8',
        accentHover: '#a5b4fc',
        bgPrimary: '#0a0a0a',
        bgSecondary: '#1c1c1e',
        bgTertiary: '#2c2c2e',
        textPrimary: '#f5f5f7',
        textSecondary: '#a1a1a6',
        textTertiary: '#6e6e73',
        border: '#38383a',
        borderLight: '#2c2c2e',
      },
    },
    layout: {
      contentMaxWidth: '1200px',
      headerHeight: '64px',
      radiusSm: '6px',
      radiusMd: '10px',
      radiusLg: '16px',
    },
    background: {
      bgImage: '/bg-placeholder.svg',
      bgOpacity: 0.85,
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
  };
}

const STYLE_ID = 'dynamic-settings';
const VERSION_KEY = 'site-settings-version';

function kebab(k: string): string {
  return k.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase());
}

function hexToRgb(hex: string): [number, number, number] {
  let h = (hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt((h + '000000').slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 背景遮罩：用主题背景色按浓度生成渐变，保证前景文字对比度 */
function buildOverlay(bg: string, opacity: number): string {
  const [r, g, b] = hexToRgb(bg);
  const o = Math.max(0, Math.min(1, Number(opacity) || 0));
  const o2 = Math.min(1, o + 0.06);
  return `linear-gradient(180deg, rgba(${r}, ${g}, ${b}, ${o}) 0%, rgba(${r}, ${g}, ${b}, ${o2}) 100%)`;
}

function buildCss(s: SiteSettings): string {
  const L = s.theme.light;
  const D = s.theme.dark;
  const ly = s.layout;
  const bg = s.background;
  const lines: string[] = [];

  lines.push(':root {');
  lines.push(`  --content-max-width: ${ly.contentMaxWidth} !important;`);
  lines.push(`  --header-height: ${ly.headerHeight} !important;`);
  lines.push(`  --radius-sm: ${ly.radiusSm} !important;`);
  lines.push(`  --radius-md: ${ly.radiusMd} !important;`);
  lines.push(`  --radius-lg: ${ly.radiusLg} !important;`);
  lines.push(`  --bg-image: url("${bg.bgImage}") !important;`);
  lines.push('}');

  lines.push('[data-theme="light"] {');
  for (const [k, v] of Object.entries(L)) lines.push(`  --color-${kebab(k)}: ${v} !important;`);
  lines.push(`  --bg-overlay: ${buildOverlay(L.bgPrimary, bg.bgOpacity)} !important;`);
  lines.push('}');

  lines.push('[data-theme="dark"] {');
  for (const [k, v] of Object.entries(D)) lines.push(`  --color-${kebab(k)}: ${v} !important;`);
  lines.push(`  --bg-overlay: ${buildOverlay(D.bgPrimary, bg.bgOpacity)} !important;`);
  lines.push('}');

  for (const [k, on] of Object.entries(s.features)) {
    if (!on) {
      lines.push(`html[data-feature-${k}="off"] [data-feature="${k}"] { display: none !important; }`);
    }
  }

  return lines.join('\n');
}

export function applySettings(s: SiteSettings): void {
  // 1) 配色 / 布局 / 背景：注入 CSS 变量覆盖
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = buildCss(s);

  // 2) 功能开关：在 <html> 上标记 data-feature-<name>="off"
  const root = document.documentElement;
  for (const [k, on] of Object.entries(s.features)) {
    if (on) root.removeAttribute(`data-feature-${k}`);
    else root.setAttribute(`data-feature-${k}`, 'off');
  }

  // 3) 文案覆盖：写入 i18n 覆盖层并刷新 DOM 上 [data-i18n]
  setOverrides(s.copy);
  refreshDomTranslations();
}

let listenersBound = false;

export async function initSettings(): Promise<void> {
  try {
    const res = await fetch('/api/v1/settings');
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
    window.addEventListener('storage', (e) => {
      if (e.key === VERSION_KEY) initSettings();
    });
    window.addEventListener('settings-updated', () => initSettings());
  }
}

/** 后台保存成功后调用：通知其它标签页重新拉取并套用 */
export function broadcastSettingsChange(): void {
  localStorage.setItem(VERSION_KEY, String(Date.now()));
  window.dispatchEvent(new CustomEvent('settings-updated'));
}
