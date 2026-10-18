/**
 * 生成物 —— 双端设置白名单规则（issue #27 / ADR 0001）。禁止手工编辑。
 *
 * 单一事实源：仓库根 settings.rules.json（手写规则描述符，词汇表见 GLOSSARY.md）。
 * 本文件由 npm run gen:settings（scripts/generate-settings-rules.mjs）生成：
 * 根包 src/generated/settings-rules.ts 与 worker/src/generated/settings-rules.ts
 * 内容字节一致，两侧校验逻辑只消费本模块，不得在任何一处手抄规则值。
 * 漂移修复流程：改描述符 → npm run gen:settings → 描述符与生成物一并提交。
 * CI 漂移断言：重新生成 → git diff 必须为空（.github/workflows/deploy.yml）。
 */

export type SettingsRule =
  | { kind: "string"; patterns: readonly string[] }
  | { kind: "number"; min: number; max: number }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "bool" }
  | { kind: "copy"; cap: number };

export const PATTERNS: Readonly<Record<string, RegExp>> = {
  hexColor: new RegExp("^#[0-9a-fA-F]{3,8}$"),
  size: new RegExp("^\\d{1,4}(px|rem|em|%)$"),
  /** 站内相对路径（媒体库/静态资源） */
  localPath: new RegExp("^\\/[A-Za-z0-9\\-._~/%]+$"),
  /** 仅 https 外链；字符集排除引号/尖括号/反斜杠/圆括号，杜绝 CSS 字符串逃逸与标签闭合 */
  httpsUrl: new RegExp("^https:\\/\\/[A-Za-z0-9\\-._~:/?#@!$&*+,;=%]+$"),
};

/** 扁平规则表：叶级设置路径 → 规则；插入顺序 = 描述符分区顺序（写侧报错路径顺序随之） */
export const SETTINGS_RULES: Readonly<Record<string, SettingsRule>> = {
  "theme.light.accent": { kind: "string", patterns: ["hexColor"] },
  "theme.light.accentHover": { kind: "string", patterns: ["hexColor"] },
  "theme.light.bgPrimary": { kind: "string", patterns: ["hexColor"] },
  "theme.light.bgSecondary": { kind: "string", patterns: ["hexColor"] },
  "theme.light.bgTertiary": { kind: "string", patterns: ["hexColor"] },
  "theme.light.textPrimary": { kind: "string", patterns: ["hexColor"] },
  "theme.light.textSecondary": { kind: "string", patterns: ["hexColor"] },
  "theme.light.textTertiary": { kind: "string", patterns: ["hexColor"] },
  "theme.light.border": { kind: "string", patterns: ["hexColor"] },
  "theme.light.borderLight": { kind: "string", patterns: ["hexColor"] },
  "theme.dark.accent": { kind: "string", patterns: ["hexColor"] },
  "theme.dark.accentHover": { kind: "string", patterns: ["hexColor"] },
  "theme.dark.bgPrimary": { kind: "string", patterns: ["hexColor"] },
  "theme.dark.bgSecondary": { kind: "string", patterns: ["hexColor"] },
  "theme.dark.bgTertiary": { kind: "string", patterns: ["hexColor"] },
  "theme.dark.textPrimary": { kind: "string", patterns: ["hexColor"] },
  "theme.dark.textSecondary": { kind: "string", patterns: ["hexColor"] },
  "theme.dark.textTertiary": { kind: "string", patterns: ["hexColor"] },
  "theme.dark.border": { kind: "string", patterns: ["hexColor"] },
  "theme.dark.borderLight": { kind: "string", patterns: ["hexColor"] },
  "layout.contentMaxWidth": { kind: "string", patterns: ["size"] },
  "layout.headerHeight": { kind: "string", patterns: ["size"] },
  "layout.radiusSm": { kind: "string", patterns: ["size"] },
  "layout.radiusMd": { kind: "string", patterns: ["size"] },
  "layout.radiusLg": { kind: "string", patterns: ["size"] },
  "background.bgImage": { kind: "string", patterns: ["localPath", "httpsUrl"] },
  "background.bgOpacity": { kind: "number", min: 0, max: 1 },
  "background.bgBlur": { kind: "number", min: 0, max: 30 },
  "background.bgBrightness": { kind: "number", min: 0.7, max: 1.3 },
  "features.comments": { kind: "bool" },
  "features.likes": { kind: "bool" },
  "features.friendLinks": { kind: "bool" },
  "features.search": { kind: "bool" },
  "features.rss": { kind: "bool" },
  "features.darkMode": { kind: "bool" },
  "features.i18n": { kind: "bool" },
  "motion.intensity": { kind: "enum", values: ["normal", "reduced", "off"] },
  "motion.parallax": { kind: "bool" },
  "motion.parallaxSpeed": { kind: "number", min: 0, max: 0.1 },
  "copy.zh": { kind: "copy", cap: 2000 },
  "copy.en": { kind: "copy", cap: 2000 },
};
