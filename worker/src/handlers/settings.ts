import { Env } from '../index';
import { successResponse, error, ErrorCodes } from '../utils/response';

/**
 * 全站可视化配置中心 —— 后端逻辑
 *
 * 设计要点：
 * - 所有个性化设置（配色 / 布局 / 背景 / 功能开关 / 文案覆盖）统一存为
 *   site_config 表中一个 JSON blob（key = 'site_settings'），便于整体导出/导入/恢复默认。
 * - 读取时与 DEFAULT_SETTINGS 深度合并，缺失字段自动补默认，未知字段被过滤（防注入）。
 * - 渗透报告 004 修复：'/settings' 完整视图收为管理员鉴权；前台运行时改走
 *   '/settings/public' 白名单投影 —— 只放行「页面渲染本就需要展示」的字段。
 *   今后新增任何敏感配置项时默认不公开，必须显式加入 PUBLIC_KEYS 才会暴露。
 */

const SETTINGS_KEY = 'site_settings';

/** 允许匿名公开的顶级字段白名单（均为纯展示性配置，不含密钥） */
const PUBLIC_KEYS = ['theme', 'layout', 'background', 'features', 'motion', 'copy'] as const;

/** 完整 settings -> 公开投影：未知/未来新增字段默认剔除 */
export function toPublicSettings(s: SiteSettings): Partial<SiteSettings> {
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_KEYS) {
    if (key in s) out[key] = s[key as keyof SiteSettings];
  }
  return out as Partial<SiteSettings>;
}

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
    bgBlur: number;
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
    intensity: 'normal' | 'reduced' | 'off';
    parallax: boolean;
    parallaxSpeed: number;
  };
}

export function getDefaultSettings(): SiteSettings {
  return {
    theme: {
      light: {
        accent: '#49b1f5',
        accentHover: '#3a9de8',
        bgPrimary: '#fafafa',
        bgSecondary: '#ffffff',
        bgTertiary: '#f5f5f5',
        textPrimary: '#1d1d1f',
        textSecondary: '#5d5d64',
        textTertiary: '#76767e',
        border: '#e8e8ed',
        borderLight: '#f0f0f5',
      },
      dark: {
        accent: '#7cb8f0',
        accentHover: '#a6d4f8',
        bgPrimary: '#0a0a0a',
        bgSecondary: '#1c1c1e',
        bgTertiary: '#2c2c2e',
        textPrimary: '#f5f5f7',
        textSecondary: '#a1a1a6',
        textTertiary: '#6e6e73',
        border: '#38383a',
        borderLight: '#15151a',
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
      // 与前端 settings.ts 同步：bgOpacity 语义为「图片可见度」而非「遮罩浓度」
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
      intensity: 'normal',
      parallax: true,
      parallaxSpeed: 0.04,
    },
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 只保留 base 中存在的键，深度合并 override，过滤未知键（防止任意字段注入） */
function deepMerge<T>(base: T, override: any): T {
  if (!isObj(base) || !isObj(override)) {
    return (override === undefined ? base : override) as T;
  }
  const out: any = { ...base };
  for (const k of Object.keys(base as any)) {
    if (k in override) out[k] = deepMerge((base as any)[k], (override as any)[k]);
  }
  return out;
}

/* ── P1-6 / issue #11：设置值字段白名单（写入侧拒绝非法值，400） ──
 * 规则与 src/utils/settings.ts 的 sanitizeSettings 保持一致（双端同一套）。
 * 背景图仅放行站内相对路径或 https 外链，字符集排除引号/尖括号/反斜杠/圆括号，
 * 从根上杜绝 CSS 字符串逃逸、</style> 提前闭合与 url() 外联注入（报告 M1）。 */

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const SIZE_RE = /^\d{1,4}(px|rem|em|%)$/;
const LOCAL_PATH_RE = /^\/[A-Za-z0-9\-._~/%]+$/;
const HTTPS_URL_RE = /^https:\/\/[A-Za-z0-9\-._~:/?#@!$&*+,;=%]+$/;

function isSafeUrl(v: unknown): v is string {
  return typeof v === 'string' && (LOCAL_PATH_RE.test(v) || HTTPS_URL_RE.test(v));
}

function isNumberInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

/** 返回非法字段路径列表；空数组 = 全部合法 */
export function validateSettings(s: SiteSettings): string[] {
  const bad: string[] = [];
  const req = (ok: boolean, path: string) => {
    if (!ok) bad.push(path);
  };
  const d = getDefaultSettings();

  for (const mode of ['light', 'dark'] as const) {
    const t = (s.theme as unknown as Record<string, unknown> | undefined)?.[mode] as Record<string, unknown> | undefined;
    for (const k of Object.keys(d.theme[mode]) as (keyof ThemeColors)[]) {
      const v = t && typeof t === 'object' ? t[k] : undefined;
      req(typeof v === 'string' && HEX_COLOR_RE.test(v), `theme.${mode}.${k}`);
    }
  }
  for (const k of Object.keys(d.layout) as (keyof SiteSettings['layout'])[]) {
    const v = s.layout?.[k];
    req(typeof v === 'string' && SIZE_RE.test(v), `layout.${k}`);
  }
  req(isSafeUrl(s.background?.bgImage), 'background.bgImage');
  req(isNumberInRange(s.background?.bgOpacity, 0, 1), 'background.bgOpacity');
  req(isNumberInRange(s.background?.bgBlur, 0, 30), 'background.bgBlur');
  req(isNumberInRange(s.background?.bgBrightness, 0.7, 1.3), 'background.bgBrightness');
  for (const k of Object.keys(d.features) as (keyof SiteSettings['features'])[]) {
    req(typeof s.features?.[k] === 'boolean', `features.${k}`);
  }
  req(s.motion?.intensity === 'normal' || s.motion?.intensity === 'reduced' || s.motion?.intensity === 'off', 'motion.intensity');
  req(typeof s.motion?.parallax === 'boolean', 'motion.parallax');
  req(isNumberInRange(s.motion?.parallaxSpeed, 0, 0.1), 'motion.parallaxSpeed');
  for (const loc of ['zh', 'en'] as const) {
    const m = (s.copy as unknown as Record<string, unknown> | undefined)?.[loc];
    if (!isObj(m)) {
      bad.push(`copy.${loc}`);
      continue;
    }
    const badKey = Object.entries(m).find(([, v]) => typeof v !== 'string' || (v as string).length > 2000);
    if (badKey) bad.push(`copy.${loc}.${badKey[0]}`);
  }
  return bad;
}

async function loadStored(env: Env): Promise<SiteSettings> {
  const row = await env.DB.prepare('SELECT value FROM site_config WHERE key = ?').bind(SETTINGS_KEY).first();
  const raw = row && (row as any).value ? (row as any).value : null;
  if (raw) {
    try {
      return deepMerge(getDefaultSettings(), JSON.parse(raw));
    } catch {
      return getDefaultSettings();
    }
  }
  return getDefaultSettings();
}

async function save(env: Env, settings: SiteSettings): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO site_config (key, value, is_public, updated_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, is_public = 1, updated_at = excluded.updated_at`
  ).bind(SETTINGS_KEY, JSON.stringify(settings), new Date().toISOString()).run();
}

export async function handleGetSettings(_req: Request, env: Env): Promise<Response> {
  const settings = await loadStored(env);
  return successResponse(settings);
}

/** 公开投影（匿名可访问）：仅白名单字段，未来新增敏感字段不会意外泄露 */
export async function handleGetPublicSettings(_req: Request, env: Env): Promise<Response> {
  const settings = await loadStored(env);
  return successResponse(toPublicSettings(settings));
}

export async function handleUpdateSettings(req: Request, env: Env): Promise<Response> {
  try {
    const body = await req.json();
    const merged = deepMerge(getDefaultSettings(), body);
    const invalid = validateSettings(merged);
    if (invalid.length) {
      return error(ErrorCodes.VALIDATION_FAILED, '非法设置值（已拒绝保存）：' + invalid.join('；'));
    }
    await save(env, merged);
    return successResponse(merged, '设置已保存');
  } catch (e) {
    return error(ErrorCodes.PARAM_ERROR, '保存失败：' + (e instanceof Error ? e.message : '格式错误'));
  }
}

export async function handleResetSettings(_req: Request, env: Env): Promise<Response> {
  const def = getDefaultSettings();
  await save(env, def);
  return successResponse(def, '已恢复默认设置');
}

export async function handleExportSettings(_req: Request, env: Env): Promise<Response> {
  const settings = await loadStored(env);
  return new Response(JSON.stringify(settings, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename=site-settings.json',
    },
  });
}

export async function handleImportSettings(req: Request, env: Env): Promise<Response> {
  try {
    const body = await req.json();
    const merged = deepMerge(getDefaultSettings(), body);
    const invalid = validateSettings(merged);
    if (invalid.length) {
      return error(ErrorCodes.VALIDATION_FAILED, '非法设置值（已拒绝导入）：' + invalid.join('；'));
    }
    await save(env, merged);
    return successResponse(merged, '配置导入成功');
  } catch (e) {
    return error(ErrorCodes.PARAM_ERROR, '导入失败：' + (e instanceof Error ? e.message : '格式错误'));
  }
}
