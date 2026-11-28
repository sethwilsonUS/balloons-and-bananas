import { Headphones } from 'lucide-react';
import type { CitationSessionInput } from '../lib/citations';
import type { SessionAudioStatus } from '../lib/sessions-browse';
import type { Recording, TranscriptOrigin } from '../lib/types';
import { timeLabel, transcriptOriginLabels } from './api';
import { CiteSessionButton } from './CiteControl';
import SessionAge from './SessionAge';

export type CatalogRecordVariant = 'full' | 'card' | 'compact';

export interface CatalogRecordProps {
  variant: CatalogRecordVariant;
  slug: string;
  sourceName?: string;
  ages: string[];
  inferredAge: string | null;
  dates: string[];
  origin: TranscriptOrigin;
  recordings?: Recording[];
  audioStatus?: SessionAudioStatus;
  momentsCount?: number;
  citation?: CitationSessionInput;
  ariaLabel?: string;
}

export function formatRecordingEntry(recording: Recording): string {
  const format = recording.format.toUpperCase();
  const kindLabel = recording.kind === 'listening-copy'
    ? `${format} listening copy`
    : `Original ${format}`;
  const durationLabel = Number.isFinite(recording.duration) && recording.duration > 0
    ? timeLabel(recording.duration)
    : 'duration unrecorded';
  return `${kindLabel} · ${durationLabel}`;
}

export function formatAudioAvailability(status: SessionAudioStatus): string {
  if (status === 'mp3') return 'MP3 playback available';
  if (status === 'no-mp3') return 'MP3 playback not yet available';
  return 'Transcript only';
}

/**
 * Shared semantic `<dl>` catalog record used across session pages (`full`),
 * browse/search cards (`card`), and compact list rows (`compact`).
 *
 * Explicit spaces are preserved between `<dt>`, `<dd>`, and adjacent rows so
 * screen readers (VoiceOver) and flat text extraction never concatenate words
 * or digits across cell boundaries.
 */
export default function CatalogRecord({
  variant,
  slug,
  sourceName,
  ages,
  inferredAge,
  dates,
  origin,
  recordings,
  audioStatus,
  momentsCount,
  citation,
  ariaLabel,
}: CatalogRecordProps) {
  const isFull = variant === 'full';
  const hasAge = ages.length > 0 || Boolean(inferredAge);
  const identifierLabel = isFull ? 'Session ID' : 'Source';
  const identifierValue = isFull ? slug : (sourceName || slug);
  const resolvedAriaLabel = ariaLabel ?? (
    isFull ? 'Session catalog record' : `Catalog metadata for session ${slug}`
  );
  const className = isFull
    ? 'catalog-record catalog-record--full'
    : `catalog-record catalog-record--${variant} session-meta`;

  return (
    <dl className={className} aria-label={resolvedAriaLabel}>
      <div className="catalog-record-row">
        <dt>{identifierLabel}</dt>
        {' '}
        <dd><code className="catalog-session-id">{identifierValue}</code></dd>
      </div>
      {' '}
      <div className="catalog-record-row">
        <dt>Age</dt>
        {' '}
        <dd>
          {hasAge ? (
            <SessionAge ages={ages} inferredAge={inferredAge} showPrefix={false} showChatCode={isFull} />
          ) : (
            <span className="muted">Not recorded</span>
          )}
        </dd>
      </div>
      {dates.length > 0 && (
        <>
          {' '}
          <div className="catalog-record-row">
            <dt>Date</dt>
            {' '}
            <dd>{dates.join(' / ')}</dd>
          </div>
        </>
      )}
      {' '}
      <div className="catalog-record-row catalog-record-origin">
        <dt>Transcript origin</dt>
        {' '}
        <dd className="catalog-origin-cell">
          <span className={`origin-badge ${origin}`}>{transcriptOriginLabels[origin]}</span>
          {origin !== 'archived_research' && (
            <>
              {' '}
              <span className="catalog-meta-note">Unreviewed machine draft</span>
            </>
          )}
        </dd>
      </div>
      {isFull && recordings !== undefined && (
        <>
          {' '}
          <div className="catalog-record-row">
            <dt>Recordings</dt>
            {' '}
            <dd>
              {recordings.length === 0 ? (
                <span className="muted">None associated (transcript only)</span>
              ) : recordings.length === 1 ? (
                <span>{formatRecordingEntry(recordings[0])}</span>
              ) : (
                <ul className="catalog-recordings-list">
                  {recordings.map(recording => (
                    <li key={recording.id}>{formatRecordingEntry(recording)}</li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </>
      )}
      {!isFull && audioStatus !== undefined && (
        <>
          {' '}
          <div className="catalog-record-row catalog-record-audio">
            <dt>Audio</dt>
            {' '}
            <dd className="catalog-audio-cell">
              <Headphones size={15} aria-hidden="true" />
              {' '}
              <span>{formatAudioAvailability(audioStatus)}</span>
            </dd>
          </div>
        </>
      )}
      {isFull && momentsCount !== undefined && (
        <>
          {' '}
          <div className="catalog-record-row">
            <dt>Guide</dt>
            {' '}
            <dd className="catalog-guide-cell">
              <span className="catalog-guide-label">AI-written guide</span>
              {' '}
              <span className="catalog-meta-sep" aria-hidden="true">·</span>
              {' '}
              <span className="catalog-meta-note">
                {momentsCount} {momentsCount === 1 ? 'moment' : 'moments'}
              </span>
            </dd>
          </div>
        </>
      )}
      {isFull && citation && (
        <>
          {' '}
          <div className="catalog-record-row catalog-cite-row">
            <dt>Citation</dt>
            {' '}
            <dd className="catalog-cite-cell">
              <CiteSessionButton session={citation} />
              {' '}
              <span className="catalog-meta-note">Chicago, APA, and BibTeX</span>
            </dd>
          </div>
        </>
      )}
    </dl>
  );
}
