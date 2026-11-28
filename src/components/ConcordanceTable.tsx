'use client';

import { trackArchiveEvent } from '../lib/analytics';
import { buildSessionHrefFromSearch } from '../lib/search-params';
import type { ConcordanceResponse, TranscriptOrigin } from '../lib/types';
import SessionAge from './SessionAge';

const concordanceOriginLabels: Record<TranscriptOrigin, string> = {
  archived_research: 'Archived research',
  talkbank_ai_draft: 'TalkBank AI draft (unreviewed)',
  local_ai_draft: 'Local AI draft (unreviewed)',
};

function formatConcordanceCaption(concordance: ConcordanceResponse): string {
  const { total, sessionCount, page, pages, pageSize } = concordance;
  const passageWord = total === 1 ? 'passage' : 'passages';
  const sessionWord = sessionCount === 1 ? 'session' : 'sessions';
  if (pages > 1) {
    const first = (page - 1) * pageSize + 1;
    const last = Math.min(page * pageSize, total);
    return `Concordance of exact transcript matches: showing passages ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} across ${sessionCount.toLocaleString()} ${sessionWord} (page ${page} of ${pages}), ordered by child age (youngest first).`;
  }
  return `Concordance of exact transcript matches: ${total.toLocaleString()} ${passageWord} across ${sessionCount.toLocaleString()} ${sessionWord}, ordered by child age (youngest first).`;
}

export default function ConcordanceTable({
  concordance,
  returnTo,
  onBeforeSessionNavigate,
}: {
  concordance: ConcordanceResponse;
  returnTo?: string;
  onBeforeSessionNavigate?: () => void;
}) {
  if (!concordance.rows.length) return null;

  return (
    <div
      className="concordance-scroll"
      role="region"
      aria-label="Concordance table"
      tabIndex={0}
    >
      <table className="concordance-table">
        <caption className="concordance-caption">
          {formatConcordanceCaption(concordance)}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="concordance-col-session">Session</th>
            <th scope="col" className="concordance-col-age">Age</th>
            <th scope="col" className="concordance-col-speaker">Speaker</th>
            <th scope="col" className="concordance-col-left">Left context</th>
            <th scope="col" className="concordance-col-match">Match</th>
            <th scope="col" className="concordance-col-right">Right context</th>
          </tr>
        </thead>
        <tbody>
          {concordance.rows.map(row => {
            const href = buildSessionHrefFromSearch(row.sessionSlug, {
              passage: row.passageNumber,
              returnTo,
            });
            const openProperties = {
              recordingId: row.sessionId,
              origin: row.origin,
              view: 'concordance' as const,
              action: 'passage' as const,
              passage: row.passageNumber,
            };
            const hasAge = row.ages.length > 0 || Boolean(row.inferredAge);

            return (
              <tr key={`${row.sessionId}-p${row.passageNumber}`}>
                <th scope="row" className="concordance-session-cell">
                  <a
                    className="concordance-session-link"
                    href={href}
                    onClick={() => {
                      onBeforeSessionNavigate?.();
                      trackArchiveEvent('recording_open', openProperties);
                    }}
                    onAuxClick={event => {
                      if (event.button === 1) {
                        trackArchiveEvent('recording_open', openProperties);
                      }
                    }}
                  >
                    <span className="concordance-session-id">
                      {row.sessionSlug}
                      {', '}
                      passage {row.passageNumber}
                    </span>
                    {' '}
                    <span className="concordance-session-title">{row.sessionTitle}</span>
                  </a>
                  {' '}
                  <span className={`origin-badge concordance-origin ${row.origin}`}>
                    {concordanceOriginLabels[row.origin]}
                  </span>
                </th>
                <td className="concordance-age-cell">
                  {hasAge ? (
                    <SessionAge ages={row.ages} inferredAge={row.inferredAge} showPrefix={false} />
                  ) : (
                    <span className="muted">Not recorded</span>
                  )}
                </td>
                <td className="concordance-speaker-cell">
                  {row.speaker ? row.speaker : <span className="muted">Unidentified</span>}
                </td>
                <td className="concordance-left">
                  {row.leftContext ? (
                    row.leftContext
                  ) : (
                    <>
                      <span className="muted" aria-hidden="true">—</span>
                      <span className="sr-only">Start of passage</span>
                    </>
                  )}
                </td>
                <td className="concordance-match">
                  <mark>{row.match}</mark>
                </td>
                <td className="concordance-right">
                  {row.rightContext ? (
                    row.rightContext
                  ) : (
                    <>
                      <span className="muted" aria-hidden="true">—</span>
                      <span className="sr-only">End of passage</span>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
