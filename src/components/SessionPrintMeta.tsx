'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  buildSessionCitations,
  CORPUS_DOI_ID,
  formatCanonicalCitationUrl,
  formatLocalCalendarDateIso,
  type CitationSessionInput,
} from '../lib/citations';
import { formatPrintSessionHeader, normalizeHttpOrigin } from '../lib/print';

function useResolvedClientOrigin(initialOrigin?: string | null): string | null {
  const explicitOrigin = normalizeHttpOrigin(initialOrigin);
  const [clientOrigin, setClientOrigin] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const browserOrigin = normalizeHttpOrigin(window.location.origin);
    if (browserOrigin && (!explicitOrigin || browserOrigin !== explicitOrigin)) {
      setClientOrigin(browserOrigin);
    } else {
      setClientOrigin(null);
    }
  }, [explicitOrigin]);

  return clientOrigin ?? explicitOrigin;
}

/**
 * Print-only masthead line (`The Seth Tapes · Session <slug>`) plus canonical
 * session page URL. Hidden on screen via `.print-only` (`display: none`) so it
 * adds zero screen or screen-reader clutter while printing cleanly at the top
 * of every session document.
 */
export function SessionPrintHeader({
  slug,
  initialOrigin = null,
}: {
  slug: string;
  initialOrigin?: string | null;
}) {
  const resolvedOrigin = useResolvedClientOrigin(initialOrigin);
  const canonicalUrl = useMemo(
    () => formatCanonicalCitationUrl(slug, null, resolvedOrigin),
    [slug, resolvedOrigin],
  );

  return (
    <div className="print-session-header print-only">
      <p className="print-header-title">{formatPrintSessionHeader(slug)}</p>
      <p className="print-header-url">{canonicalUrl}</p>
    </div>
  );
}

/**
 * Print-only Chicago citation and canonical page URL block rendered between
 * Moments and Transcript on `/sessions/[id]`. Uses the shared `citations.ts`
 * module so provenance qualifiers (`(machine transcription, unreviewed)`),
 * labelled inferred ages, and guide-exclusion rules match the Cite dialog.
 */
export function SessionPrintCitation({
  session,
  initialOrigin = null,
  initialAccessDate,
}: {
  session: CitationSessionInput;
  initialOrigin?: string | null;
  initialAccessDate: string;
}) {
  const resolvedOrigin = useResolvedClientOrigin(initialOrigin);
  const explicitAccessDate = initialAccessDate.trim();
  const [clientAccessDate, setClientAccessDate] = useState<string | null>(null);

  useEffect(() => {
    const localDate = formatLocalCalendarDateIso();
    if (localDate !== explicitAccessDate) {
      setClientAccessDate(localDate);
    } else {
      setClientAccessDate(null);
    }
  }, [explicitAccessDate]);

  const resolvedAccessDate = clientAccessDate ?? explicitAccessDate;

  const citations = useMemo(
    () => buildSessionCitations(session, {
      origin: resolvedOrigin,
      accessDate: resolvedAccessDate,
    }),
    [session, resolvedOrigin, resolvedAccessDate],
  );

  return (
    <section
      className="print-citation-section print-only"
      aria-labelledby="print-citation-heading"
    >
      <div className="section-heading">
        <div>
          <h2 id="print-citation-heading">Citation</h2>
        </div>
      </div>
      <p className="print-citation-text">
        <strong>Chicago: </strong>
        {citations.chicago}
      </p>
      <p className="print-citation-url">
        <strong>Page URL: </strong>
        <code>{citations.url}</code>
      </p>
      <p className="print-citation-note">
        Citation identifies the source transcript and credits the Peters/Wilson corpus
        (TalkBank, DOI <code>{CORPUS_DOI_ID}</code>). AI-written guide text is never cited as speech.
        {citations.isAiDraft
          ? ' Because this transcript is an unreviewed machine draft, check the recording before treating wording as evidence.'
          : ''}
      </p>
    </section>
  );
}
