'use client';

import { formatAge, INFERRED_AGE_EXPLANATION_DOC_ID } from '../lib/age';
import { trackArchiveEvent } from '../lib/analytics';

/**
 * Display a session's age metadata, keeping source ages and filename-inferred
 * ages visually and semantically distinct. Inferred ages always carry a visible
 * italicized label linking to the explanation document.
 */
export default function SessionAge({ ages, inferredAge, onDocument, showPrefix = true, showChatCode = false }: {
  ages: string[];
  inferredAge: string | null;
  onDocument?: (id: string) => void;
  showPrefix?: boolean;
  showChatCode?: boolean;
}) {
  const prefix = showPrefix ? 'Age ' : '';
  if (ages.length > 0) {
    const formatted = ages.map(formatAge).join(' / ');
    return (
      <span>
        {prefix}
        {formatted}
        {showChatCode && <span className="age-notation">{` (${ages.join(' / ')} · source age)`}</span>}
      </span>
    );
  }
  if (!inferredAge) return null;
  return (
    <span className="inferred-age">
      {prefix}
      {formatAge(inferredAge)}
      {showChatCode && <span className="age-notation">{` (${inferredAge})`}</span>}{' '}
      <a
        className="inferred-age-link"
        href={`/?document=${encodeURIComponent(INFERRED_AGE_EXPLANATION_DOC_ID)}`}
        onClick={event => {
          trackArchiveEvent('research_open', { documentId: INFERRED_AGE_EXPLANATION_DOC_ID, action: 'read' });
          if (!onDocument || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
            return;
          }
          event.preventDefault();
          onDocument(INFERRED_AGE_EXPLANATION_DOC_ID);
        }}
        onAuxClick={event => {
          if (event.button === 1) {
            trackArchiveEvent('research_open', { documentId: INFERRED_AGE_EXPLANATION_DOC_ID, action: 'read' });
          }
        }}
      >
        <em>(inferred from filename)</em>
        <span className="sr-only"> — learn how ages are inferred</span>
      </a>
    </span>
  );
}
