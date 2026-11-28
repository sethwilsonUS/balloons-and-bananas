import type { Recording, Session } from '../lib/types';
import { timeLabel, transcriptOriginLabels } from './api';
import { CiteSessionButton } from './CiteControl';
import SessionAge from './SessionAge';

function formatRecordingEntry(recording: Recording): string {
  const format = recording.format.toUpperCase();
  const kindLabel = recording.kind === 'listening-copy'
    ? `${format} listening copy`
    : `Original ${format}`;
  const durationLabel = Number.isFinite(recording.duration) && recording.duration > 0
    ? timeLabel(recording.duration)
    : 'duration unrecorded';
  return `${kindLabel} · ${durationLabel}`;
}

export default function SessionCatalogRecord({ session }: { session: Session }) {
  const hasAge = session.ages.length > 0 || Boolean(session.inferredAge);

  return (
    <dl className="catalog-record" aria-label="Session catalog record">
      <div className="catalog-record-row">
        <dt>Session ID</dt>
        <dd><code className="catalog-session-id">{session.slug}</code></dd>
      </div>
      <div className="catalog-record-row">
        <dt>Age</dt>
        <dd>
          {hasAge ? (
            <SessionAge ages={session.ages} inferredAge={session.inferredAge} showPrefix={false} showChatCode />
          ) : (
            <span className="muted">Not recorded</span>
          )}
        </dd>
      </div>
      {session.dates.length > 0 && (
        <div className="catalog-record-row">
          <dt>Date</dt>
          <dd>{session.dates.join(' / ')}</dd>
        </div>
      )}
      <div className="catalog-record-row">
        <dt>Transcript origin</dt>
        <dd className="catalog-origin-cell">
          <span className={`origin-badge ${session.origin}`}>{transcriptOriginLabels[session.origin]}</span>
          {session.origin !== 'archived_research' && (
            <span className="small muted">Unreviewed machine draft</span>
          )}
        </dd>
      </div>
      <div className="catalog-record-row">
        <dt>Recordings</dt>
        <dd>
          {session.recordings.length === 0 ? (
            <span className="muted">None associated (transcript only)</span>
          ) : session.recordings.length === 1 ? (
            <span>{formatRecordingEntry(session.recordings[0])}</span>
          ) : (
            <ul className="catalog-recordings-list">
              {session.recordings.map(recording => (
                <li key={recording.id}>{formatRecordingEntry(recording)}</li>
              ))}
            </ul>
          )}
        </dd>
      </div>
      <div className="catalog-record-row">
        <dt>Guide</dt>
        <dd className="catalog-guide-cell">
          <span className="ai-badge">AI-written guide</span>
          <span className="small muted">
            {session.moments.length} {session.moments.length === 1 ? 'moment' : 'moments'}
          </span>
        </dd>
      </div>
      <div className="catalog-record-row catalog-cite-row">
        <dt>Citation</dt>
        <dd className="catalog-cite-cell">
          <CiteSessionButton
            session={{
              slug: session.slug,
              ages: session.ages,
              inferredAge: session.inferredAge,
              dates: session.dates,
              origin: session.origin,
            }}
          />{' '}
          <span className="small muted">Chicago, APA, and BibTeX</span>
        </dd>
      </div>
    </dl>
  );
}
