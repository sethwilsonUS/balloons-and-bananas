'use client';

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { Menu, X } from 'lucide-react';
import { ARCHIVE_NAME } from '../lib/site';
import CassetteReelLogo from './CassetteReelLogo';
import ThemeControl from './ThemeControl';

const NAV_LINKS = [
  { section: 'overview', href: '/', label: 'Overview' },
  { section: 'sessions', href: '/sessions', label: 'Sessions' },
  { section: 'search', href: '/search', label: 'Search' },
  { section: 'research', href: '/research', label: 'Research & context' },
  { section: 'about', href: '/about', label: 'About & methods' },
] as const;

type ActiveSection = (typeof NAV_LINKS)[number]['section'];

export default function RouteHeader({
  activeSection,
}: {
  activeSection?: ActiveSection;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 900px)');
    const handleViewportChange = (event: MediaQueryListEvent) => {
      if (!event.matches) setMenuOpen(false);
    };
    media.addEventListener('change', handleViewportChange);
    return () => media.removeEventListener('change', handleViewportChange);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      const inMenuButton = menuButtonRef.current?.contains(event.target) ?? false;
      const inNav = navRef.current?.contains(event.target) ?? false;
      if (!inMenuButton && !inNav) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpen]);

  const closeMenu = (restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) {
      menuButtonRef.current?.focus();
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!menuOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
    }
  };

  const handleToggleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && menuOpen) {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === 'ArrowDown' && menuOpen) {
      event.preventDefault();
      navRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    }
  };

  const handleHeaderBlur = (event: FocusEvent<HTMLElement>) => {
    if (!menuOpen) return;
    const nextFocused = event.relatedTarget;
    if (!(nextFocused instanceof Node)) return;
    const inMenuButton = menuButtonRef.current?.contains(nextFocused) ?? false;
    const inNav = navRef.current?.contains(nextFocused) ?? false;
    if (!inMenuButton && !inNav) {
      setMenuOpen(false);
    }
  };

  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="site-header" onBlur={handleHeaderBlur}>
        <div className="top-bar">
          <a className="brand-button" href="/" aria-label={`${ARCHIVE_NAME}, collection overview`}>
            <CassetteReelLogo className="brand-logo" />
            <span>{ARCHIVE_NAME}</span>
          </a>
          <button
            ref={menuButtonRef}
            type="button"
            className="button secondary menu-toggle"
            aria-expanded={menuOpen}
            aria-controls={navId}
            onClick={() => setMenuOpen(current => !current)}
            onKeyDown={handleToggleKeyDown}
          >
            {menuOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
            <span>Menu</span>
          </button>
          <nav
            id={navId}
            ref={navRef}
            className={`section-nav${menuOpen ? ' is-open' : ''}`}
            aria-label="Collection sections"
            onKeyDown={handleMenuKeyDown}
          >
            {NAV_LINKS.map(link => (
              <a
                key={link.section}
                href={link.href}
                aria-current={activeSection === link.section ? 'page' : undefined}
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </a>
            ))}
          </nav>
          <ThemeControl />
        </div>
      </header>
    </>
  );
}
