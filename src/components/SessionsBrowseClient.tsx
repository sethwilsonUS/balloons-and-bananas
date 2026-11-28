'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { trackArchiveEvent } from '../lib/analytics';
import { shortOverview, type SessionView } from '../lib/results-view';
import {
  buildSessionsUrl,
  computeBandBarPercent,
  countSessionsByOrigin,
  filterBrowseSessions,
  formatSessionsBrowseStatus,
  groupSessionsByAgeBand,
  parseAgeBandHash,
  parseOriginParam,
  parseStoredView,
  VALID_TRANSCRIPT_ORIGINS,
  VIEW_STORAGE_KEY,
  type SessionBrowseItem,
} from '../lib/sessions-browse';
import type { TranscriptOrigin } from '../lib/types';
import ArchiveAnalytics from './ArchiveAnalytics';
import CatalogRecord from './CatalogRecord';
import { TopicLabels } from './TopicThemes';
import { transcriptOriginLabels } from './api';

export default function SessionsBrowseClient({
  sessions,
  initialOrigin,
}: {
  sessions: SessionBrowseItem[];
  initialOrigin: TranscriptOrigin | '';
}) {
  const [origin, setOrigin] = useState<TranscriptOrigin | ''>(initialOrigin);
  const [view, setView] = useState<SessionView>('details');
  const [activeBandKey, setActiveBandKey] = useState<string>('');
  const userChangedViewRef = useRef(false);

  useEffect(() => {
    setOrigin(initialOrigin);
    setActiveBandKey(parseAgeBandHash(window.location.hash));
  }, [initialOrigin]);

  useEffect(() => {
    if (userChangedViewRef.current) return;
    try {
      const stored = parseStoredView(window.localStorage.getItem(VIEW_STORAGE_KEY));
      if (stored) setView(stored);
    } catch {
      // Details remains the default when browser preferences are unavailable.
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      setOrigin(parseOriginParam(params.get('origin') ?? undefined));
      setActiveBandKey(parseAgeBandHash(window.location.hash));
    };
    const onHashChange = () => {
      setActiveBandKey(parseAgeBandHash(window.location.hash));
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const originCounts = useMemo(() => countSessionsByOrigin(sessions), [sessions]);
  const filteredSessions = useMemo(
    () => filterBrowseSessions(sessions, origin),
    [sessions, origin],
  );
  const ageBands = useMemo(
    () => groupSessionsByAgeBand(filteredSessions),
    [filteredSessions],
  );
  const maxBandCount = useMemo(
    () => ageBands.reduce((max, band) => Math.max(max, band.sessions.length), 0),
    [ageBands],
  );
  const effectiveActiveBandKey = useMemo(
    () => (ageBands.some(band => band.key === activeBandKey) ? activeBandKey : ''),
    [ageBands, activeBandKey],
  );

  const handleOriginChange = (next: TranscriptOrigin | '') => {
    if (next === origin) return;
    const nextFiltered = filterBrowseSessions(sessions, next);
    const nextBands = groupSessionsByAgeBand(nextFiltered);
    const currentHashBand = parseAgeBandHash(window.location.hash);
    const preservedBand = currentHashBand && nextBands.some(band => band.key === currentHashBand)
      ? currentHashBand
      : '';

    setOrigin(next);
    setActiveBandKey(preservedBand);
    trackArchiveEvent('filter_changed', { filter: 'origin', value: next });
    const nextUrl = buildSessionsUrl(next, preservedBand);
    window.history.pushState(window.history.state, '', nextUrl);
  };

  const handleViewChange = (next: SessionView) => {
    userChangedViewRef.current = true;
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Selected view still works for this visit.
    }
    if (next === view) return;
    setView(next);
    trackArchiveEvent('view_changed', { view: next });
  };

  const statusText = formatSessionsBrowseStatus(
    filteredSessions.length,
    sessions.length,
    ageBands.length,
    origin,
  );

  return (
    <>
      <ArchiveAnalytics ready section="sessions" sessionId={null} documentId={null} />
      <div className="sessions-browse-controls">
        <div className="field sessions-origin-field">
          <label htmlFor="sessions-origin-filter">Transcript origin</label>
          <select
            id="sessions-origin-filter"
            value={origin}
            onChange={event => handleOriginChange(parseOriginParam(event.target.value))}
          >
            <option value="">All origins ({sessions.length.toLocaleString()})</option>
            {VALID_TRANSCRIPT_ORIGINS.map(value => (
              <option key={value} value={value}>
                {transcriptOriginLabels[value]} ({originCounts[value].toLocaleString()})
              </option>
            ))}
          </select>
        </div>
        {origin && (
          <button
            type="button"
            className="text-button small sessions-clear-filter"
            onClick={() => handleOriginChange('')}
          >
            <X size={15} aria-hidden="true" />
            Show all origins
          </button>
        )}
        <div className="session-view-control" role="group" aria-label="Session view">
          <span className="small muted">View</span>
          <button
            type="button"
            className="button secondary theme-shortcut"
            aria-pressed={view === 'details'}
            aria-describedby="sessions-view-help"
            onClick={() => handleViewChange('details')}
          >
            Details
          </button>
          <button
            type="button"
            className="button secondary theme-shortcut"
            aria-pressed={view === 'list'}
            aria-describedby="sessions-view-help"
            onClick={() => handleViewChange('list')}
          >
            List
          </button>
        </div>
      </div>

      <p className="small muted sessions-browse-status" role="status">
        {statusText}
      </p>
      <p id="sessions-view-help" className="small muted results-reading-note">
        {view === 'list'
          ? 'List shows condensed session summaries for faster scanning.'
          : 'Details shows full guide overviews, audio availability, and themes.'}{' '}
        Session guides are AI-written; labels identify the transcript origin, mark machine drafts as unreviewed, and distinguish source ages from filename-inferred ages.
      </p>

      {ageBands.length > 0 && (
        <nav className="age-jump-nav age-band-nav" aria-label="Jump to age band">
          <div className="age-band-nav-header">
            <span className="eyebrow age-jump-label">Age-band timeline</span>
            <span className="small muted age-band-nav-hint">
              Six-month spans, youngest to oldest
            </span>
          </div>
          <ul className="age-jump-list age-band-list">
            {ageBands.map(band => {
              const count = band.sessions.length;
              const barPercent = computeBandBarPercent(count, maxBandCount);
              const isCurrent = effectiveActiveBandKey === band.key;
              return (
                <li key={band.key} className="age-band-nav-item">
                  <a
                    className="button secondary age-jump-link age-band-link"
                    href={`#${band.key}`}
                    aria-current={isCurrent ? 'location' : undefined}
                  >
                    <span className="age-band-link-row">
                      <span className="age-band-label">{band.label}</span>
                      <span className="sr-only">{' — '}</span>
                      <span className="nav-count">
                        {count.toLocaleString()}
                        <span className="sr-only">
                          {' '}
                          {count === 1 ? 'session' : 'sessions'}
                        </span>
                      </span>
                    </span>
                    <span className="age-band-bar" aria-hidden="true">
                      <span
                        className="age-band-bar-fill"
                        style={{ width: `${barPercent}%` }}
                      />
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {ageBands.length === 0 ? (
        <div className="empty-state">
          <Search size={28} aria-hidden="true" />
          <h2>No sessions match this filter</h2>
          <p>
            No sessions in this collection have the selected transcript origin. Switch back to all origins to view every session.
          </p>
          {origin && (
            <button
              type="button"
              className="button secondary empty-state-action"
              onClick={() => handleOriginChange('')}
            >
              Show all origins
            </button>
          )}
        </div>
      ) : (
        <div className="age-band-groups">
          {ageBands.map(band => {
            const count = band.sessions.length;
            const isActive = effectiveActiveBandKey === band.key;
            return (
              <section
                key={band.key}
                id={band.key}
                className={isActive ? 'age-band-group is-active-band' : 'age-band-group'}
                aria-labelledby={`${band.key}-heading`}
              >
                <div className="age-band-header">
                  <h2 id={`${band.key}-heading`} className="age-band-heading">
                    <span className="age-band-title">{band.label}</span>
                    <span className="sr-only">{' — '}</span>
                    <span className="age-band-count">
                      {count.toLocaleString()} {count === 1 ? 'session' : 'sessions'}
                    </span>
                  </h2>
                  <p className="small muted age-band-prose">{band.proseRange}</p>
                </div>
                <ol
                  className={view === 'list' ? 'sessions-compact-list' : 'sessions-detail-list'}
                  role="list"
                  start={band.startIndex}
                >
                  {band.sessions.map((session, index) => {
                    const headingId = `browse-session-${session.id}`;
                    const sessionHref = `/sessions/${encodeURIComponent(session.slug)}`;
                    return (
                      <li key={session.id}>
                        <article
                          className={view === 'list' ? 'session-list-row' : 'session-card'}
                          aria-labelledby={headingId}
                        >
                          <div className="session-index" aria-hidden="true">
                            {String(band.startIndex + index).padStart(2, '0')}
                          </div>
                          <div className="session-card-body">
                            <h3 id={headingId}>
                              <a
                                href={sessionHref}
                                onClick={() =>
                                  trackArchiveEvent('recording_open', {
                                    recordingId: session.id,
                                    origin: session.origin,
                                    view,
                                    action: 'guide',
                                  })
                                }
                                onAuxClick={event => {
                                  if (event.button === 1) {
                                    trackArchiveEvent('recording_open', {
                                      recordingId: session.id,
                                      origin: session.origin,
                                      view,
                                      action: 'guide',
                                    });
                                  }
                                }}
                              >
                                {session.title}
                                <ArrowRight size={view === 'list' ? 17 : 20} aria-hidden="true" />
                              </a>
                            </h3>
                            <CatalogRecord
                              variant={view === 'list' ? 'compact' : 'card'}
                              slug={session.slug}
                              sourceName={session.sourceName}
                              ages={session.ages}
                              inferredAge={session.inferredAge}
                              dates={session.dates}
                              origin={session.origin}
                              audioStatus={view === 'details' ? session.audioStatus : undefined}
                              showAgeSource
                            />
                            <p className="card-overview">
                              {view === 'list' ? shortOverview(session.overview) : session.overview}
                            </p>
                            {view === 'details' && <TopicLabels topics={session.topics} compact />}
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
