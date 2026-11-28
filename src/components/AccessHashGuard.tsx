'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { stripAccessFromHash } from '../lib/legacy-redirects';

export function stripAccessHashFromWindow(): { changed: boolean; nextHash: string; oldUrl: string; newUrl: string } {
  if (typeof window === 'undefined') {
    return { changed: false, nextHash: '', oldUrl: '', newUrl: '' };
  }
  const nextHash = stripAccessFromHash(window.location.hash);
  if (nextHash === null) {
    return { changed: false, nextHash: window.location.hash, oldUrl: window.location.href, newUrl: window.location.href };
  }
  const oldUrl = window.location.href;
  try {
    const clean = new URL(oldUrl);
    clean.hash = nextHash;
    window.history.replaceState(window.history.state, '', clean.href);
    return { changed: true, nextHash, oldUrl, newUrl: clean.href };
  } catch {
    return { changed: false, nextHash: window.location.hash, oldUrl, newUrl: oldUrl };
  }
}

/**
 * Global client guard mounted in the root layout so obsolete `#access=...`
 * fragments are stripped on every route, client-side navigation, `hashchange`,
 * and `popstate`, while preserving all other fragments (`#pN`, `#t=`, `#inferred-ages`, etc.).
 */
export default function AccessHashGuard() {
  const pathname = usePathname();

  useEffect(() => {
    const result = stripAccessHashFromWindow();
    if (result.changed && result.nextHash) {
      if (typeof HashChangeEvent === 'function') {
        window.dispatchEvent(new HashChangeEvent('hashchange', {
          oldURL: result.oldUrl,
          newURL: result.newUrl,
        }));
      } else {
        window.dispatchEvent(new Event('hashchange'));
      }
    }
  }, [pathname]);

  useEffect(() => {
    const stripAndNotify = () => {
      const result = stripAccessHashFromWindow();
      if (result.changed && result.nextHash) {
        if (typeof HashChangeEvent === 'function') {
          window.dispatchEvent(new HashChangeEvent('hashchange', {
            oldURL: result.oldUrl,
            newURL: result.newUrl,
          }));
        } else {
          window.dispatchEvent(new Event('hashchange'));
        }
      }
    };
    window.addEventListener('hashchange', stripAndNotify);
    window.addEventListener('popstate', stripAndNotify);
    return () => {
      window.removeEventListener('hashchange', stripAndNotify);
      window.removeEventListener('popstate', stripAndNotify);
    };
  }, []);

  return null;
}
