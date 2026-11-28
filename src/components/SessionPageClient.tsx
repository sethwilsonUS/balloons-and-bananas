'use client';

import { type ReactNode, useEffect } from 'react';
import { trackArchiveEvent } from '../lib/analytics';
import type { Session } from '../lib/types';
import ArchiveAnalytics from './ArchiveAnalytics';
import { SessionBody, SessionSources } from './SessionDetail';

export default function SessionPageClient({
  session,
  printCitation,
}: {
  session: Session;
  printCitation?: ReactNode;
}) {
  useEffect(() => {
    trackArchiveEvent('recording_view', { recordingId: session.id, origin: session.origin });
  }, [session.id, session.origin]);

  return (
    <>
      <ArchiveAnalytics ready section="sessions" sessionId={session.id} documentId={null} />
      <SessionBody key={session.id} session={session} printCitation={printCitation} />
      <SessionSources session={session} />
    </>
  );
}
