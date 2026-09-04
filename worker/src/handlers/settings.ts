import { Env } from '../index';
import { successResponse, error, ErrorCodes } from '../utils/response';

/**
 * 全站可视化配置中心 —— 后端逻辑
 *
 * 设计要点：
 * - 所有个性化设置（配色 / 布局 / 背景 / 功能开关 / 文案覆盖）统一存为
 *   site_config 表中一个 JSON blob（key = 'site_settings'），便于整体导出/导入/恢复默认。
 * - 读取时与 DEFAULT_SETTINGS 深度合并，缺失字段自动补默认，未知字段被过滤（防注入）。
 * - 这些设置不含任何密钥，'/settings' 作为公开接口供前台运行时拉取并实时套用。
 */

const SETTINGS_KEY = 'site_settings';

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

export async function handleUpdateSettings(req: Request, env: Env): Promise<Response> {
  try {
    const body = await req.json();
    const merged = deepMerge(getDefaultSettings(), body);
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
    await save(env, merged);
    return successResponse(merged, '配置导入成功');
  } catch (e) {
    return error(ErrorCodes.PARAM_ERROR, '导入失败：' + (e instanceof Error ? e.message : '格式错误'));
  }
}
