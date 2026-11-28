'use client';

import { useEffect } from 'react';
import { disableArchiveAnalytics, enableArchiveAnalytics, trackArchivePage } from '../lib/analytics';
import type { AnalyticsPath } from '../lib/analytics-policy';

export default function ArchiveAnalytics({ ready, section, sessionId, documentId }: {
  ready: boolean;
  section: 'overview' | 'sessions' | 'search' | 'research' | 'about';
  sessionId: string | null;
  documentId: string | null;
}) {
  useEffect(() => {
    if (ready) enableArchiveAnalytics();
    return disableArchiveAnalytics;
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    // Analytics virtual paths keep '/recordings' and '/recording' unchanged per the telemetry contract.
    const sectionPath: AnalyticsPath = section === 'sessions' ? '/recordings' : `/${section}`;
    const path: AnalyticsPath = sessionId ? '/recording' : documentId ? '/document' : sectionPath;
    // The key only deduplicates in memory; session/document IDs are not URLs.
    trackArchivePage(path, `${path}:${sessionId ?? documentId ?? ''}`);
  }, [ready, section, sessionId, documentId]);
  return null;
}
