import { formatAge, INFERRED_AGE_EXPLANATION_DOC_ID } from '../lib/age';
import { trackArchiveEvent } from '../lib/analytics';

/**
 * Display a session's age metadata, keeping source ages and filename-inferred
 * ages visually and semantically distinct. Inferred ages always carry a visible
 * italicized label linking to the explanation document.
 */
export default function SessionAge({ ages, inferredAge, onDocument }: {
  ages: string[];
  inferredAge: string | null;
  onDocument: (id: string) => void;
}) {
  if (ages.length > 0) {
    return <span>Age {ages.map(formatAge).join(' / ')}</span>;
  }
  if (!inferredAge) return null;
  return (
    <span className="inferred-age">
      Age {formatAge(inferredAge)}{' '}
      <a
        className="inferred-age-link"
        href={`/?document=${encodeURIComponent(INFERRED_AGE_EXPLANATION_DOC_ID)}`}
        onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
            trackArchiveEvent('research_open', { documentId: INFERRED_AGE_EXPLANATION_DOC_ID, action: 'read' });
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
