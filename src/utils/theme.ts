const THEME_KEY = 'theme';

type Theme = 'light' | 'dark' | 'system';

export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

export function setStoredTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
}

export function getEffectiveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

export function applyTheme(theme: Theme): void {
  const effective = getEffectiveTheme(theme);
  document.documentElement.setAttribute('data-theme', effective);
}

export function initTheme(): void {
  const theme = getStoredTheme();
  applyTheme(theme);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStoredTheme() === 'system') {
      applyTheme('system');
    }
  });
}

export function cycleTheme(): Theme {
  const current = getStoredTheme();
  const order: Theme[] = ['light', 'dark', 'system'];
  const nextIndex = (order.indexOf(current) + 1) % order.length;
  const next = order[nextIndex];
  setStoredTheme(next);
  applyTheme(next);
  return next;
}