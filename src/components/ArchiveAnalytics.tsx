'use client';

import { useEffect } from 'react';
import { disableArchiveAnalytics, enableArchiveAnalytics, trackArchivePage } from '../lib/analytics';
import type { AnalyticsPath } from '../lib/analytics-policy';

export default function ArchiveAnalytics({ ready, section, entryId, documentId }: {
  ready: boolean;
  section: 'overview' | 'recordings' | 'research';
  entryId: string | null;
  documentId: string | null;
}) {
  useEffect(() => {
    if (ready) enableArchiveAnalytics();
    return disableArchiveAnalytics;
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const path: AnalyticsPath = entryId ? '/recording' : documentId ? '/document' : `/${section}`;
    // The key only deduplicates in memory; recording/document IDs are not URLs.
    trackArchivePage(path, `${path}:${entryId ?? documentId ?? ''}`);
  }, [ready, section, entryId, documentId]);
  return null;
}
