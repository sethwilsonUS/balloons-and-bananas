import { isValidAgeMonths, parseAgeMonthsParam } from './age';
import { isLinguisticMarkerId, isLinguisticSpeaker, type LinguisticMarkerId, type LinguisticSpeaker } from './linguistic-markers';
import { isSearchSort, isSessionView, isTranscriptOrigin, pageSizeForView, type SessionView } from './results-view';
import type { SearchRequest, SearchSort, TranscriptOrigin } from './types';

export const MAX_SEARCH_QUERY_LENGTH = 300;
export const MAX_SEARCH_TOPIC_LENGTH = 120;
export const MAX_SEARCH_PAGE = 100_000;

export interface SearchUrlState {
  query: string;
  topic: string;
  origin: TranscriptOrigin | '';
  marker: LinguisticMarkerId | '';
  speaker: LinguisticSpeaker;
  ageMin: number | undefined;
  ageMax: number | undefined;
  sort: SearchSort;
  view: SessionView;
  page: number;
}

export type RawSearchParams =
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>;

const POSITIVE_INT_RE = /^[1-9]\d*$/;

function isSearchParamsLike(params: RawSearchParams): params is { get(name: string): string | null } {
  return typeof (params as { get?: unknown }).get === 'function';
}

function readParam(params: RawSearchParams, key: string): string | null {
  if (isSearchParamsLike(params)) {
    return params.get(key);
  }
  const value = Object.hasOwn(params, key) ? params[key] : undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null;
  }
  return null;
}

export function defaultSortForQuery(query: string): SearchSort {
  return query.trim() ? 'relevance' : 'age-asc';
}

function parsePageParam(raw: string | null): number {
  if (!raw) return 1;
  const trimmed = raw.trim();
  if (!POSITIVE_INT_RE.test(trimmed)) return 1;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 1;
  return Math.min(MAX_SEARCH_PAGE, parsed);
}

/**
 * Parse `/search` URL query parameters into a validated `SearchUrlState`.
 * Invalid or out-of-range values are safely ignored and fall back to defaults,
 * matching `/api/search` validation.
 */
export function parseSearchUrlParams(
  params: RawSearchParams,
  options: { validTopics?: ReadonlySet<string> } = {},
): SearchUrlState {
  const rawQuery = readParam(params, 'q');
  const query = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, MAX_SEARCH_QUERY_LENGTH) : '';

  const rawTopic = readParam(params, 'topic');
  const trimmedTopic = typeof rawTopic === 'string' ? rawTopic.trim() : '';
  const topic = trimmedTopic.length > 0
    && trimmedTopic.length <= MAX_SEARCH_TOPIC_LENGTH
    && (!options.validTopics || options.validTopics.has(trimmedTopic))
    ? trimmedTopic
    : '';

  const rawOrigin = readParam(params, 'origin')?.trim() ?? '';
  const origin: TranscriptOrigin | '' = isTranscriptOrigin(rawOrigin) ? rawOrigin : '';

  const rawMarker = readParam(params, 'marker')?.trim() ?? '';
  const marker: LinguisticMarkerId | '' = isLinguisticMarkerId(rawMarker) ? rawMarker : '';

  const rawSpeaker = readParam(params, 'speaker')?.trim() ?? '';
  const speaker: LinguisticSpeaker = marker && isLinguisticSpeaker(rawSpeaker) ? rawSpeaker : 'child';

  let ageMin = parseAgeMonthsParam(readParam(params, 'ageMin'));
  let ageMax = parseAgeMonthsParam(readParam(params, 'ageMax'));
  if (ageMin !== undefined && ageMax !== undefined && ageMin > ageMax) {
    ageMin = undefined;
    ageMax = undefined;
  }

  const rawSort = readParam(params, 'sort')?.trim() ?? '';
  const sort: SearchSort = isSearchSort(rawSort) ? rawSort : defaultSortForQuery(query);

  const rawView = readParam(params, 'view')?.trim() ?? '';
  const view: SessionView = isSessionView(rawView) ? rawView : 'details';

  const page = parsePageParam(readParam(params, 'page'));

  return {
    query,
    topic,
    origin,
    marker,
    speaker,
    ageMin,
    ageMax,
    sort,
    view,
    page,
  };
}

/**
 * Serialize a `SearchUrlState` into canonical `URLSearchParams`, omitting default
 * values so shared URLs stay clean, stable, and round-trip identically.
 */
export function serializeSearchUrlParams(state: SearchUrlState): URLSearchParams {
  const params = new URLSearchParams();
  const query = state.query.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
  if (query) params.set('q', query);

  const topic = state.topic.trim();
  if (topic && topic.length <= MAX_SEARCH_TOPIC_LENGTH) params.set('topic', topic);

  if (isTranscriptOrigin(state.origin)) params.set('origin', state.origin);

  const marker = isLinguisticMarkerId(state.marker) ? state.marker : '';
  if (marker) {
    params.set('marker', marker);
    if (isLinguisticSpeaker(state.speaker) && state.speaker !== 'child') {
      params.set('speaker', state.speaker);
    }
  }

  const validMin = isValidAgeMonths(state.ageMin) ? state.ageMin : undefined;
  const validMax = isValidAgeMonths(state.ageMax) ? state.ageMax : undefined;
  if (!(validMin !== undefined && validMax !== undefined && validMin > validMax)) {
    if (validMin !== undefined) params.set('ageMin', String(validMin));
    if (validMax !== undefined) params.set('ageMax', String(validMax));
  }

  const defaultSort = defaultSortForQuery(query);
  if (isSearchSort(state.sort) && state.sort !== defaultSort) {
    params.set('sort', state.sort);
  }

  if (isSessionView(state.view) && state.view !== 'details') {
    params.set('view', state.view);
  }

  if (Number.isSafeInteger(state.page) && state.page > 1) {
    params.set('page', String(Math.min(MAX_SEARCH_PAGE, state.page)));
  }

  return params;
}

export function buildSearchHref(state: SearchUrlState): string {
  const query = serializeSearchUrlParams(state).toString();
  return query ? `/search?${query}` : '/search';
}

export function hasActiveSearchFilters(
  state: Pick<SearchUrlState, 'query' | 'topic' | 'origin' | 'marker' | 'ageMin' | 'ageMax'>,
): boolean {
  return Boolean(
    state.query.trim()
    || state.topic
    || state.origin
    || state.marker
    || state.ageMin !== undefined
    || state.ageMax !== undefined,
  );
}

export function searchRequestFromUrlState(state: SearchUrlState): SearchRequest {
  const request: SearchRequest = {
    query: state.query,
    topic: state.topic,
    origin: state.origin,
    marker: state.marker,
    speaker: state.speaker,
    sort: state.sort,
    page: state.page,
    pageSize: pageSizeForView(state.view),
  };
  if (isValidAgeMonths(state.ageMin)) request.ageMin = state.ageMin;
  if (isValidAgeMonths(state.ageMax)) request.ageMax = state.ageMax;
  return request;
}

/** Validate that a `returnTo` path is a safe same-origin `/search` path (never protocol-relative or external). */
export function isSafeSearchReturnPath(value: string | undefined): value is string {
  if (typeof value !== 'string') return false;
  if (value === '/search') return true;
  if (!value.startsWith('/search?')) return false;
  if (value.startsWith('//') || /[\r\n]/.test(value)) return false;
  return true;
}

/**
 * Build a session link from `/search`, appending a validated `?from=` search return
 * path and `#p<N>` fragment when the result targets a specific transcript passage.
 */
export function buildSessionHrefFromSearch(
  slug: string,
  options: { passage?: number; returnTo?: string } = {},
): string {
  const base = `/sessions/${encodeURIComponent(slug)}`;
  const fromQuery = isSafeSearchReturnPath(options.returnTo)
    ? `?from=${encodeURIComponent(options.returnTo)}`
    : '';
  const passageHash = typeof options.passage === 'number'
    && Number.isSafeInteger(options.passage)
    && options.passage >= 1
    ? `#p${options.passage}`
    : '';
  return `${base}${fromQuery}${passageHash}`;
}
