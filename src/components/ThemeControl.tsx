'use client';

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { Check, Moon, Sun, SunMoon } from 'lucide-react';
import { trackArchiveEvent } from '../lib/analytics';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'balloons-and-bananas:theme';
const THEME_OPTIONS: readonly { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];
const THEME_LABELS: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

const isTheme = (value: string | null): value is Theme =>
  value === 'system' || value === 'light' || value === 'dark';

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

function ThemeIcon({ theme, size = 18 }: { theme: Theme; size?: number }) {
  if (theme === 'light') return <Sun size={size} aria-hidden="true" />;
  if (theme === 'dark') return <Moon size={size} aria-hidden="true" />;
  return <SunMoon size={size} aria-hidden="true" />;
}

export default function ThemeControl() {
  const [theme, setTheme] = useState<Theme>('system');
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pendingFocusIndexRef = useRef<number | null>(null);

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
      setAnnouncement('');
      applyTheme(next);
    };
    window.addEventListener('storage', syncTheme);
    return () => window.removeEventListener('storage', syncTheme);
  }, []);

  useEffect(() => {
    if (!open) return;

    const targetIndex = pendingFocusIndexRef.current;
    pendingFocusIndexRef.current = null;
    if (targetIndex !== null) {
      itemRefs.current[targetIndex]?.focus();
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const openMenuAt = (index: number) => {
    if (open) {
      itemRefs.current[index]?.focus();
      return;
    }
    setAnnouncement('');
    pendingFocusIndexRef.current = index;
    setOpen(true);
  };

  const closeMenu = (restoreFocus: boolean) => {
    pendingFocusIndexRef.current = null;
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  };

  const selectTheme = (next: Theme) => {
    const changed = next !== theme;
    if (changed) {
      trackArchiveEvent('appearance_changed', { theme: next });
      setAnnouncement(`Appearance set to ${THEME_LABELS[next]}.`);
    }
    setTheme(next);
    applyTheme(next);
    try {
      if (next === 'system') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The selected appearance still applies for the current page.
    }
    closeMenu(true);
  };

  const handleTriggerClick = () => {
    if (open) {
      closeMenu(false);
    } else {
      const currentIndex = THEME_OPTIONS.findIndex(option => option.value === theme);
      openMenuAt(currentIndex >= 0 ? currentIndex : 0);
    }
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openMenuAt(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openMenuAt(THEME_OPTIONS.length - 1);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    }
  };

  const handleItemKeyDown = (index: number, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      itemRefs.current[(index + 1) % THEME_OPTIONS.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      itemRefs.current[(index - 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      itemRefs.current[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      itemRefs.current[THEME_OPTIONS.length - 1]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    }
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!open) return;
    const nextFocused = event.relatedTarget;
    if (nextFocused instanceof Node && !containerRef.current?.contains(nextFocused)) {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="theme-control" onBlur={handleBlur}>
      <button
        ref={triggerRef}
        type="button"
        className="button secondary theme-toggle"
        aria-label={`Appearance: ${THEME_LABELS[theme]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
      >
        <ThemeIcon theme={theme} size={18} />
      </button>
      <div
        id={menuId}
        role="menu"
        aria-label="Appearance"
        className="theme-menu"
        hidden={!open}
      >
        {THEME_OPTIONS.map((option, index) => {
          const checked = theme === option.value;
          return (
            <button
              key={option.value}
              ref={el => { itemRefs.current[index] = el; }}
              type="button"
              role="menuitemradio"
              aria-checked={checked}
              className="theme-menu-item"
              onClick={() => selectTheme(option.value)}
              onKeyDown={event => handleItemKeyDown(index, event)}
            >
              <ThemeIcon theme={option.value} size={16} />
              <span>{option.label}</span>
              {checked && <Check size={15} className="theme-menu-check" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </div>
  );
}
