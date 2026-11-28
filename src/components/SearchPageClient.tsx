'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import {
  ageFilterBucket,
  buildAgeSelectOptions,
  formatAgeMonths,
  parseAgeMonthsParam,
  type AgeMonthBounds,
} from '../lib/age';
import { trackArchiveEvent } from '../lib/analytics';
import { isLinguisticSpeaker, type LinguisticMarkerId, type LinguisticSpeaker } from '../lib/linguistic-markers';
import {
  adaptSearchForView,
  formatSearchStatus,
  isSearchSort,
  isTranscriptOrigin,
  type SearchBusyKind,
  type SessionView,
} from '../lib/results-view';
import {
  buildSearchHref,
  defaultSortForQuery,
  hasActiveSearchFilters,
  MAX_SEARCH_QUERY_LENGTH,
  parseSearchUrlParams,
  searchRequestFromUrlState,
  serializeSearchUrlParams,
  type SearchUrlState,
} from '../lib/search-params';
import { ARCHIVE_NAME, formatDocumentTitle } from '../lib/site';
import type { SearchResponse, SearchSort, TranscriptOrigin } from '../lib/types';
import ArchiveAnalytics from './ArchiveAnalytics';
import LinguisticFilters from './LinguisticFilters';
import RouteHeader from './RouteHeader';
import SessionResults from './SessionResults';
import { positiveThemes } from './TopicThemes';
import { request, transcriptOriginLabels } from './api';

export interface SearchTopicCount {
  name: string;
  count: number;
}

export default function SearchPageClient({
  topics,
  totalSessions,
  ageBounds,
  loadError = false,
}: {
  topics: SearchTopicCount[];
  totalSessions: number;
  ageBounds: AgeMonthBounds | null;
  loadError?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();

  const validTopicSet = useMemo(() => new Set(topics.map(item => item.name)), [topics]);
  const urlState = useMemo(
    () => parseSearchUrlParams(new URLSearchParams(searchParamsKey), { validTopics: validTopicSet }),
    [searchParamsKey, validTopicSet],
  );
  const canonicalHref = useMemo(() => buildSearchHref(urlState), [urlState]);
  const hasFilters = hasActiveSearchFilters(urlState);

  const [draftQuery, setDraftQuery] = useState(urlState.query);
  const [linguisticsOpen, setLinguisticsOpen] = useState(Boolean(urlState.marker));
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [searchSpeaker, setSearchSpeaker] = useState<LinguisticSpeaker>(urlState.speaker);
  const [busyKind, setBusyKind] = useState<SearchBusyKind>(null);
  const [searchError, setSearchError] = useState('');
  const [retryToken, setRetryToken] = useState(0);

  const resultHeading = useRef<HTMLHeadingElement>(null);
  const draftQueryRef = useRef(urlState.query);
  const lastSearchKeyRef = useRef(searchParamsKey);
  const lastMarkerRef = useRef(urlState.marker);
  const selfCommittedKeysRef = useRef<string[]>([]);
  const queryDebounceTimer = useRef<number | null>(null);
  const focusResultsOnLoad = useRef(false);
  const focusResultsFrame = useRef<number | null>(null);
  const pendingViewChange = useRef(false);
  const loadedSearchRef = useRef<{ filterKey: string; response: SearchResponse } | null>(null);
  const pendingSearchAnalytics = useRef<{ flush: () => void; cancel: () => void } | null>(null);
  const lastSearchAnalytics = useRef<{ signature: string; token: number } | null>(null);

  const cancelQueryDebounce = useCallback(() => {
    if (queryDebounceTimer.current !== null) {
      window.clearTimeout(queryDebounceTimer.current);
      queryDebounceTimer.current = null;
    }
  }, []);

  const cancelFocusResultsFrame = useCallback(() => {
    if (focusResultsFrame.current !== null) {
      window.cancelAnimationFrame(focusResultsFrame.current);
      focusResultsFrame.current = null;
    }
  }, []);

  const scheduleFocusResults = useCallback(() => {
    cancelFocusResultsFrame();
    focusResultsFrame.current = window.requestAnimationFrame(() => {
      focusResultsFrame.current = null;
      resultHeading.current?.focus();
    });
  }, [cancelFocusResultsFrame]);

  useEffect(() => () => {
    cancelQueryDebounce();
    cancelFocusResultsFrame();
    selfCommittedKeysRef.current.length = 0;
  }, [cancelQueryDebounce, cancelFocusResultsFrame]);

  useEffect(() => {
    const onPopState = () => {
      selfCommittedKeysRef.current.length = 0;
      if (window.location.pathname !== '/search') return;
      const nextSearchKey = new URLSearchParams(window.location.search).toString();
      if (nextSearchKey === lastSearchKeyRef.current) return;
      cancelQueryDebounce();
      cancelFocusResultsFrame();
      focusResultsOnLoad.current = false;
      pendingViewChange.current = false;
      const restored = parseSearchUrlParams(new URLSearchParams(nextSearchKey), { validTopics: validTopicSet });
      draftQueryRef.current = restored.query;
      setDraftQuery(restored.query);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [cancelQueryDebounce, cancelFocusResultsFrame, validTopicSet]);

  useEffect(() => {
    if (searchParamsKey === lastSearchKeyRef.current) return;
    lastSearchKeyRef.current = searchParamsKey;
    const queue = selfCommittedKeysRef.current;
    const selfIndex = queue.indexOf(searchParamsKey);
    const isSelfCommit = selfIndex !== -1;
    if (isSelfCommit) {
      queue.splice(0, selfIndex + 1);
    }
    if (urlState.marker && urlState.marker !== lastMarkerRef.current) {
      setLinguisticsOpen(true);
    }
    lastMarkerRef.current = urlState.marker;
    if (isSelfCommit) {
      // Our own commit (e.g. debounced typing or filter selection) already manages
      // draftQuery; never cancel a newer debounce timer or clobber keystrokes typed
      // between history.pushState/replaceState and useSearchParams() flushing.
      return;
    }
    cancelQueryDebounce();
    if (draftQueryRef.current.trim() !== urlState.query) {
      draftQueryRef.current = urlState.query;
      setDraftQuery(urlState.query);
    }
  }, [cancelQueryDebounce, searchParamsKey, urlState.marker, urlState.query]);

  useEffect(() => {
    document.title = formatDocumentTitle({ kind: 'search', hasFilters });
  }, [hasFilters]);

  const commitState = useCallback((next: SearchUrlState, mode: 'push' | 'replace' = 'push') => {
    const nextHref = buildSearchHref(next);
    const currentLocation = `${window.location.pathname}${window.location.search}`;
    if (nextHref === currentLocation) return false;
    const nextKey = serializeSearchUrlParams(next).toString();
    selfCommittedKeysRef.current.push(nextKey);
    if (selfCommittedKeysRef.current.length > 8) {
      selfCommittedKeysRef.current.splice(0, selfCommittedKeysRef.current.length - 8);
    }
    if (mode === 'push') {
      window.history.pushState(null, '', nextHref);
    } else {
      window.history.replaceState(null, '', nextHref);
    }
    return true;
  }, []);

  const currentBaseState = useCallback((): SearchUrlState => {
    const trimmedDraft = draftQueryRef.current.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
    const hadQuery = Boolean(urlState.query);
    const hasDraft = Boolean(trimmedDraft);
    let nextSort = urlState.sort;
    if (!hadQuery && hasDraft) nextSort = 'relevance';
    else if (hadQuery && !hasDraft && urlState.sort === 'relevance') nextSort = 'age-asc';
    return {
      ...urlState,
      query: trimmedDraft,
      sort: nextSort,
    };
  }, [urlState]);

  useEffect(() => {
    if (loadError) {
      setBusyKind(null);
      return;
    }

    const filterKey = JSON.stringify({
      query: urlState.query,
      topic: urlState.topic,
      origin: urlState.origin,
      marker: urlState.marker,
      speaker: urlState.speaker,
      ageMin: urlState.ageMin ?? null,
      ageMax: urlState.ageMax ?? null,
      sort: urlState.sort,
      retryToken,
    });
    const loaded = loadedSearchRef.current;
    const sameFilters = loaded !== null && loaded.filterKey === filterKey;

    if (sameFilters && urlState.page === 1) {
      const adapted = adaptSearchForView(loaded.response, urlState.view);
      if (adapted) {
        pendingViewChange.current = false;
        setSearch(adapted);
        setSearchSpeaker(urlState.speaker);
        setSearchError('');
        setBusyKind(null);
        if (focusResultsOnLoad.current) {
          focusResultsOnLoad.current = false;
          scheduleFocusResults();
        }
        return;
      }
    }

    const controller = new AbortController();
    let pendingAnalytics: { flush: () => void; cancel: () => void } | null = null;
    const isViewOnlyChange = pendingViewChange.current && sameFilters;
    pendingViewChange.current = false;

    setBusyKind(isViewOnlyChange ? 'view' : 'search');
    setSearchError('');

    const payload = searchRequestFromUrlState(urlState);
    void request<SearchResponse>('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).then(data => {
      if (controller.signal.aborted) return;
      loadedSearchRef.current = { filterKey, response: data };
      setSearch(data);
      setSearchSpeaker(urlState.speaker);
      setBusyKind(null);
      if (focusResultsOnLoad.current) {
        focusResultsOnLoad.current = false;
        scheduleFocusResults();
      }

      const trimmedQuery = urlState.query.trim();
      const repeatedSubmission = retryToken > (lastSearchAnalytics.current?.token ?? 0);
      if (
        trimmedQuery
        || urlState.topic
        || urlState.origin
        || urlState.marker
        || urlState.ageMin !== undefined
        || urlState.ageMax !== undefined
        || data.page > 1
        || repeatedSubmission
      ) {
        // Query text stays strictly an in-memory dedupe key, never event data.
        const signature = JSON.stringify({
          query: trimmedQuery,
          topic: urlState.topic,
          origin: urlState.origin,
          marker: urlState.marker,
          speaker: urlState.speaker,
          ageMin: urlState.ageMin ?? null,
          ageMax: urlState.ageMax ?? null,
          sort: urlState.sort,
          page: data.page,
        });
        let emitted = false;
        const emit = () => {
          if (controller.signal.aborted || emitted) return;
          emitted = true;
          if (lastSearchAnalytics.current?.signature === signature && lastSearchAnalytics.current.token === retryToken) {
            return;
          }
          lastSearchAnalytics.current = { signature, token: retryToken };
          trackArchiveEvent('search_completed', {
            queryLength: Math.min(MAX_SEARCH_QUERY_LENGTH, trimmedQuery.length),
            wordCount: trimmedQuery ? Math.min(MAX_SEARCH_QUERY_LENGTH, trimmedQuery.split(/\s+/).length) : 0,
            results: data.total,
            page: data.page,
            view: urlState.view,
            origin: urlState.origin,
            marker: urlState.marker,
            theme: urlState.topic,
          });
        };
        const analyticsTimer = window.setTimeout(emit, 750);
        pendingAnalytics = {
          flush: () => { window.clearTimeout(analyticsTimer); emit(); },
          cancel: () => window.clearTimeout(analyticsTimer),
        };
        pendingSearchAnalytics.current = pendingAnalytics;
      } else {
        lastSearchAnalytics.current = { signature: '', token: retryToken };
      }
    }).catch(() => {
      if (controller.signal.aborted) return;
      focusResultsOnLoad.current = false;
      setSearchError('The search could not be completed. Please try again.');
      setBusyKind(null);
    });

    return () => {
      controller.abort();
      pendingAnalytics?.cancel();
      if (pendingSearchAnalytics.current === pendingAnalytics) {
        pendingSearchAnalytics.current = null;
      }
    };
  }, [loadError, retryToken, scheduleFocusResults, urlState]);

  const ageOptions = useMemo(
    () => buildAgeSelectOptions(ageBounds, [urlState.ageMin, urlState.ageMax]),
    [ageBounds, urlState.ageMin, urlState.ageMax],
  );

  const handleQueryChange = (nextRaw: string) => {
    focusResultsOnLoad.current = false;
    pendingViewChange.current = false;
    cancelFocusResultsFrame();
    cancelQueryDebounce();
    draftQueryRef.current = nextRaw;
    setDraftQuery(nextRaw);

    const trimmedNext = nextRaw.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
    const hadUrlQuery = Boolean(urlState.query);
    const hasNextQuery = Boolean(trimmedNext);
    let nextSort = urlState.sort;
    if (!hadUrlQuery && hasNextQuery) nextSort = 'relevance';
    else if (hadUrlQuery && !hasNextQuery && urlState.sort === 'relevance') nextSort = 'age-asc';

    const nextState: SearchUrlState = {
      ...urlState,
      query: trimmedNext,
      sort: nextSort,
      page: 1,
    };
    const mode = hadUrlQuery !== hasNextQuery ? 'push' : 'replace';
    queryDebounceTimer.current = window.setTimeout(() => {
      queryDebounceTimer.current = null;
      commitState(nextState, mode);
    }, 280);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    cancelQueryDebounce();
    pendingViewChange.current = false;
    focusResultsOnLoad.current = true;
    const nextState: SearchUrlState = {
      ...currentBaseState(),
      page: 1,
    };
    const changed = commitState(nextState, 'push');
    if (!changed) {
      if (searchError || !search) {
        setRetryToken(value => value + 1);
      } else {
        focusResultsOnLoad.current = false;
        scheduleFocusResults();
      }
    }
  };

  const handleTopicChange = (value: string) => {
    cancelQueryDebounce();
    pendingViewChange.current = false;
    focusResultsOnLoad.current = false;
    const nextTopic = validTopicSet.has(value) ? value : '';
    trackArchiveEvent('filter_changed', { filter: 'theme', value: nextTopic });
    commitState({ ...currentBaseState(), topic: nextTopic, page: 1 }, 'push');
  };

  const handleOriginChange = (value: string) => {
    cancelQueryDebounce();
    pendingViewChange.current = false;
    focusResultsOnLoad.current = false;
    const nextOrigin: TranscriptOrigin | '' = isTranscriptOrigin(value) ? value : '';
    trackArchiveEvent('filter_changed', { filter: 'origin', value: nextOrigin });
    commitState({ ...currentBaseState(), origin: nextOrigin, page: 1 }, 'push');
  };

  const handleAgeMinChange = (raw: string) => {
    cancelQueryDebounce();
    pendingViewChange.current = false;
    focusResultsOnLoad.current = false;
    const nextAgeMin = parseAgeMonthsParam(raw);
    const base = currentBaseState();
    const nextAgeMax = nextAgeMin !== undefined && base.ageMax !== undefined && nextAgeMin > base.ageMax
      ? undefined
      : base.ageMax;
    trackArchiveEvent('filter_changed', { filter: 'age', value: ageFilterBucket(nextAgeMin, nextAgeMax) });
    commitState({ ...base, ageMin: nextAgeMin, ageMax: nextAgeMax, page: 1 }, 'push');
  };

  const handleAgeMaxChange = (raw: string) => {
    cancelQueryDebounce();
    pendingViewChange.current = false;
    focusResultsOnLoad.current = false;
    const nextAgeMax = parseAgeMonthsParam(raw);
    const base = currentBaseState();
    const nextAgeMin = nextAgeMax !== undefined && base.ageMin !== undefined && base.ageMin > nextAgeMax
      ? undefined
      : base.ageMin;
    trackArchiveEvent('filter_changed', { filter: 'age', value: ageFilterBucket(nextAgeMin, nextAgeMax) });
    commitState({ ...base, ageMin: nextAgeMin, ageMax: nextAgeMax, page: 1 }, 'push');
  };

  const handleSortChange = (value: string) => {
    cancelQueryDebounce();
    pendingViewChange.current = false;
    focusResultsOnLoad.current = false;
    const base = currentBaseState();
    const nextSort: SearchSort = isSearchSort(value) ? value : defaultSortForQuery(base.query);
    trackArchiveEvent('filter_changed', { filter: 'sort', value: nextSort });
    commitState({ ...base, sort: nextSort, page: 1 }, 'push');
  };

  const handleMarkerChange = (nextMarker: LinguisticMarkerId | '') => {
    cancelQueryDebounce();
    pendingViewChange.current = false;
    focusResultsOnLoad.current = false;
    const base = currentBaseState();
    const nextSpeaker: LinguisticSpeaker = nextMarker ? base.speaker : 'child';
    trackArchiveEvent('filter_changed', { filter: 'marker', value: nextMarker });
    commitState({ ...base, marker: nextMarker, speaker: nextSpeaker, page: 1 }, 'push');
  };

  const handleSpeakerChange = (value: LinguisticSpeaker) => {
    cancelQueryDebounce();
    pendingViewChange.current = false;
    focusResultsOnLoad.current = false;
    const nextSpeaker: LinguisticSpeaker = isLinguisticSpeaker(value) ? value : 'child';
    trackArchiveEvent('filter_changed', { filter: 'speaker', value: nextSpeaker });
    commitState({ ...currentBaseState(), speaker: nextSpeaker, page: 1 }, 'push');
  };

  const handleViewChange = (nextView: SessionView) => {
    if (nextView === urlState.view) return;
    cancelQueryDebounce();
    focusResultsOnLoad.current = false;
    trackArchiveEvent('view_changed', { view: nextView });
    pendingViewChange.current = true;
    commitState({ ...currentBaseState(), view: nextView, page: 1 }, 'push');
  };

  const handleClearFilters = () => {
    cancelQueryDebounce();
    cancelFocusResultsFrame();
    focusResultsOnLoad.current = false;
    pendingViewChange.current = false;
    draftQueryRef.current = '';
    setDraftQuery('');
    trackArchiveEvent('filter_changed', { filter: 'clear', value: 'all' });
    commitState({
      query: '',
      topic: '',
      origin: '',
      marker: '',
      speaker: 'child',
      ageMin: undefined,
      ageMax: undefined,
      sort: 'age-asc',
      view: urlState.view,
      page: 1,
    }, 'push');
  };

  const handlePageChange = (nextPage: number) => {
    cancelQueryDebounce();
    pendingViewChange.current = false;
    focusResultsOnLoad.current = true;
    commitState({ ...currentBaseState(), page: Math.max(1, nextPage) }, 'push');
  };

  const flushAnalyticsBeforeNavigate = useCallback(() => {
    pendingSearchAnalytics.current?.flush();
  }, []);

  const searchBusy = busyKind !== null;

  return (
    <div className="archive-shell">
      <ArchiveAnalytics ready={!loadError} section="search" sessionId={null} documentId={null} />
      <RouteHeader activeSection="search" showShare sharePath={canonicalHref} shareTargetLabel="search" />
      <main id="main" tabIndex={-1}>
        <section className="browse-section search-route" aria-labelledby="search-heading">
          <header className="route-page-header">
            <p className="eyebrow">Collection search</p>
            <h1 id="search-heading">Search the archive</h1>
            <p className="section-intro">
              Search session guides and transcripts across {totalSessions.toLocaleString()} {totalSessions === 1 ? 'session' : 'sessions'}, or browse by theme, transcript origin, child age range, and linguistic notation. Every filter stays in the page URL so links can be bookmarked and shared.
            </p>
          </header>

          {loadError ? (
            <div className="error-panel" role="alert">
              <p>The archive catalog could not be opened just now. Please try again.</p>
              <button type="button" className="button primary" onClick={() => router.refresh()}>
                Try again
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <>
              <form className="search-form" onSubmit={handleSubmit} role="search" aria-label="Search the collection">
                <div className="field main-search">
                  <label htmlFor="archive-search">Search sessions and transcripts</label>
                  <div className="search-input">
                    <Search size={21} aria-hidden="true" />
                    <input
                      id="archive-search"
                      name="q"
                      type="search"
                      value={draftQuery}
                      onChange={event => handleQueryChange(event.target.value)}
                      placeholder="Name, place, or phrase"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button type="submit" className="search-submit" aria-label="Search">
                      <ArrowRight size={20} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="filter-row">
                  <div className="field">
                    <label htmlFor="topic-filter">Theme</label>
                    <select id="topic-filter" name="topic" value={urlState.topic} onChange={event => handleTopicChange(event.target.value)}>
                      <option value="">All themes</option>
                      {positiveThemes.map(theme => {
                        const item = topics.find(value => value.name === theme.topic);
                        return item ? <option key={theme.topic} value={theme.topic}>{theme.label} ({item.count})</option> : null;
                      })}
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="origin-filter">Transcript origin</label>
                    <select id="origin-filter" name="origin" value={urlState.origin} onChange={event => handleOriginChange(event.target.value)}>
                      <option value="">All origins</option>
                      {Object.entries(transcriptOriginLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor="sort-order">Sort by</label>
                    <select id="sort-order" name="sort" value={urlState.sort} onChange={event => handleSortChange(event.target.value)}>
                      <option value="age-asc">Age, youngest first</option>
                      <option value="age-desc">Age, oldest first</option>
                      <option value="relevance">Relevance</option>
                    </select>
                  </div>
                </div>

                <fieldset className="age-filter-fieldset">
                  <legend>Child age range</legend>
                  <div className="age-filter-row">
                    <div className="field">
                      <label htmlFor="age-min-filter">From age</label>
                      <select
                        id="age-min-filter"
                        name="ageMin"
                        value={urlState.ageMin === undefined ? '' : String(urlState.ageMin)}
                        aria-describedby="age-filter-help"
                        onChange={event => handleAgeMinChange(event.target.value)}
                      >
                        <option value="">Any minimum age</option>
                        {ageOptions.map(months => (
                          <option key={months} value={String(months)}>{formatAgeMonths(months)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="age-max-filter">To age</label>
                      <select
                        id="age-max-filter"
                        name="ageMax"
                        value={urlState.ageMax === undefined ? '' : String(urlState.ageMax)}
                        aria-describedby="age-filter-help"
                        onChange={event => handleAgeMaxChange(event.target.value)}
                      >
                        <option value="">Any maximum age</option>
                        {ageOptions.map(months => (
                          <option key={months} value={String(months)}>{formatAgeMonths(months)}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p id="age-filter-help" className="small muted age-filter-note">
                    Matches source age, or filename-inferred age where source age is not recorded. Sessions with no age are omitted while an age range is selected.
                  </p>
                </fieldset>

                <LinguisticFilters
                  marker={urlState.marker}
                  speaker={urlState.speaker}
                  open={linguisticsOpen}
                  onOpen={setLinguisticsOpen}
                  onMarker={handleMarkerChange}
                  onSpeaker={handleSpeakerChange}
                />
              </form>

              {urlState.marker && (
                <p className="small muted linguistic-intersection-note">
                  Each result has matching transcript passages. Text search, theme, age range, and transcript origin filters narrow the same session; their matches may occur elsewhere in it. Passage counts are not normalized frequencies.
                </p>
              )}

              <div className="results-toolbar">
                <h2 ref={resultHeading} tabIndex={-1}>
                  {search ? `${search.total.toLocaleString()} ${search.total === 1 ? 'session' : 'sessions'}` : 'Sessions'}
                </h2>
                {hasFilters && (
                  <button type="button" className="text-button small" onClick={handleClearFilters}>
                    <X size={15} aria-hidden="true" />
                    Clear filters
                  </button>
                )}
                <div className="session-view-control" role="group" aria-label="Session view">
                  <span className="small muted">View</span>
                  <button
                    type="button"
                    className="button secondary theme-shortcut"
                    aria-pressed={urlState.view === 'details'}
                    aria-describedby="session-view-help"
                    onClick={() => handleViewChange('details')}
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    className="button secondary theme-shortcut"
                    aria-pressed={urlState.view === 'list'}
                    aria-describedby="session-view-help"
                    onClick={() => handleViewChange('list')}
                  >
                    List
                  </button>
                </div>
                <p className="small muted search-status" role="status">
                  {formatSearchStatus(search, busyKind)}
                </p>
              </div>

              <p id="session-view-help" className="small muted results-reading-note">
                {urlState.view === 'list'
                  ? 'List shows up to 36 sessions per page; expand a match to see source excerpts.'
                  : 'Details shows up to 18 sessions per page with guide overviews and source excerpts.'}{' '}
                Session guides are AI-written; labels identify the transcript origin.
              </p>

              {searchError && (
                <div className="error-panel" role="alert">
                  <p>{searchError}</p>
                  <button type="button" className="button secondary" onClick={() => setRetryToken(value => value + 1)}>
                    Try search again
                  </button>
                </div>
              )}

              <div className="results-list" aria-busy={searchBusy}>
                {search && (
                  <SessionResults
                    results={search.results}
                    view={urlState.view}
                    firstIndex={(search.page - 1) * search.pageSize + 1}
                    speaker={searchSpeaker}
                    headingLevel={3}
                    returnTo={canonicalHref}
                    linkPassagesToSessionRoute
                    onBeforeSessionNavigate={flushAnalyticsBeforeNavigate}
                  />
                )}
              </div>

              {search && !search.results.length && !searchBusy && (
                <div className="empty-state">
                  <Search size={28} aria-hidden="true" />
                  <h3>No sessions found</h3>
                  <p>
                    {urlState.marker
                      ? 'Try Any speaker / unidentified, a wider age range, a different transcript origin, or fewer filters. Source notation and explicit CHI labels are sparse in some materials; no matches do not indicate an absent linguistic ability.'
                      : 'Try a shorter phrase, a wider age range, a different spelling, or fewer filters. AI transcript drafts sometimes spell names unexpectedly.'}
                  </p>
                </div>
              )}

              {search && search.pages > 1 && (
                <nav className="pagination" aria-label="Search result pages">
                  <button
                    className="button secondary"
                    type="button"
                    disabled={search.page <= 1 || searchBusy}
                    onClick={() => handlePageChange(search.page - 1)}
                  >
                    <ChevronLeft size={17} aria-hidden="true" />
                    Previous
                  </button>
                  <span className="small">Page {search.page} of {search.pages}</span>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={search.page >= search.pages || searchBusy}
                    onClick={() => handlePageChange(search.page + 1)}
                  >
                    Next
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                </nav>
              )}
            </>
          )}
        </section>
      </main>
      <footer className="site-footer">
        <div>
          <span className="collection-mark" aria-hidden="true"><span /><span /></span>
          <p>
            {ARCHIVE_NAME}<br />
            <span>An unlisted public archive. Anyone with the link can visit.</span><br />
            <span>Usage analytics exclude search and transcript text.</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
