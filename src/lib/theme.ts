import { browser } from '$app/environment';

export type Theme = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'daily-work-log-theme';

export function getStoredTheme(): Theme {
  if (!browser) return 'system';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

function getEffectiveDark(): boolean {
  if (!browser) return false;
  const theme = getStoredTheme();
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(dark: boolean) {
  if (!browser) return;
  document.documentElement.classList.toggle('dark', dark);
}

export function setTheme(value: Theme) {
  if (!browser) return;
  localStorage.setItem(STORAGE_KEY, value);
  applyTheme(getEffectiveDark());
}

if (browser) {
  applyTheme(getEffectiveDark());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStoredTheme() === 'system') {
      applyTheme(getEffectiveDark());
    }
  });
}
