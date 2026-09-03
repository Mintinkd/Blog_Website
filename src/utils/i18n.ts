import zh from '../i18n/zh.json';
import en from '../i18n/en.json';

type Locale = 'zh' | 'en';
type TranslationKeys = keyof typeof zh;

const messages: Record<Locale, Record<string, string>> = { zh, en };

/** 后台文案覆盖层（来自可视化配置中心），按 locale 分别存储 */
let overrides: Record<Locale, Record<string, string>> = { zh: {}, en: {} };

let currentLocale: Locale = 'zh';

export function initLocale(): Locale {
  const stored = localStorage.getItem('locale') as Locale | null;
  if (stored && messages[stored]) {
    currentLocale = stored;
  } else {
    const browserLang = navigator.language.toLowerCase();
    currentLocale = browserLang.startsWith('zh') ? 'zh' : 'en';
  }
  document.documentElement.setAttribute('data-locale', currentLocale);
  return currentLocale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  if (messages[locale]) {
    currentLocale = locale;
    localStorage.setItem('locale', locale);
    document.documentElement.setAttribute('data-locale', locale);
    document.dispatchEvent(new CustomEvent('locale-changed', { detail: locale }));
  }
}

export function t(key: string, params?: Record<string, string | number>): string {
  let text =
    overrides[currentLocale]?.[key] ||
    messages[currentLocale]?.[key] ||
    messages.zh?.[key] ||
    key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}

/** 整体替换文案覆盖层（来自可视化配置中心）。传空对象即可清空覆盖。 */
export function setOverrides(o?: { zh?: Record<string, string>; en?: Record<string, string> }): void {
  overrides = {
    zh: { ...(o?.zh || {}) },
    en: { ...(o?.en || {}) },
  };
}

/** 用当前 locale 的文案（含覆盖层）刷新页面上所有 [data-i18n] / [data-i18n-placeholder] 元素 */
export function refreshDomTranslations(): void {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.setAttribute('placeholder', t(key));
  });
}