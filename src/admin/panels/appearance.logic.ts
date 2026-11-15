/**
 * 后台「外观与个性化」面板的纯逻辑。不依赖 DOM / Vue 运行时，可在 node 环境单测。
 * 拆分前是 `App.vue` 的 copyKeys / addCopyKey / removeCopyKey / renameCopyKey，
 * 以及 loadSettings / importSettingsFile / resetSettings 里 motion 与 copy 的回退。
 * 全部对普通对象操作，不依赖 reactive。
 */
export interface CopyMap {
  zh: Record<string, string>;
  en: Record<string, string>;
}

/** 逐字对应 copyKeys：zh 键在前、en 键在后，Set 去重 */
export function copyKeyUnion(
  zh: Record<string, string>,
  en: Record<string, string>
): string[] {
  return Array.from(new Set([...Object.keys(zh), ...Object.keys(en)]));
}

/** 逐字对应 addCopyKey 里对 settings.copy 的写入（key 去首尾空格、空键/空文案跳过） */
export function addCopyEntry(
  copy: CopyMap,
  key: string,
  zh: string,
  en: string
): CopyMap {
  const k = (key || "").trim();
  if (!k) return copy;
  if (zh) copy.zh[k] = zh;
  if (en) copy.en[k] = en;
  return copy;
}

/** 逐字对应 removeCopyKey：同时删 zh / en 两个覆盖表的键 */
export function removeCopyEntry(copy: CopyMap, key: string): CopyMap {
  delete copy.zh[key];
  delete copy.en[key];
  return copy;
}

/** 逐字对应 renameCopyKey：搬运值、删旧键，空键/同名不动 */
export function renameCopyEntry(
  copy: CopyMap,
  oldKey: string,
  newKey: string
): CopyMap {
  const k = (newKey || "").trim();
  if (!k || k === oldKey) return copy;
  const zhv = copy.zh[oldKey];
  const env = copy.en[oldKey];
  delete copy.zh[oldKey];
  delete copy.en[oldKey];
  if (zhv !== undefined) copy.zh[k] = zhv;
  if (env !== undefined) copy.en[k] = env;
  return copy;
}

export interface NormalizedSettings {
  theme: any;
  layout: any;
  background: any;
  features: any;
  copy: CopyMap;
  motion: any;
}

/** 逐字对应 loadSettings / import / reset 的六行赋值：theme/layout/background/features 直取，
 *  copy 回退空覆盖表，motion 回退 defaults.motion */
export function normalizeSettings(
  raw: any,
  defaults: { motion: any }
): NormalizedSettings {
  const inc = raw || {};
  return {
    theme: inc.theme,
    layout: inc.layout,
    background: inc.background,
    features: inc.features,
    copy: inc.copy || { zh: {}, en: {} },
    motion: inc.motion || defaults.motion,
  };
}
