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
  formatConcordanceStatus,
  formatSearchStatus,
  isSearchSort,
  isTranscriptOrigin,
  type SearchBusyKind,
  type SearchView,
} from '../lib/results-view';
import {
  buildSearchHref,
  concordanceRequestFromUrlState,
  defaultSortForQuery,
  hasActiveSearchFilters,
  hasExplicitSortParam,
  MAX_SEARCH_QUERY_LENGTH,
  parseConcordanceResponse,
  parseSearchResponse,
  parseSearchUrlParams,
  resolveSortForQueryChange,
  searchRequestFromUrlState,
  serializeSearchUrlParams,
  type SearchUrlState,
} from '../lib/search-params';
import { ARCHIVE_NAME, formatDocumentTitle } from '../lib/site';
import { positiveThemes, selectableTopicSet } from '../lib/topics';
import type { ConcordanceResponse, SearchResponse, SearchSort, TranscriptOrigin } from '../lib/types';
import ArchiveAnalytics from './ArchiveAnalytics';
import ConcordanceTable from './ConcordanceTable';
import LinguisticFilters from './LinguisticFilters';
import RouteHeader from './RouteHeader';
import SessionResults from './SessionResults';
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

  const validTopicSet = useMemo(() => selectableTopicSet(topics), [topics]);
  const urlState = useMemo(
    () => parseSearchUrlParams(new URLSearchParams(searchParamsKey), { validTopics: validTopicSet }),
    [searchParamsKey, validTopicSet],
  );
  const hasExplicitSort = useMemo(
    () => hasExplicitSortParam(new URLSearchParams(searchParamsKey)),
    [searchParamsKey],
  );
  const canonicalHref = useMemo(
    () => buildSearchHref(urlState, { explicitSort: hasExplicitSort }),
    [hasExplicitSort, urlState],
  );
  const hasFilters = hasActiveSearchFilters(urlState);
  const isConcordance = urlState.view === 'concordance';

  const [draftQuery, setDraftQuery] = useState(urlState.query);
  const [linguisticsOpen, setLinguisticsOpen] = useState(Boolean(urlState.marker));
  const [searchState, setSearchState] = useState<{
    requestKey: string;
    response: SearchResponse;
    speaker: LinguisticSpeaker;
  } | null>(null);
  const [concordanceState, setConcordanceState] = useState<{
    requestKey: string;
    response: ConcordanceResponse;
  } | null>(null);
  const [busyKind, setBusyKind] = useState<SearchBusyKind>(null);
  const [searchError, setSearchError] = useState('');
  const [retryToken, setRetryToken] = useState(0);

  const filterKey = useMemo(() => JSON.stringify({
    query: urlState.query,
    topic: urlState.topic,
    origin: urlState.origin,
    marker: urlState.marker,
    speaker: urlState.speaker,
    ageMin: urlState.ageMin ?? null,
    ageMax: urlState.ageMax ?? null,
    sort: urlState.sort,
    retryToken,
  }), [retryToken, urlState]);

  const currentRequestKey = useMemo(
    () => JSON.stringify({ filterKey, view: urlState.view, page: urlState.page }),
    [filterKey, urlState.page, urlState.view],
  );

  const visibleSearch = !isConcordance && !searchError && searchState && searchState.requestKey === currentRequestKey
    ? searchState.response
    : null;
  const visibleConcordance = isConcordance && !searchError && Boolean(urlState.query) && concordanceState && concordanceState.requestKey === currentRequestKey
    ? concordanceState.response
    : null;
  const visibleSpeaker = searchState && searchState.requestKey === currentRequestKey ? searchState.speaker : urlState.speaker;

  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const mountedRef = useRef(true);
  const draftQueryRef = useRef(urlState.query);
  const lastSearchKeyRef = useRef(searchParamsKey);
  const lastMarkerRef = useRef(urlState.marker);
  const selfCommittedKeysRef = useRef<string[]>([]);
  const submittedDraftRef = useRef(false);
  const queryDebounceTimer = useRef<number | null>(null);
  const focusResultsOnLoad = useRef(false);
  const focusResultsFrame = useRef<number | null>(null);
  const pendingViewChange = useRef(false);
  const loadedSearchRef = useRef<{ filterKey: string; response: SearchResponse } | null>(null);
  const pendingSearchAnalytics = useRef<{ key: string; flush: () => void; cancel: () => void } | null>(null);
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelQueryDebounce();
      cancelFocusResultsFrame();
      pendingSearchAnalytics.current?.cancel();
      pendingSearchAnalytics.current = null;
      selfCommittedKeysRef.current.length = 0;
    };
  }, [cancelQueryDebounce, cancelFocusResultsFrame]);

  useEffect(() => {
    const onPopState = () => {
      selfCommittedKeysRef.current.length = 0;
      submittedDraftRef.current = false;
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
    submittedDraftRef.current = false;
    cancelQueryDebounce();
    if (draftQueryRef.current.trim() !== urlState.query) {
      draftQueryRef.current = urlState.query;
      setDraftQuery(urlState.query);
    }
  }, [cancelQueryDebounce, searchParamsKey, urlState.marker, urlState.query]);

  useEffect(() => {
    document.title = formatDocumentTitle({ kind: 'search', hasFilters, view: urlState.view });
  }, [hasFilters, urlState.view]);

  const commitState = useCallback(
    (
      next: SearchUrlState,
      mode: 'push' | 'replace' = 'push',
      options?: { explicitSort?: boolean },
    ) => {
      const explicitSort = options?.explicitSort ?? hasExplicitSort;
      const nextHref = buildSearchHref(next, { explicitSort });
      const currentLocation = `${window.location.pathname}${window.location.search}`;
      if (nextHref === currentLocation) return false;
      const nextKey = serializeSearchUrlParams(next, { explicitSort }).toString();
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
    },
    [hasExplicitSort],
  );

  const currentBaseState = useCallback((): SearchUrlState => {
    const trimmedDraft = draftQueryRef.current.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
    const nextSort: SearchSort = urlState.view === 'concordance'
      ? 'age-asc'
      : resolveSortForQueryChange(
        urlState.sort,
        Boolean(urlState.query),
        Boolean(trimmedDraft),
        hasExplicitSort,
      );
    return {
      ...urlState,
      query: trimmedDraft,
      sort: nextSort,
    };
  }, [hasExplicitSort, urlState]);

  useEffect(() => {
    if (loadError) {
      pendingSearchAnalytics.current?.cancel();
      pendingSearchAnalytics.current = null;
      setBusyKind(null);
      return;
    }

    const analyticsMode = urlState.view === 'concordance' ? 'concordance' : 'sessions';
    const analyticsKey = `${analyticsMode}::${filterKey}::page=${urlState.page}`;
    if (pendingSearchAnalytics.current && pendingSearchAnalytics.current.key !== analyticsKey) {
      pendingSearchAnalytics.current.cancel();
      pendingSearchAnalytics.current = null;
    }

    if (urlState.view === 'concordance') {
      const trimmedQuery = urlState.query.trim();
      if (!trimmedQuery) {
        pendingSearchAnalytics.current?.cancel();
        pendingSearchAnalytics.current = null;
        pendingViewChange.current = false;
        setSearchError('');
        setBusyKind(null);
        if (focusResultsOnLoad.current) {
          focusResultsOnLoad.current = false;
          scheduleFocusResults();
        }
        return;
      }

      const controller = new AbortController();
      const isViewOnlyChange = pendingViewChange.current;
      pendingViewChange.current = false;

      setBusyKind(isViewOnlyChange ? 'view' : 'search');
      setSearchError('');

      const payload = concordanceRequestFromUrlState(urlState);
      void request<unknown>('/api/concordance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }).then(rawData => {
        if (controller.signal.aborted || !mountedRef.current) return;
        const data = parseConcordanceResponse(rawData);
        if (!data) {
          throw new Error('Invalid concordance response.');
        }
        setConcordanceState({ requestKey: currentRequestKey, response: data });
        setBusyKind(null);
        if (focusResultsOnLoad.current) {
          focusResultsOnLoad.current = false;
          scheduleFocusResults();
        }

        // Query text stays strictly an in-memory dedupe key, never event data.
        const signature = JSON.stringify({
          mode: 'concordance',
          query: trimmedQuery,
          topic: urlState.topic,
          origin: urlState.origin,
          marker: urlState.marker,
          speaker: urlState.speaker,
          ageMin: urlState.ageMin ?? null,
          ageMax: urlState.ageMax ?? null,
          page: data.page,
        });
        let emitted = false;
        const emit = () => {
          if (!mountedRef.current || emitted) return;
          emitted = true;
          if (pendingSearchAnalytics.current === scheduled) {
            pendingSearchAnalytics.current = null;
          }
          if (lastSearchAnalytics.current?.signature === signature && lastSearchAnalytics.current.token === retryToken) {
            return;
          }
          lastSearchAnalytics.current = { signature, token: retryToken };
          trackArchiveEvent('search_completed', {
            queryLength: Math.min(MAX_SEARCH_QUERY_LENGTH, trimmedQuery.length),
            wordCount: Math.min(MAX_SEARCH_QUERY_LENGTH, trimmedQuery.split(/\s+/).length),
            results: data.total,
            page: data.page,
            view: 'concordance',
            origin: urlState.origin,
            marker: urlState.marker,
            theme: urlState.topic,
          });
        };
        pendingSearchAnalytics.current?.cancel();
        const analyticsTimer = window.setTimeout(emit, 750);
        const scheduled = {
          key: analyticsKey,
          flush: () => { window.clearTimeout(analyticsTimer); emit(); },
          cancel: () => window.clearTimeout(analyticsTimer),
        };
        pendingSearchAnalytics.current = scheduled;
      }).catch(() => {
        if (controller.signal.aborted || !mountedRef.current) return;
        focusResultsOnLoad.current = false;
        setConcordanceState(prev => (prev && prev.requestKey === currentRequestKey ? null : prev));
        setSearchError('The concordance could not be loaded. Please try again.');
        setBusyKind(null);
      });

      return () => {
        controller.abort();
      };
    }

    const sessionView = urlState.view;
    const loaded = loadedSearchRef.current;
    const sameFilters = loaded !== null && loaded.filterKey === filterKey;

    if (sameFilters && urlState.page === 1) {
      const adapted = adaptSearchForView(loaded.response, sessionView);
      if (adapted) {
        pendingViewChange.current = false;
        setSearchState({ requestKey: currentRequestKey, response: adapted, speaker: urlState.speaker });
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
    const isViewOnlyChange = pendingViewChange.current && sameFilters;
    pendingViewChange.current = false;

    setBusyKind(isViewOnlyChange ? 'view' : 'search');
    setSearchError('');

    const payload = searchRequestFromUrlState(urlState);
    void request<unknown>('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).then(rawData => {
      if (controller.signal.aborted || !mountedRef.current) return;
      const data = parseSearchResponse(rawData);
      if (!data) {
        throw new Error('Invalid search response.');
      }
      loadedSearchRef.current = { filterKey, response: data };
      setSearchState({ requestKey: currentRequestKey, response: data, speaker: urlState.speaker });
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
          mode: 'sessions',
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
          if (!mountedRef.current || emitted) return;
          emitted = true;
          if (pendingSearchAnalytics.current === scheduled) {
            pendingSearchAnalytics.current = null;
          }
          if (lastSearchAnalytics.current?.signature === signature && lastSearchAnalytics.current.token === retryToken) {
            return;
          }
          lastSearchAnalytics.current = { signature, token: retryToken };
          trackArchiveEvent('search_completed', {
            queryLength: Math.min(MAX_SEARCH_QUERY_LENGTH, trimmedQuery.length),
            wordCount: trimmedQuery ? Math.min(MAX_SEARCH_QUERY_LENGTH, trimmedQuery.split(/\s+/).length) : 0,
            results: data.total,
            page: data.page,
            view: sessionView,
            origin: urlState.origin,
            marker: urlState.marker,
            theme: urlState.topic,
          });
        };
        pendingSearchAnalytics.current?.cancel();
        const analyticsTimer = window.setTimeout(emit, 750);
        const scheduled = {
          key: analyticsKey,
          flush: () => { window.clearTimeout(analyticsTimer); emit(); },
          cancel: () => window.clearTimeout(analyticsTimer),
        };
        pendingSearchAnalytics.current = scheduled;
      } else {
        lastSearchAnalytics.current = { signature: '', token: retryToken };
      }
    }).catch(() => {
      if (controller.signal.aborted || !mountedRef.current) return;
      focusResultsOnLoad.current = false;
      setSearchState(prev => (prev && prev.requestKey === currentRequestKey ? null : prev));
      setSearchError('The search could not be completed. Please try again.');
      setBusyKind(null);
    });

    return () => {
      controller.abort();
    };
  }, [currentRequestKey, filterKey, loadError, retryToken, scheduleFocusResults, urlState]);

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
    const nextSort: SearchSort = urlState.view === 'concordance'
      ? 'age-asc'
      : resolveSortForQueryChange(urlState.sort, hadUrlQuery, hasNextQuery, hasExplicitSort);

    const nextState: SearchUrlState = {
      ...urlState,
      query: trimmedNext,
      sort: nextSort,
      page: 1,
    };
    queryDebounceTimer.current = window.setTimeout(() => {
      queryDebounceTimer.current = null;
      const mode = hadUrlQuery !== hasNextQuery || submittedDraftRef.current ? 'push' : 'replace';
      if (commitState(nextState, mode)) {
        submittedDraftRef.current = false;
      }
    }, 280);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    cancelQueryDebounce();
    pendingViewChange.current = false;
    focusResultsOnLoad.current = true;
    submittedDraftRef.current = true;
    const nextState: SearchUrlState = {
      ...currentBaseState(),
      page: 1,
    };
    const changed = commitState(nextState, 'push');
    if (!changed) {
      if (urlState.view === 'concordance' && !nextState.query) {
        focusResultsOnLoad.current = false;
        scheduleFocusResults();
      } else if (searchError || (urlState.view === 'concordance' ? !visibleConcordance : !visibleSearch)) {
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
    submittedDraftRef.current = false;
    const nextTopic = validTopicSet.has(value) ? value : '';
    trackArchiveEvent('filter_changed', { filter: 'theme', value: nextTopic });
    commitState({ ...currentBaseState(), topic: nextTopic, page: 1 }, 'push');
  };

  const handleOriginChange = (value: string) => {
    cancelQueryDebounce();
    pendingViewChange.current = false;
    focusResultsOnLoad.current = false;
    submittedDraftRef.current = false;
    const nextOrigin: TranscriptOrigin | '' = isTranscriptOrigin(value) ? value : '';
    trackArchiveEvent('filter_changed', { filter: 'origin', value: nextOrigin });
    commitState({ ...currentBaseState(), origin: nextOrigin, page: 1 }, 'push');
  };

  const handleAgeMinChange = (raw: string) => {
    cancelQueryDebounce();
    pendingViewChange.current = false;
    focusResultsOnLoad.current = false;
    submittedDraftRef.current = false;
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
    submittedDraftRef.current = false;
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
    submittedDraftRef.current = false;
    const base = currentBaseState();
    const isExplicit = isSearchSort(value);
    const nextSort: SearchSort = isExplicit ? value : defaultSortForQuery(base.query);
    trackArchiveEvent('filter_changed', { filter: 'sort', value: nextSort });
    commitState({ ...base, sort: nextSort, page: 1 }, 'push', { explicitSort: isExplicit });
  };

  const handleMarkerChange = (nextMarker: LinguisticMarkerId | '') => {
    cancelQueryDebounce();
    pendingViewChange.current = false;
    focusResultsOnLoad.current = false;
    submittedDraftRef.current = false;
    const base = currentBaseState();
    const nextSpeaker: LinguisticSpeaker = nextMarker
      ? (base.marker ? base.speaker : 'child')
      : (base.view === 'concordance' ? 'any' : 'child');
    trackArchiveEvent('filter_changed', { filter: 'marker', value: nextMarker });
    commitState({ ...base, marker: nextMarker, speaker: nextSpeaker, page: 1 }, 'push');
  };

  const handleSpeakerChange = (value: string) => {
    cancelQueryDebounce();
    pendingViewChange.current = false;
    focusResultsOnLoad.current = false;
    submittedDraftRef.current = false;
    const fallbackSpeaker: LinguisticSpeaker = !urlState.marker && urlState.view === 'concordance' ? 'any' : 'child';
    const nextSpeaker: LinguisticSpeaker = isLinguisticSpeaker(value) ? value : fallbackSpeaker;
    trackArchiveEvent('filter_changed', { filter: 'speaker', value: nextSpeaker });
    commitState({ ...currentBaseState(), speaker: nextSpeaker, page: 1 }, 'push');
  };

  const handleViewChange = (nextView: SearchView) => {
    if (nextView === urlState.view) return;
    cancelQueryDebounce();
    focusResultsOnLoad.current = false;
    submittedDraftRef.current = false;
    trackArchiveEvent('view_changed', { view: nextView });
    pendingViewChange.current = true;
    const base = currentBaseState();
    const nextSpeaker: LinguisticSpeaker = base.marker
      ? base.speaker
      : nextView === 'concordance'
        ? 'any'
        : 'child';
    const enteringConcordance = nextView === 'concordance';
    const leavingConcordance = urlState.view === 'concordance' && nextView !== 'concordance';
    const nextSort: SearchSort = enteringConcordance
      ? 'age-asc'
      : leavingConcordance
        ? defaultSortForQuery(base.query)
        : base.sort;
    const nextExplicitSort = enteringConcordance || leavingConcordance ? false : hasExplicitSort;
    commitState(
      { ...base, view: nextView, speaker: nextSpeaker, sort: nextSort, page: 1 },
      'push',
      { explicitSort: nextExplicitSort },
    );
  };

  const handleClearFilters = () => {
    cancelQueryDebounce();
    cancelFocusResultsFrame();
    focusResultsOnLoad.current = false;
    pendingViewChange.current = false;
    submittedDraftRef.current = false;
    draftQueryRef.current = '';
    setDraftQuery('');
    trackArchiveEvent('filter_changed', { filter: 'clear', value: 'all' });
    commitState({
      query: '',
      topic: '',
      origin: '',
      marker: '',
      speaker: urlState.view === 'concordance' ? 'any' : 'child',
      ageMin: undefined,
      ageMax: undefined,
      sort: 'age-asc',
      view: urlState.view,
      page: 1,
    }, 'push', { explicitSort: false });
  };

  const handlePageChange = (nextPage: number) => {
    cancelQueryDebounce();
    pendingViewChange.current = false;
    focusResultsOnLoad.current = true;
    submittedDraftRef.current = false;
    const base = currentBaseState();
    const targetPage = base.query !== urlState.query ? 1 : Math.max(1, nextPage);
    commitState({ ...base, page: targetPage }, 'push');
  };

  const flushAnalyticsBeforeNavigate = useCallback(() => {
    pendingSearchAnalytics.current?.flush();
  }, []);

  const searchBusy = busyKind !== null;
  const activePagination = isConcordance ? visibleConcordance : visibleSearch;
  const resultsHeadingText = isConcordance
    ? (visibleConcordance
      ? `${visibleConcordance.total.toLocaleString()} matching ${visibleConcordance.total === 1 ? 'passage' : 'passages'}`
      : 'Concordance')
    : (visibleSearch
      ? `${visibleSearch.total.toLocaleString()} ${visibleSearch.total === 1 ? 'session' : 'sessions'}`
      : 'Sessions');

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
                      ref={searchInputRef}
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

                  {isConcordance ? (
                    <div className="field">
                      <label htmlFor="concordance-speaker-filter">Speaker</label>
                      <select
                        id="concordance-speaker-filter"
                        name="speaker"
                        value={urlState.speaker}
                        aria-describedby="concordance-speaker-help"
                        onChange={event => handleSpeakerChange(event.target.value)}
                      >
                        <option value="any">Any speaker / unidentified</option>
                        <option value="child">Seth (CHI) only</option>
                      </select>
                    </div>
                  ) : (
                    <div className="field">
                      <label htmlFor="sort-order">Sort by</label>
                      <select id="sort-order" name="sort" value={urlState.sort} onChange={event => handleSortChange(event.target.value)}>
                        <option value="age-asc">Age, youngest first</option>
                        <option value="age-desc">Age, oldest first</option>
                        <option value="relevance">Relevance</option>
                      </select>
                    </div>
                  )}
                </div>

                {isConcordance && (
                  <p id="concordance-speaker-help" className="small muted concordance-speaker-note">
                    Concordance rows are ordered by child age, youngest first. “Seth (CHI) only” uses explicit CHI labels in archived research transcripts and never infers speaker identity in AI drafts.
                  </p>
                )}

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
                  externalSpeakerControl={isConcordance}
                />
              </form>

              {urlState.marker && (
                <p className="small muted linguistic-intersection-note">
                  {isConcordance
                    ? 'Each concordance row is a transcript passage that matches both your exact query and the selected linguistic marker in the chosen speaker scope. Passage counts are not normalized frequencies.'
                    : 'Each result has matching transcript passages. Text search, theme, age range, and transcript origin filters narrow the same session; their matches may occur elsewhere in it. Passage counts are not normalized frequencies.'}
                </p>
              )}

              <div className="results-toolbar">
                <h2 ref={resultHeading} tabIndex={-1}>
                  {resultsHeadingText}
                </h2>
                {hasFilters && (
                  <button type="button" className="text-button small" onClick={handleClearFilters}>
                    <X size={15} aria-hidden="true" />
                    Clear filters
                  </button>
                )}
                <div className="session-view-control" role="group" aria-label="Results view">
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
                  <button
                    type="button"
                    className="button secondary theme-shortcut"
                    aria-pressed={urlState.view === 'concordance'}
                    aria-describedby="session-view-help"
                    onClick={() => handleViewChange('concordance')}
                  >
                    Concordance
                  </button>
                </div>
                <p className="small muted search-status" role="status">
                  {isConcordance
                    ? formatConcordanceStatus(visibleConcordance, busyKind, Boolean(urlState.query))
                    : formatSearchStatus(visibleSearch, busyKind)}
                </p>
              </div>

              <p id="session-view-help" className="small muted results-reading-note">
                {urlState.view === 'concordance'
                  ? 'Concordance lists up to 50 exact transcript passage matches per page, ordered by child age (youngest first). Guide prose and meaning-based hits never appear; labels identify the transcript origin and mark machine drafts as unreviewed.'
                  : urlState.view === 'list'
                    ? 'List shows up to 36 sessions per page; expand a match to see source excerpts. Session guides are AI-written; labels identify the transcript origin.'
                    : 'Details shows up to 18 sessions per page with guide overviews and source excerpts. Session guides are AI-written; labels identify the transcript origin.'}
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
                {isConcordance ? (
                  !urlState.query ? (
                    <div className="empty-state concordance-empty-query">
                      <Search size={28} aria-hidden="true" />
                      <h3>Enter an exact search query for a concordance</h3>
                      <p>
                        A concordance aligns every matching transcript passage around your exact word, phrase, or CHAT notation, ordered by child age. It contains exact transcript matches only—guide summaries and meaning-based matches are excluded, so it requires a search query.
                      </p>
                      <div className="concordance-empty-actions">
                        <button
                          type="button"
                          className="button primary"
                          onClick={() => searchInputRef.current?.focus()}
                        >
                          Focus search box
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => handleViewChange('details')}
                        >
                          Switch to Details view
                        </button>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => handleViewChange('list')}
                        >
                          Switch to List view
                        </button>
                      </div>
                    </div>
                  ) : visibleConcordance && visibleConcordance.rows.length > 0 ? (
                    <ConcordanceTable
                      concordance={visibleConcordance}
                      returnTo={canonicalHref}
                      onBeforeSessionNavigate={flushAnalyticsBeforeNavigate}
                    />
                  ) : null
                ) : (
                  visibleSearch && (
                    <SessionResults
                      results={visibleSearch.results}
                      view={urlState.view === 'list' ? 'list' : 'details'}
                      firstIndex={(visibleSearch.page - 1) * visibleSearch.pageSize + 1}
                      speaker={visibleSpeaker}
                      headingLevel={3}
                      returnTo={canonicalHref}
                      linkPassagesToSessionRoute
                      onBeforeSessionNavigate={flushAnalyticsBeforeNavigate}
                    />
                  )
                )}
              </div>

              {isConcordance && urlState.query && visibleConcordance && !visibleConcordance.rows.length && !searchBusy && (
                <div className="empty-state">
                  <Search size={28} aria-hidden="true" />
                  <h3>No exact transcript matches found</h3>
                  <p>
                    Concordance checks spoken transcript passages only (not AI-written session guides or titles) for your exact word, phrase, or notation. Try a different spelling, switch to Any speaker / unidentified, loosen your age or origin filters, or check guide matches in Details view.
                  </p>
                  <div className="concordance-empty-actions">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => handleViewChange('details')}
                    >
                      View in Details
                    </button>
                  </div>
                </div>
              )}

              {!isConcordance && visibleSearch && !visibleSearch.results.length && !searchBusy && (
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

              {activePagination && activePagination.pages > 1 && (
                <nav
                  className="pagination"
                  aria-label={isConcordance ? 'Concordance result pages' : 'Search result pages'}
                >
                  <button
                    className="button secondary"
                    type="button"
                    disabled={activePagination.page <= 1 || searchBusy}
                    onClick={() => handlePageChange(activePagination.page - 1)}
                  >
                    <ChevronLeft size={17} aria-hidden="true" />
                    Previous
                  </button>
                  <span className="small">Page {activePagination.page} of {activePagination.pages}</span>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={activePagination.page >= activePagination.pages || searchBusy}
                    onClick={() => handlePageChange(activePagination.page + 1)}
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
