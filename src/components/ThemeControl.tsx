'use client';

import { useEffect, useId, useState } from 'react';
import { trackArchiveEvent } from '../lib/analytics';

type Theme = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'balloons-and-bananas:theme';
const isTheme = (value: string | null): value is Theme => value === 'system' || value === 'light' || value === 'dark';

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export default function ThemeControl() {
  const [theme, setTheme] = useState<Theme>('system');
  const id = useId();

  useEffect(() => {
    const activeTheme = document.documentElement.dataset.theme || null;
    let stored: Theme = isTheme(activeTheme) ? activeTheme : 'system';
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      if (isTheme(value)) stored = value;
    } catch {
      // The system preference still works when browser storage is unavailable.
    }
    setTheme(stored);
    applyTheme(stored);

    const syncTheme = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      const next = isTheme(event.newValue) ? event.newValue : 'system';
      setTheme(next);
      applyTheme(next);
    };
    window.addEventListener('storage', syncTheme);
    return () => window.removeEventListener('storage', syncTheme);
  }, []);

  return <div className="theme-control">
    <label htmlFor={id}>Appearance</label>
    <select id={id} value={theme} onChange={event => {
      const next = event.target.value as Theme;
      if (next !== theme) trackArchiveEvent('appearance_changed', { theme: next });
      setTheme(next);
      applyTheme(next);
      try {
        if (next === 'system') window.localStorage.removeItem(STORAGE_KEY);
        else window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // The selected appearance still applies for the current page.
      }
    }}>
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </div>;
}
