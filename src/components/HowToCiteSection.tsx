'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ACCOMPANYING_PUBLICATIONS,
  AI_DRAFT_QUALIFIER,
  buildSessionCitations,
  CORPUS_CREDIT_LINE,
  CORPUS_DOI_ID,
  CORPUS_DOI_URL,
  CORPUS_TALKBANK_PAGE_URL,
  formatLocalCalendarDateIso,
  type CitationSessionInput,
} from '../lib/citations';
import { CitationPanel } from './CiteControl';

/**
 * Non-archive illustrative example matching the documented BibTeX key pattern
 * (`sethtapes_010626_p42`). Carries no real transcript text or dates.
 */
export const DEFAULT_HOW_TO_CITE_EXAMPLE: CitationSessionInput = {
  slug: '010626',
  ages: ['1;06.26'],
  inferredAge: null,
  dates: [],
  origin: 'archived_research',
};

export const DEFAULT_HOW_TO_CITE_PASSAGE = 42;
const FALLBACK_EXAMPLE_ACCESS_DATE = '2026-01-01';

export interface HowToCiteSectionProps {
  headingLevel?: 2 | 3;
  /** Pass server-resolved request origin on per-request routes to avoid hydration shifts. */
  origin?: string | null;
  /** Pass server-resolved ISO `YYYY-MM-DD` access date on per-request routes to avoid hydration shifts. */
  accessDate?: string;
  exampleSession?: CitationSessionInput;
  examplePassageNumber?: number | null;
}

/**
 * Reusable *How to cite* section for `/about`, powered by the same pure
 * `src/lib/citations.ts` module and accessible `<CitationPanel />` used on
 * session and passage pages.
 */
export default function HowToCiteSection({
  headingLevel = 2,
  origin = null,
  accessDate,
  exampleSession = DEFAULT_HOW_TO_CITE_EXAMPLE,
  examplePassageNumber = DEFAULT_HOW_TO_CITE_PASSAGE,
}: HowToCiteSectionProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const SubHeading = headingLevel === 2 ? 'h3' : 'h4';

  const explicitOrigin = origin?.trim() || null;
  const explicitAccessDate = accessDate?.trim() || null;
  const [clientOrigin, setClientOrigin] = useState<string | null>(null);
  const [clientAccessDate, setClientAccessDate] = useState<string | null>(null);

  useEffect(() => {
    if (!explicitOrigin && typeof window !== 'undefined' && window.location.origin) {
      setClientOrigin(window.location.origin);
    }
    if (!explicitAccessDate) {
      setClientAccessDate(formatLocalCalendarDateIso());
    }
  }, [explicitOrigin, explicitAccessDate]);

  const resolvedOrigin = explicitOrigin ?? clientOrigin;
  const resolvedAccessDate = explicitAccessDate ?? clientAccessDate ?? FALLBACK_EXAMPLE_ACCESS_DATE;

  const exampleCitations = useMemo(
    () => buildSessionCitations(exampleSession, {
      passageNumber: examplePassageNumber,
      origin: resolvedOrigin,
      accessDate: resolvedAccessDate,
    }),
    [exampleSession, examplePassageNumber, resolvedOrigin, resolvedAccessDate],
  );

  const subjectPhrase = examplePassageNumber
    ? `example session ${exampleSession.slug}, passage ${examplePassageNumber}`
    : `example session ${exampleSession.slug}`;

  return (
    <section id="how-to-cite" className="how-to-cite-section" aria-labelledby="how-to-cite-heading">
      <Heading id="how-to-cite-heading">How to cite</Heading>
      <p>
        This collection draws on the <strong>Peters/Wilson corpus in CHILDES</strong>, part of
        TalkBank. Every session page and numbered transcript passage includes a{' '}
        <strong>Cite</strong> button that formats ready-to-copy citations in{' '}
        <strong>Chicago</strong>, <strong>APA</strong>, and <strong>BibTeX</strong>, crediting the
        corpus and preserving transcript provenance and age labels.
      </p>

      <div className="how-to-cite-credit">
        <SubHeading>Corpus credit</SubHeading>
        <p className="how-to-cite-credit-line">{CORPUS_CREDIT_LINE}</p>
        <p className="small muted">
          Persistent identifier:{' '}
          <a
            href={CORPUS_DOI_URL}
            target="_blank"
            rel="noopener noreferrer nofollow"
            referrerPolicy="no-referrer"
          >
            {CORPUS_DOI_URL}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>{' '}
          (DOI <code>{CORPUS_DOI_ID}</code>) ·{' '}
          <a
            href={CORPUS_TALKBANK_PAGE_URL}
            target="_blank"
            rel="noopener noreferrer nofollow"
            referrerPolicy="no-referrer"
          >
            CHILDES Peters/Wilson Corpus page on TalkBank
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      </div>

      <SubHeading>Accompanying publications</SubHeading>
      <p>
        Per TalkBank corpus guidelines, any research or publication drawing on data from the
        Peters/Wilson corpus should also cite one or both of the accompanying studies:
      </p>
      <ul className="how-to-cite-publications">
        {ACCOMPANYING_PUBLICATIONS.map(publication => (
          <li key={publication.id}>
            {publication.citation}{' '}
            <a
              href={publication.doiUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              referrerPolicy="no-referrer"
            >
              {publication.doiUrl}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>

      <SubHeading>Provenance and age rules in citations</SubHeading>
      <ul className="how-to-cite-rules">
        <li>
          <strong>Transcript origin:</strong> Every citation states whether the text comes from an{' '}
          <em>archived research transcript</em>, a <em>TalkBank AI draft</em>, or a{' '}
          <em>local AI draft</em>.
        </li>
        <li>
          <strong>Unreviewed machine drafts:</strong> Citations for TalkBank AI drafts and local AI
          drafts always include <code>{AI_DRAFT_QUALIFIER}</code>. Check the audio recording before
          treating draft wording as evidence.
        </li>
        <li>
          <strong>Ages and dates:</strong> Source ages and filename-inferred ages stay distinct;
          inferred ages are always labelled as inferred. Calendar dates appear only when recorded in
          source metadata and are never inferred.
        </li>
        <li>
          <strong>Guides are not speech:</strong> AI-written session guides (overviews, themes, and
          moments) are navigational companions and are never cited as spoken transcript text.
        </li>
      </ul>

      <SubHeading>Example passage citation</SubHeading>
      <p className="small muted">
        Illustrative format for session <code>{exampleSession.slug}</code>
        {examplePassageNumber ? `, passage ${examplePassageNumber}` : ''} (BibTeX key{' '}
        <code>{exampleCitations.bibtexKey}</code>):
      </p>
      <CitationPanel
        citations={exampleCitations}
        targetKey={`example::${exampleSession.slug}::${examplePassageNumber ?? 'session'}`}
        subjectPhrase={subjectPhrase}
      />
      <p className="small muted how-to-cite-research-link">
        For the full dissertation and published bibliography, see{' '}
        <a href="/research">Research &amp; context</a>.
      </p>
    </section>
  );
}
