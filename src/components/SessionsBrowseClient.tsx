'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { trackArchiveEvent } from '../lib/analytics';
import { shortOverview, type SessionView } from '../lib/results-view';
import {
  buildSessionsUrl,
  countSessionsByOrigin,
  filterBrowseSessions,
  formatSessionsBrowseStatus,
  groupSessionsByAgeYear,
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
  const userChangedViewRef = useRef(false);

  useEffect(() => {
    setOrigin(initialOrigin);
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
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const originCounts = useMemo(() => countSessionsByOrigin(sessions), [sessions]);
  const filteredSessions = useMemo(
    () => filterBrowseSessions(sessions, origin),
    [sessions, origin],
  );
  const ageGroups = useMemo(
    () => groupSessionsByAgeYear(filteredSessions),
    [filteredSessions],
  );

  const handleOriginChange = (next: TranscriptOrigin | '') => {
    if (next === origin) return;
    setOrigin(next);
    trackArchiveEvent('filter_changed', { filter: 'origin', value: next });
    const nextUrl = buildSessionsUrl(next);
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
    ageGroups.length,
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
        Session guides are AI-written; labels identify the transcript origin and mark machine drafts as unreviewed.
      </p>

      {ageGroups.length >= 2 && (
        <nav className="age-jump-nav" aria-label="Jump to age">
          <span className="small muted age-jump-label">Jump to age</span>
          <ul className="age-jump-list">
            {ageGroups.map(group => (
              <li key={group.key}>
                <a className="button secondary age-jump-link" href={`#${group.key}`}>
                  <span>{group.label}</span>{' '}
                  <span className="nav-count">
                    {group.sessions.length.toLocaleString()}
                    <span className="sr-only">
                      {' '}
                      {group.sessions.length === 1 ? 'session' : 'sessions'}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {ageGroups.length === 0 ? (
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
        <div className="age-year-groups">
          {ageGroups.map(group => (
            <section
              key={group.key}
              id={group.key}
              className="age-year-group"
              aria-labelledby={`${group.key}-heading`}
            >
              <div className="age-group-header">
                <h2 id={`${group.key}-heading`}>{group.label}</h2>
                <p className="small muted age-group-count">
                  {group.sessions.length.toLocaleString()}{' '}
                  {group.sessions.length === 1 ? 'session' : 'sessions'}
                </p>
              </div>
              <ol
                className={view === 'list' ? 'sessions-compact-list' : 'sessions-detail-list'}
                role="list"
                start={group.startIndex}
              >
                {group.sessions.map((session, index) => {
                  const headingId = `browse-session-${session.id}`;
                  const sessionHref = `/sessions/${encodeURIComponent(session.slug)}`;
                  return (
                    <li key={session.id}>
                      <article
                        className={view === 'list' ? 'session-list-row' : 'session-card'}
                        aria-labelledby={headingId}
                      >
                        <div className="session-index" aria-hidden="true">
                          {String(group.startIndex + index).padStart(2, '0')}
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
          ))}
        </div>
      )}
    </>
  );
}
