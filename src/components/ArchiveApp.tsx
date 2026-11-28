'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Download, Headphones, Search, Share2, X } from 'lucide-react';
import type { Catalog, SearchResponse, SearchSort, TranscriptOrigin } from '../lib/types';
import { trackArchiveEvent } from '../lib/analytics';
import { isLinguisticMarkerId, isLinguisticSpeaker, type LinguisticMarkerId, type LinguisticSpeaker } from '../lib/linguistic-markers';
import { adaptSearchForView, formatSearchStatus, isSearchSort, pageSizeForView, type SearchBusyKind, type SessionView } from '../lib/results-view';
import { ARCHIVE_NAME, ARCHIVE_SUBTITLE, formatDocumentTitle } from '../lib/site';
import ArchiveMarkdown from './ArchiveMarkdown';
import ArchiveAnalytics from './ArchiveAnalytics';
import LinguisticFilters from './LinguisticFilters';
import SessionDetail from './SessionDetail';
import SessionResults from './SessionResults';
import ThemeControl from './ThemeControl';
import { positiveThemes, ThemeShortcuts } from './TopicThemes';
import { request, transcriptOriginLabels } from './api';

type Section = 'overview' | 'sessions' | 'research';
type LoadState = 'loading' | 'ready' | 'error';
type SearchFilters = { query: string; topic: string; origin: TranscriptOrigin | ''; marker: LinguisticMarkerId | ''; speaker: LinguisticSpeaker; sort: SearchSort; page: number; linguisticsOpen: boolean; view?: SessionView };
// Keep the existing localStorage key so returning readers preserve their saved Details/List preference.
const VIEW_STORAGE_KEY = 'balloons-and-bananas:recordings-view';

function analyticsSection(section: Section): 'overview' | 'recordings' | 'research' {
  // Analytics wire values stay unchanged ('recordings') per the telemetry contract.
  return section === 'sessions' ? 'recordings' : section;
}

function parseSavedSection(value: unknown): Section | null {
  if (value === 'recordings') return 'sessions';
  if (value === 'overview' || value === 'sessions' || value === 'research') return value;
  return null;
}

function markerFilters(params: URLSearchParams): SearchFilters | null {
  const marker = params.get('marker');
  if (!isLinguisticMarkerId(marker)) return null;
  const speaker = params.get('speaker');
  return { query: '', topic: '', origin: '', marker, speaker: isLinguisticSpeaker(speaker) ? speaker : 'child', sort: 'age-asc', page: 1, linguisticsOpen: true };
}

function savedFilters(value: unknown): SearchFilters | null {
  if (!value || typeof value !== 'object') return null;
  const filters = value as Partial<SearchFilters>;
  if (typeof filters.query !== 'string' || typeof filters.topic !== 'string'
    || typeof filters.origin !== 'string' || !['', 'archived_research', 'talkbank_ai_draft', 'local_ai_draft'].includes(filters.origin)
    || (filters.marker !== '' && !isLinguisticMarkerId(filters.marker)) || !isLinguisticSpeaker(filters.speaker)
    || !isSearchSort(filters.sort) || !Number.isSafeInteger(filters.page) || (filters.page ?? 0) < 1
    || typeof filters.linguisticsOpen !== 'boolean'
    || (filters.view !== undefined && filters.view !== 'details' && filters.view !== 'list')) return null;
  return filters as SearchFilters;
}

// Public links use one-based passage numbers; transcript arrays remain zero-based.
function readPassageParameter(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const passage = Number(value);
  return Number.isSafeInteger(passage) ? passage : null;
}

function CollectionMark() {
  return <span className="collection-mark" aria-hidden="true"><span /><span /></span>;
}

export default function ArchiveApp() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadMessage, setLoadMessage] = useState('');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [section, setSection] = useState<Section>('overview');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [passage, setPassage] = useState<number | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [homeQuery, setHomeQuery] = useState('');
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('');
  const [origin, setOrigin] = useState<TranscriptOrigin | ''>('');
  const [marker, setMarker] = useState<LinguisticMarkerId | ''>('');
  const [speaker, setSpeaker] = useState<LinguisticSpeaker>('child');
  const [linguisticsOpen, setLinguisticsOpen] = useState(false);
  const [sort, setSort] = useState<SearchSort>('age-asc');
  const [page, setPage] = useState(1);
  const [sessionView, setSessionView] = useState<SessionView>('details');
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [searchSpeaker, setSearchSpeaker] = useState<LinguisticSpeaker>('child');
  const [busyKind, setBusyKind] = useState<SearchBusyKind>(null);
  const [searchError, setSearchError] = useState('');
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [loadedSession, setLoadedSession] = useState<{ id: string; title: string | null; notFound: boolean } | null>(null);
  const [shareState, setShareState] = useState<'idle' | 'busy' | 'copied' | 'manual' | 'error'>('idle');
  const [shareUrl, setShareUrl] = useState('');
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const focusResultsOnLoad = useRef(false);
  const focusResultsFrame = useRef<number | null>(null);
  const loadedSearchRef = useRef<{ filterKey: string; response: SearchResponse } | null>(null);
  const debounceNextSearch = useRef(false);
  const pendingViewChange = useRef(false);
  const shareInput = useRef<HTMLInputElement>(null);
  const documentHeading = useRef<HTMLHeadingElement>(null);
  const pendingSearchAnalytics = useRef<{ flush: () => void; cancel: () => void } | null>(null);
  const lastSearchAnalytics = useRef<{ signature: string; attempt: number } | null>(null);

  const cancelFocusResultsFrame = useCallback(() => {
    if (focusResultsFrame.current !== null) {
      window.cancelAnimationFrame(focusResultsFrame.current);
      focusResultsFrame.current = null;
    }
  }, []);

  useEffect(() => () => cancelFocusResultsFrame(), [cancelFocusResultsFrame]);

  const restoreFilters = useCallback((filters: SearchFilters) => {
    setQuery(filters.query); setTopic(filters.topic); setOrigin(filters.origin);
    setMarker(filters.marker); setSpeaker(filters.speaker); setSort(filters.sort);
    setPage(filters.page); setLinguisticsOpen(filters.linguisticsOpen);
    if (filters.view) setSessionView(filters.view);
  }, []);

  useEffect(() => {
    try {
      const value = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (value === 'details' || value === 'list') setSessionView(value);
    } catch {
      // Details remains the default when browser preferences are unavailable.
    }
  }, []);

  const changeSessionView = (value: SessionView) => {
    if (value === sessionView) return;
    trackArchiveEvent('view_changed', { view: value });
    pendingViewChange.current = true;
    setSessionView(value);
    setPage(1);
    try { window.localStorage.setItem(VIEW_STORAGE_KEY, value); } catch {
      // The selected view still works for this visit.
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoadState('loading');
    setLoadMessage('');
    const bootstrap = async () => {
      try {
        // Old shared links remain usable; fragments never reach analytics.
        const clean = new URL(window.location.href);
        if (clean.hash) {
          clean.hash = '';
          window.history.replaceState(window.history.state, '', clean.pathname + clean.search);
        }
        const nextCatalog = await request<Catalog>('/api/catalog', { signal: controller.signal });
        if (controller.signal.aborted) return;
        const params = new URLSearchParams(window.location.search);
        const id = params.get('entry');
        const doc = params.get('document');
        const requestedSection = parseSavedSection(params.get('section'));
        const filterLink = !id && !doc ? markerFilters(params) : null;
        const saved = !id && !doc ? savedFilters(window.history.state?.archiveFilters) : null;
        const savedSection = !id && !doc ? parseSavedSection(window.history.state?.archiveSection) : null;
        setCatalog(nextCatalog);
        setSessionId(id);
        setPassage(id ? readPassageParameter(params.get('passage')) : null);
        setDocumentId(id ? null : doc);
        if (id) {
          setSection('sessions');
        } else if (doc) {
          setSection('research');
        } else if (filterLink) {
          restoreFilters(saved?.marker === filterLink.marker && saved.speaker === filterLink.speaker ? saved : filterLink);
          setSection('sessions');
        } else if (requestedSection) {
          if (requestedSection === 'sessions' && saved) restoreFilters(saved);
          setSection(requestedSection);
        } else if (savedSection) {
          if (savedSection === 'sessions' && saved) restoreFilters(saved);
          setSection(savedSection);
        }
        setLoadState('ready');
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadState('error');
        setLoadMessage('The archive could not be opened just now. Please try again.');
      }
    };
    void bootstrap();
    return () => controller.abort();
  }, [bootstrapAttempt, restoreFilters]);

  useEffect(() => {
    const onFragmentChange = () => {
      const clean = new URL(window.location.href);
      if (!clean.hash) return;
      clean.hash = '';
      window.history.replaceState(window.history.state, '', clean.pathname + clean.search);
    };
    window.addEventListener('hashchange', onFragmentChange);
    return () => window.removeEventListener('hashchange', onFragmentChange);
  }, []);

  useEffect(() => {
    const onHistory = () => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('entry');
      setSessionId(id);
      setPassage(id ? readPassageParameter(params.get('passage')) : null);
      const doc = params.get('document');
      setDocumentId(id ? null : doc);
      const filterLink = !id && !doc ? markerFilters(params) : null;
      const saved = savedFilters(window.history.state?.archiveFilters);
      if (filterLink) restoreFilters(saved?.marker === filterLink.marker && saved.speaker === filterLink.speaker ? saved : filterLink);
      else if (saved) restoreFilters(saved);
      const savedSection = parseSavedSection(window.history.state?.archiveSection);
      const requestedSection = parseSavedSection(params.get('section'));
      setSection(id || filterLink ? 'sessions' : doc ? 'research' : savedSection ?? requestedSection ?? 'overview');
      setShareState('idle');
      setShareUrl('');
    };
    window.addEventListener('popstate', onHistory);
    return () => window.removeEventListener('popstate', onHistory);
  }, [restoreFilters]);

  // Keep public marker links current, while text/theme filters stay in this
  // browser's history state rather than being exposed in the URL.
  useEffect(() => {
    if (loadState !== 'ready' || section !== 'sessions' || sessionId || documentId) return;
    const url = new URL(window.location.href);
    if (marker) { url.searchParams.set('marker', marker); url.searchParams.set('speaker', speaker); }
    else { url.searchParams.delete('marker'); url.searchParams.delete('speaker'); }
    const archiveFilters: SearchFilters = { query, topic, origin, marker, speaker, sort, page, linguisticsOpen, view: sessionView };
    window.history.replaceState({ ...window.history.state, archiveSection: 'sessions', archiveFilters }, '', url.pathname + url.search + url.hash);
  }, [loadState, documentId, sessionId, linguisticsOpen, marker, origin, page, query, sessionView, section, sort, speaker, topic]);

  useEffect(() => {
    if (loadState !== 'ready' || section !== 'sessions' || sessionId) {
      debounceNextSearch.current = false;
      pendingViewChange.current = false;
      setBusyKind(null);
      return;
    }
    const targetPageSize = pageSizeForView(sessionView);
    const filterKey = JSON.stringify({ query, topic, origin, sort, marker, speaker, searchAttempt });
    const loaded = loadedSearchRef.current;
    const sameFilters = loaded !== null && loaded.filterKey === filterKey;

    if (sameFilters && page === 1) {
      const adapted = adaptSearchForView(loaded.response, sessionView);
      if (adapted) {
        debounceNextSearch.current = false;
        pendingViewChange.current = false;
        setSearch(adapted);
        setSearchError('');
        setBusyKind(null);
        return;
      }
    }

    const controller = new AbortController();
    let pendingAnalytics: { flush: () => void; cancel: () => void } | null = null;
    const isViewOnlyChange = pendingViewChange.current && sameFilters && !debounceNextSearch.current;
    const delay = debounceNextSearch.current && query && !focusResultsOnLoad.current ? 280 : 0;

    setBusyKind(isViewOnlyChange ? 'view' : 'search');
    setSearchError('');
    const timer = window.setTimeout(() => {
      debounceNextSearch.current = false;
      pendingViewChange.current = false;
      void request<SearchResponse>('/api/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, topic, origin, page, sort, marker, speaker, pageSize: targetPageSize }), signal: controller.signal,
      }).then(data => {
        if (!controller.signal.aborted) {
          loadedSearchRef.current = { filterKey, response: data };
          setSearch(data); setSearchSpeaker(speaker); setBusyKind(null);
          if (focusResultsOnLoad.current) {
            focusResultsOnLoad.current = false;
            cancelFocusResultsFrame();
            focusResultsFrame.current = window.requestAnimationFrame(() => {
              focusResultsFrame.current = null;
              resultHeading.current?.focus();
            });
          }
          const trimmedQuery = query.trim();
          const repeatedSubmission = searchAttempt > (lastSearchAnalytics.current?.attempt || 0);
          if (trimmedQuery || topic || origin || marker || data.page > 1 || repeatedSubmission) {
            // Query text is only an in-memory duplicate key, never event data.
            const signature = JSON.stringify({ query: trimmedQuery, topic, origin, marker, speaker, sort, page: data.page });
            let emitted = false;
            const emit = () => {
              if (controller.signal.aborted || emitted) return;
              emitted = true;
              if (lastSearchAnalytics.current?.signature === signature && lastSearchAnalytics.current.attempt === searchAttempt) return;
              lastSearchAnalytics.current = { signature, attempt: searchAttempt };
              trackArchiveEvent('search_completed', {
                queryLength: Math.min(300, trimmedQuery.length), wordCount: trimmedQuery ? Math.min(300, trimmedQuery.split(/\s+/).length) : 0,
                results: data.total, page: data.page, view: sessionView, origin, marker, theme: topic,
              });
            };
            const analyticsTimer = window.setTimeout(emit, 750);
            pendingAnalytics = { flush: () => { window.clearTimeout(analyticsTimer); emit(); }, cancel: () => window.clearTimeout(analyticsTimer) };
            pendingSearchAnalytics.current = pendingAnalytics;
          } else {
            lastSearchAnalytics.current = { signature: '', attempt: searchAttempt };
          }
        }
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return;
        focusResultsOnLoad.current = false;
        setSearchError('The search could not be completed. Please try again.'); setBusyKind(null);
      });
    }, delay);
    return () => {
      window.clearTimeout(timer); controller.abort(); pendingAnalytics?.cancel();
      if (pendingSearchAnalytics.current === pendingAnalytics) pendingSearchAnalytics.current = null;
    };
  }, [cancelFocusResultsFrame, loadState, sessionId, marker, origin, page, query, sessionView, searchAttempt, section, sort, speaker, topic]);

  useEffect(() => {
    if (shareState === 'manual') { shareInput.current?.focus(); shareInput.current?.select(); }
  }, [shareState]);

  const navigate = useCallback((next: Section, id: string | null = null, doc: string | null = null, nextPassage: number | null = null, nextMarker: LinguisticMarkerId | '' = '') => {
    if (next !== 'sessions' || id || doc) {
      focusResultsOnLoad.current = false;
      cancelFocusResultsFrame();
    }
    if (!id && !doc && (next !== section || sessionId || documentId)) trackArchiveEvent('section_view', { section: analyticsSection(next) });
    const url = new URL(window.location.href);
    url.searchParams.delete('section');
    if (id) url.searchParams.set('entry', id); else url.searchParams.delete('entry');
    if (doc) url.searchParams.set('document', doc); else url.searchParams.delete('document');
    if (nextMarker && next === 'sessions' && !id && !doc) { url.searchParams.set('marker', nextMarker); url.searchParams.set('speaker', 'any'); }
    else { url.searchParams.delete('marker'); url.searchParams.delete('speaker'); }
    const targetPassage = id && nextPassage !== null && Number.isSafeInteger(nextPassage) && nextPassage > 0 ? nextPassage : null;
    if (targetPassage !== null) url.searchParams.set('passage', String(targetPassage)); else url.searchParams.delete('passage');
    window.history.pushState({ ...window.history.state, archiveSection: next }, '', url.pathname + url.search + url.hash);
    setSection(next);
    setSessionId(id);
    setPassage(targetPassage);
    setDocumentId(doc);
    setShareState('idle');
    setShareUrl('');
    window.scrollTo({ top: 0, behavior: 'instant' });
    window.requestAnimationFrame(() => {
      if (targetPassage !== null || focusResultsOnLoad.current) return;
      const heading = document.querySelector<HTMLElement>('#main h2');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    });
  }, [cancelFocusResultsFrame, documentId, sessionId, section]);

  const startArchiveSearch = (nextQuery = '', nextTopic = '') => {
    const trimmedQuery = nextQuery.trim();
    // The home page searches the whole collection, regardless of earlier filters.
    // Omitting view preserves the reader's Details/List preference.
    focusResultsOnLoad.current = true;
    debounceNextSearch.current = false;
    pendingViewChange.current = false;
    loadedSearchRef.current = null;
    restoreFilters({ query: trimmedQuery, topic: nextTopic, origin: '', marker: '', speaker: 'child', sort: trimmedQuery ? 'relevance' : 'age-asc', page: 1, linguisticsOpen: false });
    setSearch(null);
    setSearchError('');
    setBusyKind('search');
    setSearchAttempt(value => value + 1);
    navigate('sessions');
  };

  const handleSessionState = useCallback((state: { id: string; title: string | null; notFound: boolean }) => {
    setLoadedSession(current =>
      current && current.id === state.id && current.title === state.title && current.notFound === state.notFound
        ? current
        : state,
    );
  }, []);

  const prepareSessionNavigation = useCallback(() => {
    pendingSearchAnalytics.current?.flush();
    const url = new URL(window.location.href);
    if (marker) { url.searchParams.set('marker', marker); url.searchParams.set('speaker', speaker); }
    else { url.searchParams.delete('marker'); url.searchParams.delete('speaker'); }
    const archiveFilters: SearchFilters = { query, topic, origin, marker, speaker, sort, page, linguisticsOpen, view: sessionView };
    window.history.replaceState({ ...window.history.state, archiveSection: 'sessions', archiveFilters }, '', url.pathname + url.search + url.hash);
  }, [linguisticsOpen, marker, origin, page, query, sessionView, sort, speaker, topic]);

  const openSession = useCallback((id: string) => { pendingSearchAnalytics.current?.flush(); navigate('sessions', id); }, [navigate]);
  const openResultPassage = useCallback((id: string, targetPassage: number) => { pendingSearchAnalytics.current?.flush(); navigate('sessions', id, null, targetPassage); }, [navigate]);
  const openDocument = useCallback((id: string) => { trackArchiveEvent('research_open', { documentId: id, action: 'read' }); navigate('research', null, id); }, [navigate]);
  const openMarker = useCallback((value: LinguisticMarkerId, sourcePassage: number) => {
    // Returning from marker results should land on the symbol that was opened,
    // including when the reader reached it by scrolling an ordinary session.
    if (sessionId && Number.isSafeInteger(sourcePassage) && sourcePassage > 0) {
      const sourceUrl = new URL(window.location.href);
      sourceUrl.searchParams.set('passage', String(sourcePassage));
      window.history.replaceState(window.history.state, '', sourceUrl.pathname + sourceUrl.search + sourceUrl.hash);
    }
    restoreFilters({ query: '', topic: '', origin: '', marker: value, speaker: 'any', sort: 'age-asc', page: 1, linguisticsOpen: true });
    navigate('sessions', null, null, null, value);
  }, [sessionId, navigate, restoreFilters]);

  useEffect(() => { if (documentId && catalog) documentHeading.current?.focus(); }, [documentId, catalog]);

  const copyShareLink = async () => {
    setShareState('busy');
    try {
      const url = new URL(window.location.pathname, window.location.origin);
      if (sessionId) url.searchParams.set('entry', sessionId);
      else url.searchParams.delete('entry');
      if (sessionId && passage !== null) url.searchParams.set('passage', String(passage));
      else url.searchParams.delete('passage');
      if (documentId) url.searchParams.set('document', documentId);
      else url.searchParams.delete('document');
      if (section === 'sessions' && !sessionId && !documentId && marker) { url.searchParams.set('marker', marker); url.searchParams.set('speaker', speaker); }
      else { url.searchParams.delete('marker'); url.searchParams.delete('speaker'); }
      const text = url.toString();
      setShareUrl(text);
      try {
        await navigator.clipboard.writeText(text);
        setShareState('copied');
        trackArchiveEvent('share_link', { outcome: 'copied' });
      } catch {
        setShareState('manual');
        trackArchiveEvent('share_link', { outcome: 'manual' });
      }
    } catch (error) {
      trackArchiveEvent('share_link', { outcome: 'error' });
      setShareState('error');
    }
  };

  const searchBusy = busyKind !== null;
  const hasFilters = Boolean(query || topic || origin || marker);
  const selectedDocument = catalog?.documents.find(document => document.id === documentId);
  const cachedSessionTitle = sessionId ? search?.results.find(item => item.session.id === sessionId)?.session.title : undefined;
  const sessionMeta = sessionId && loadedSession?.id === sessionId ? loadedSession : null;
  const documentTitle = loadState === 'loading'
    ? formatDocumentTitle({ kind: 'loading' })
    : loadState === 'error' || !catalog
      ? formatDocumentTitle({ kind: 'error' })
      : sessionId
        ? formatDocumentTitle({ kind: 'session', title: sessionMeta?.title ?? cachedSessionTitle, notFound: sessionMeta?.notFound })
        : documentId
          ? formatDocumentTitle({ kind: 'document', title: selectedDocument?.title })
          : section === 'sessions'
            ? formatDocumentTitle({ kind: 'sessions', hasFilters })
            : section === 'research'
              ? formatDocumentTitle({ kind: 'research' })
              : formatDocumentTitle({ kind: 'overview' });

  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);

  if (loadState !== 'ready' || !catalog) return <div className="entrance">
    <header className="entrance-brand"><span className="entrance-wordmark"><CollectionMark /><span>{ARCHIVE_NAME}</span></span><ThemeControl /></header>
    <main id="main" className="entrance-content">
      <h1>{ARCHIVE_NAME}</h1>
      <p className="entrance-description" role={loadState === 'error' ? 'alert' : 'status'}>{loadState === 'loading' ? 'Opening the archive…' : loadMessage}</p>
      {loadState === 'error' && <button type="button" className="button primary" onClick={() => setBootstrapAttempt(value => value + 1)}>Try again<ArrowRight size={17} aria-hidden="true" /></button>}
    </main>
    <footer className="entrance-footer">Sessions, recordings, transcripts, and research</footer>
  </div>;

  const overviewDocs = catalog.documents.filter(document => document.category === 'overview');
  const researchDocs = catalog.documents.filter(document => document.category !== 'overview');

  return <div className="archive-shell">
    <ArchiveAnalytics ready={loadState === 'ready'} section={section} sessionId={sessionId} documentId={documentId} />
    <a className="skip-link" href="#main">Skip to main content</a>
    <header className="site-header">
      <div className="top-bar"><button className="brand-button" type="button" onClick={() => navigate('overview')} aria-label={`${ARCHIVE_NAME}, collection overview`}><CollectionMark /><span>{ARCHIVE_NAME}</span></button><span className="unlisted-label">Unlisted archive</span><ThemeControl /><button className="button share-button" type="button" disabled={shareState === 'busy'} onClick={() => void copyShareLink()}>{shareState === 'copied' ? <Check size={16} aria-hidden="true" /> : <Share2 size={16} aria-hidden="true" />}<span>{shareState === 'busy' ? 'Preparing…' : shareState === 'copied' ? 'Link copied' : 'Copy share link'}</span></button></div>
      <div className="share-feedback" role="status">{shareState === 'copied' ? 'Link copied. Anyone can open this archive at its URL.' : shareState === 'error' ? 'That action could not be completed. Please try again.' : ''}</div>
      {shareState === 'manual' && <div className="manual-share"><label htmlFor="share-link">Copy this archive link</label><div><input ref={shareInput} id="share-link" value={shareUrl} readOnly /><button type="button" className="button secondary" onClick={() => { setShareState('idle'); setShareUrl(''); }}><X size={16} aria-hidden="true" />Close</button></div><p className="small muted">Anyone can open this archive at its URL.</p></div>}
      <div className={`masthead ${section !== 'overview' || sessionId || documentId ? 'compact' : ''}`}>
        <h1>{catalog.title}</h1>
        {section === 'overview' && !sessionId && !documentId && <p>{ARCHIVE_SUBTITLE}</p>}
      </div>
      <nav className="section-nav" aria-label="Collection sections">{(['overview', 'sessions', 'research'] as const).map(item => <button key={item} type="button" onClick={() => navigate(item)} aria-current={section === item ? 'page' : undefined}>{item === 'overview' ? 'Overview' : item === 'sessions' ? 'Sessions' : 'Research & context'}{item === 'sessions' && <span className="nav-count">{catalog.counts.sessions}</span>}</button>)}</nav>
    </header>
    <main id="main" tabIndex={-1}>
      {sessionId ? <SessionDetail id={sessionId} passage={passage} onMarker={openMarker} onDocument={openDocument} onSessionState={handleSessionState} onBack={() => navigate('sessions')} /> : documentId ? <article className="document-detail"><button className="text-button back-button" type="button" onClick={() => navigate('research')}><ArrowLeft size={17} aria-hidden="true" />Back to research &amp; context</button><h2 ref={documentHeading} tabIndex={-1}>{selectedDocument?.title || 'Document not found'}</h2>{selectedDocument ? <><p className="section-intro">{selectedDocument.description}</p>{selectedDocument.markdown && <ArchiveMarkdown text={selectedDocument.markdown} documentTitle={selectedDocument.title} baseHeadingLevel={3} onSession={openSession} onDocument={openDocument} />}<div className="document-downloads">{selectedDocument.assets.map(asset => <a key={asset.id} className="button secondary" href={`/api/assets/${encodeURIComponent(asset.id)}`} download={asset.name} referrerPolicy="no-referrer" onClick={() => trackArchiveEvent('research_open', { documentId: selectedDocument.id, action: 'download', assetId: asset.id })} onAuxClick={event => { if (event.button === 1) trackArchiveEvent('research_open', { documentId: selectedDocument.id, action: 'download', assetId: asset.id }); }}><Download size={16} aria-hidden="true" />{asset.label}</a>)}</div></> : <p>The document in this link is not available in the collection.</p>}</article> : section === 'overview' ? <>
        <section className="home-search-section" aria-labelledby="home-search-heading">
          <form className="home-search-form" role="search" aria-labelledby="home-search-heading" onSubmit={event => { event.preventDefault(); startArchiveSearch(homeQuery); }}>
            <h2 id="home-search-heading"><label htmlFor="home-search">Search the archive</label></h2>
            <div className="home-search-controls">
              <input id="home-search" type="search" value={homeQuery} onChange={event => setHomeQuery(event.target.value)} placeholder="Name, place, or phrase" aria-describedby="home-search-help" autoComplete="off" spellCheck={false} />
              <button className="button primary" type="submit"><Search size={19} aria-hidden="true" />Search</button>
            </div>
            <p id="home-search-help">Searches session guides and full transcripts.</p>
          </form>
        </section>
        <section className="theme-discovery" aria-labelledby="theme-discovery-heading">
          <h2 id="theme-discovery-heading">Browse by theme</h2>
          <ThemeShortcuts topics={catalog.topics} onSelect={value => { trackArchiveEvent('filter_changed', { filter: 'theme', value }); startArchiveSearch('', value); }} />
          <p className="theme-help">Themes come from the AI-written guides; each session links back to its source transcript.</p>
        </section>
        <div className="collection-note"><p><strong>{catalog.counts.sessions}</strong> {catalog.counts.sessions === 1 ? 'session' : 'sessions'} <span aria-hidden="true">·</span> <strong>{catalog.counts.recordings}</strong> original {catalog.counts.recordings === 1 ? 'recording' : 'recordings'}, including alternate formats</p><button type="button" className="text-button" onClick={() => navigate('research')}>About the research<ArrowRight size={15} aria-hidden="true" /></button></div>
        <aside className="source-key" aria-labelledby="source-key-heading"><h2 id="source-key-heading">About the transcripts</h2><p>Archived research transcripts are kept separate from TalkBank AI drafts and local AI drafts. Each session’s guide is AI-written and remains separate from its source transcript.</p><div className="badge-row"><span className="origin-badge archived_research">{catalog.counts.original} archived research</span><span className="origin-badge talkbank_ai_draft">{catalog.counts.talkbankAi} {catalog.counts.talkbankAi === 1 ? 'TalkBank AI draft' : 'TalkBank AI drafts'}</span><span className="origin-badge local_ai_draft">{catalog.counts.localAi} {catalog.counts.localAi === 1 ? 'local AI draft' : 'local AI drafts'}</span></div></aside>
        <p className="audio-edition-note small muted"><Headphones size={16} aria-hidden="true" />Open a session to listen to its recordings in MP3 and follow the transcript. Original recordings are preserved; converted listening copies are labeled separately.</p>
        {overviewDocs.length > 0 && <section className="overview-context" aria-label="Archive background">{overviewDocs.map(document => <div key={document.id} className="context-document">{document.markdown ? <ArchiveMarkdown text={document.markdown} onSession={openSession} onDocument={openDocument} /> : <><h2>{document.title}</h2><p>{document.description}</p></>}{document.assets.length > 0 && <div className="document-downloads">{document.assets.map(asset => <a key={asset.id} className="text-link" href={`/api/assets/${encodeURIComponent(asset.id)}`} download={asset.name} referrerPolicy="no-referrer" onClick={() => trackArchiveEvent('research_open', { documentId: document.id, action: 'download', assetId: asset.id })} onAuxClick={event => { if (event.button === 1) trackArchiveEvent('research_open', { documentId: document.id, action: 'download', assetId: asset.id }); }}><Download size={16} aria-hidden="true" />{asset.label}</a>)}</div>}</div>)}</section>}
      </> : section === 'sessions' ? <section className="browse-section" aria-labelledby="browse-heading">
        <div className="section-heading browse-heading"><h2 id="browse-heading">Find a session</h2></div>
        <form className="search-form" onSubmit={event => { event.preventDefault(); focusResultsOnLoad.current = true; debounceNextSearch.current = false; pendingViewChange.current = false; setPage(1); setSearchAttempt(value => value + 1); }} role="search" aria-label="Search the collection">
          <div className="field main-search"><label htmlFor="archive-search">Search sessions and transcripts</label><div className="search-input"><Search size={21} aria-hidden="true" /><input id="archive-search" type="search" value={query} onChange={event => { focusResultsOnLoad.current = false; debounceNextSearch.current = true; pendingViewChange.current = false; cancelFocusResultsFrame(); const next = event.target.value; const hadQuery = Boolean(query.trim()); const hasNextQuery = Boolean(next.trim()); setQuery(next); setPage(1); if (!hadQuery && hasNextQuery) setSort('relevance'); else if (hadQuery && !hasNextQuery && sort === 'relevance') setSort('age-asc'); }} placeholder="Name, place, or phrase" autoComplete="off" spellCheck={false} /><button type="submit" className="search-submit" aria-label="Search"><ArrowRight size={20} aria-hidden="true" /></button></div></div>
          <div className="filter-row"><div className="field"><label htmlFor="topic-filter">Theme</label><select id="topic-filter" value={topic} onChange={event => { trackArchiveEvent('filter_changed', { filter: 'theme', value: event.target.value }); setTopic(event.target.value); setPage(1); }}><option value="">All themes</option>{positiveThemes.map(theme => { const item = catalog.topics.find(value => value.name === theme.topic); return item ? <option key={theme.topic} value={theme.topic}>{theme.label} ({item.count})</option> : null; })}</select></div><div className="field"><label htmlFor="origin-filter">Transcript origin</label><select id="origin-filter" value={origin} onChange={event => { trackArchiveEvent('filter_changed', { filter: 'origin', value: event.target.value }); setOrigin(event.target.value as TranscriptOrigin | ''); setPage(1); }}><option value="">All origins</option>{Object.entries(transcriptOriginLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="field"><label htmlFor="sort-order">Sort by</label><select id="sort-order" value={sort} onChange={event => { trackArchiveEvent('filter_changed', { filter: 'sort', value: event.target.value }); setSort(event.target.value as SearchSort); setPage(1); }}><option value="age-asc">Age, youngest first</option><option value="age-desc">Age, oldest first</option><option value="relevance">Relevance</option></select></div></div>
          <LinguisticFilters marker={marker} speaker={speaker} open={linguisticsOpen} onOpen={setLinguisticsOpen} onMarker={value => { trackArchiveEvent('filter_changed', { filter: 'marker', value }); setMarker(value); setPage(1); }} onSpeaker={value => { trackArchiveEvent('filter_changed', { filter: 'speaker', value }); setSpeaker(value); setPage(1); }} />
        </form>
        {marker && <p className="small muted linguistic-intersection-note">Each result has matching transcript passages. Text search, theme, and transcript origin filters narrow the same session; their matches may occur elsewhere in it. Passage counts are not normalized frequencies.</p>}
        <div className="results-toolbar"><h3 ref={resultHeading} tabIndex={-1}>{search ? `${search.total.toLocaleString()} ${search.total === 1 ? 'session' : 'sessions'}` : 'Sessions'}</h3>{hasFilters && <button type="button" className="text-button small" onClick={() => { trackArchiveEvent('filter_changed', { filter: 'clear', value: 'all' }); setQuery(''); setTopic(''); setOrigin(''); setMarker(''); setSpeaker('child'); setPage(1); setSort('age-asc'); }}><X size={15} aria-hidden="true" />Clear filters</button>}<div className="session-view-control" role="group" aria-label="Session view"><span className="small muted">View</span><button type="button" className="button secondary theme-shortcut" aria-pressed={sessionView === 'details'} aria-describedby="session-view-help" onClick={() => changeSessionView('details')}>Details</button><button type="button" className="button secondary theme-shortcut" aria-pressed={sessionView === 'list'} aria-describedby="session-view-help" onClick={() => changeSessionView('list')}>List</button></div><p className="small muted search-status" role="status">{formatSearchStatus(search, busyKind)}</p></div>
        <p id="session-view-help" className="small muted results-reading-note">{sessionView === 'list' ? 'List shows up to 36 sessions per page; expand a match to see source excerpts.' : 'Details shows up to 18 sessions per page with guide overviews and source excerpts.'} Session guides are AI-written; labels identify the transcript origin.</p>
        {searchError && <div className="error-panel" role="alert"><p>{searchError}</p><button type="button" className="button secondary" onClick={() => setSearchAttempt(value => value + 1)}>Try search again</button></div>}
        <div className="results-list" aria-busy={searchBusy}>{search && <SessionResults results={search.results} view={sessionView} firstIndex={(search.page - 1) * search.pageSize + 1} speaker={searchSpeaker} onBeforeSessionNavigate={prepareSessionNavigation} onPassage={openResultPassage} onDocument={openDocument} />}</div>
        {search && !search.results.length && !searchBusy && <div className="empty-state"><Search size={28} aria-hidden="true" /><h3>No sessions found</h3><p>{marker ? 'Try Any speaker / unidentified, a different transcript origin, or fewer filters. Source notation and explicit CHI labels are sparse in some materials; no matches do not indicate an absent linguistic ability.' : 'Try a shorter phrase, a different spelling, or fewer filters. AI transcript drafts sometimes spell names unexpectedly.'}</p></div>}
        {search && search.pages > 1 && <nav className="pagination" aria-label="Search result pages"><button className="button secondary" type="button" disabled={search.page <= 1 || searchBusy} onClick={() => { setPage(search.page - 1); resultHeading.current?.focus(); }}><ChevronLeft size={17} aria-hidden="true" />Previous</button><span className="small">Page {search.page} of {search.pages}</span><button className="button secondary" type="button" disabled={search.page >= search.pages || searchBusy} onClick={() => { setPage(search.page + 1); resultHeading.current?.focus(); }}>Next<ChevronRight size={17} aria-hidden="true" /></button></nav>}
      </section> : <section className="research-section" aria-labelledby="research-heading"><div className="section-heading"><div><h2 id="research-heading">Research &amp; context</h2></div><BookOpen size={28} strokeWidth={1.3} aria-hidden="true" /></div><p className="section-intro">Background on the dissertation, the archive, and how to read the material. Document descriptions identify the source; new summaries remain distinct from the original research.</p><div className="research-documents">{researchDocs.map(document => {
        const headingId = `research-doc-${document.id}`;
        const summaryId = `research-read-${document.id}`;
        return <article className="research-document" key={document.id} aria-labelledby={headingId}><p className="eyebrow">{document.category === 'research' ? 'Research material' : 'Archive guide'}</p><h3 id={headingId}><a href={`/?document=${encodeURIComponent(document.id)}`} onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) { trackArchiveEvent('research_open', { documentId: document.id, action: 'read' }); return; } event.preventDefault(); openDocument(document.id); }} onAuxClick={event => { if (event.button === 1) trackArchiveEvent('research_open', { documentId: document.id, action: 'read' }); }}>{document.title}<ArrowRight size={19} aria-hidden="true" /></a></h3><p>{document.description}</p>{document.assets.length > 0 && <div className="document-downloads">{document.assets.map(asset => <a key={asset.id} aria-describedby={headingId} href={`/api/assets/${encodeURIComponent(asset.id)}`} className="button secondary" download={asset.name} referrerPolicy="no-referrer" onClick={() => trackArchiveEvent('research_open', { documentId: document.id, action: 'download', assetId: asset.id })} onAuxClick={event => { if (event.button === 1) trackArchiveEvent('research_open', { documentId: document.id, action: 'download', assetId: asset.id }); }}><Download size={16} aria-hidden="true" />{asset.label}</a>)}</div>}{document.markdown && <details className="document-reading" onToggle={event => { if (event.currentTarget.open) trackArchiveEvent('research_open', { documentId: document.id, action: 'read' }); }}><summary id={summaryId} aria-labelledby={`${summaryId} ${headingId}`}>Read document</summary><ArchiveMarkdown text={document.markdown} documentTitle={document.title} baseHeadingLevel={4} onSession={openSession} onDocument={openDocument} /></details>}</article>;
      })}</div></section>}
    </main>
    <footer className="site-footer"><div><CollectionMark /><p>{ARCHIVE_NAME}<br /><span>An unlisted public archive. Anyone with the link can visit.</span><br /><span>Usage analytics exclude search and transcript text.</span></p></div></footer>
  </div>;
}
