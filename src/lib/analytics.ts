'use client';

import { inject, pageview, track } from '@vercel/analytics';
import { ANALYTICS_ORIGIN, sanitizeAnalyticsUrl, sanitizeArchiveEvent, type AnalyticsPath, type ArchiveEventName } from './analytics-policy';

let enabled = false;
let lastPageKey: string | null = null;

export function enableArchiveAnalytics(): boolean {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'production' || window.location.origin !== ANALYTICS_ORIGIN) return false;
  try {
    enabled = true;
    inject({
      mode: 'production', debug: false, disableAutoTrack: true,
      scriptSrc: '/_vercel/insights/script.js',
      viewEndpoint: '/api/analytics/view', eventEndpoint: '/api/analytics/event',
      // Unknown SDK endpoints (identify, group, cookies) are not implemented.
      endpoint: '/api/analytics',
      beforeSend: event => enabled ? { ...event, url: sanitizeAnalyticsUrl(event.url) } : null,
    });
    return true;
  } catch {
    enabled = false;
    return false;
  }
}

export function disableArchiveAnalytics(): void {
  enabled = false;
  lastPageKey = null;
}

export function trackArchivePage(path: AnalyticsPath, pageKey: string): void {
  if (!enabled) return;
  if (lastPageKey === pageKey) return;
  lastPageKey = pageKey;
  try { pageview({ route: path, path }); } catch { /* Analytics never blocks reading. */ }
}

export function trackArchiveEvent(name: ArchiveEventName, properties: Record<string, unknown>): void {
  if (!enabled) return;
  try {
    const event = sanitizeArchiveEvent(name, properties);
    if (event) track(event.name, event.properties);
  } catch { /* A blocked/unavailable SDK must not interrupt the action. */ }
}
