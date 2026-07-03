import zh from '../i18n/zh.json';
import en from '../i18n/en.json';

type Locale = 'zh' | 'en';
type TranslationKeys = keyof typeof zh;

const messages: Record<Locale, Record<string, string>> = { zh, en };

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
  let text = messages[currentLocale]?.[key] || messages.zh?.[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}