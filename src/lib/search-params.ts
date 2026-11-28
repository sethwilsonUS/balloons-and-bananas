import { isValidAgeMonths, parseAgeMonthsParam } from './age';
import { isLinguisticMarkerId, isLinguisticSpeaker, type LinguisticMarkerId, type LinguisticSpeaker } from './linguistic-markers';
import { isSearchSort, isSessionView, isTranscriptOrigin, pageSizeForView, type SessionView } from './results-view';
import type {
  LinguisticEvidence,
  Recording,
  SearchPageSize,
  SearchRequest,
  SearchResponse,
  SearchResult,
  SearchSort,
  SessionCard,
  TranscriptOrigin,
} from './types';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

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

/** Return true when the URL explicitly supplies a valid `sort` query parameter. */
export function hasExplicitSortParam(params: RawSearchParams): boolean {
  const rawSort = readParam(params, 'sort')?.trim() ?? '';
  return isSearchSort(rawSort);
}

/**
 * Resolve the sort order when the search query transitions between empty and non-empty.
 * Applies the query-dependent default (`relevance` / `age-asc`) only when no explicit
 * sort was selected in the URL, preserving an explicit `age-asc` or `age-desc` choice.
 */
export function resolveSortForQueryChange(
  currentSort: SearchSort,
  hadQuery: boolean,
  hasNextQuery: boolean,
  hasExplicitSort: boolean,
): SearchSort {
  if (!hadQuery && hasNextQuery) {
    return hasExplicitSort ? currentSort : 'relevance';
  }
  if (hadQuery && !hasNextQuery && !hasExplicitSort && currentSort === 'relevance') {
    return 'age-asc';
  }
  return currentSort;
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

export interface SerializeSearchUrlOptions {
  /** Keep `sort` in the serialized URL even when it matches the default for the current query. */
  explicitSort?: boolean;
}

/**
 * Serialize a `SearchUrlState` into canonical `URLSearchParams`, omitting default
 * values so shared URLs stay clean, stable, and round-trip identically.
 */
export function serializeSearchUrlParams(
  state: SearchUrlState,
  options: SerializeSearchUrlOptions = {},
): URLSearchParams {
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
  if (isSearchSort(state.sort) && (options.explicitSort || state.sort !== defaultSort)) {
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

export function buildSearchHref(
  state: SearchUrlState,
  options: SerializeSearchUrlOptions = {},
): string {
  const query = serializeSearchUrlParams(state, options).toString();
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

function parseRecording(raw: unknown): Recording | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.id !== 'string'
    || typeof raw.name !== 'string'
    || typeof raw.format !== 'string'
    || typeof raw.duration !== 'number' || !Number.isFinite(raw.duration)
    || typeof raw.bytes !== 'number' || !Number.isFinite(raw.bytes)
    || typeof raw.available !== 'boolean'
  ) {
    return null;
  }
  if (raw.kind !== undefined && raw.kind !== 'original' && raw.kind !== 'listening-copy') return null;
  if (raw.derivedFromId !== undefined && typeof raw.derivedFromId !== 'string') return null;
  if (raw.encoding !== undefined && typeof raw.encoding !== 'string') return null;
  const recording: Recording = {
    id: raw.id,
    name: raw.name,
    format: raw.format,
    duration: raw.duration,
    bytes: raw.bytes,
    available: raw.available,
  };
  if (raw.kind !== undefined) recording.kind = raw.kind;
  if (raw.derivedFromId !== undefined) recording.derivedFromId = raw.derivedFromId;
  if (raw.encoding !== undefined) recording.encoding = raw.encoding;
  return recording;
}

function parseSessionCard(raw: unknown): SessionCard | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.id !== 'string'
    || typeof raw.slug !== 'string'
    || typeof raw.legacyId !== 'string'
    || typeof raw.sourceName !== 'string'
    || typeof raw.title !== 'string'
    || typeof raw.overview !== 'string'
    || !isTranscriptOrigin(raw.origin)
    || !isStringArray(raw.topics)
    || !isStringArray(raw.dates)
    || !isStringArray(raw.ages)
    || (raw.inferredAge !== null && typeof raw.inferredAge !== 'string')
    || !Array.isArray(raw.recordings)
    || (raw.preferredRecordingId !== null && typeof raw.preferredRecordingId !== 'string')
  ) {
    return null;
  }
  const recordings: Recording[] = [];
  for (const item of raw.recordings) {
    const parsed = parseRecording(item);
    if (!parsed) return null;
    recordings.push(parsed);
  }
  return {
    id: raw.id,
    slug: raw.slug,
    legacyId: raw.legacyId,
    sourceName: raw.sourceName,
    title: raw.title,
    overview: raw.overview,
    origin: raw.origin,
    topics: raw.topics,
    dates: raw.dates,
    ages: raw.ages,
    inferredAge: raw.inferredAge,
    recordings,
    preferredRecordingId: raw.preferredRecordingId,
  };
}

function parseLinguisticEvidence(raw: unknown): LinguisticEvidence | null {
  if (!isRecord(raw)) return null;
  if (
    !isLinguisticMarkerId(raw.marker)
    || typeof raw.count !== 'number' || !Number.isSafeInteger(raw.count) || raw.count < 0
    || !Array.isArray(raw.examples)
  ) {
    return null;
  }
  const examples: LinguisticEvidence['examples'] = [];
  for (const item of raw.examples) {
    if (!isRecord(item)) return null;
    if (
      typeof item.passageIndex !== 'number' || !Number.isSafeInteger(item.passageIndex) || item.passageIndex < 0
      || typeof item.text !== 'string'
    ) {
      return null;
    }
    if (item.speaker !== undefined && typeof item.speaker !== 'string') return null;
    if (item.start !== undefined && item.start !== null && (typeof item.start !== 'number' || !Number.isFinite(item.start))) {
      return null;
    }
    const example: LinguisticEvidence['examples'][number] = {
      passageIndex: item.passageIndex,
      text: item.text,
    };
    if (item.speaker !== undefined) example.speaker = item.speaker;
    if (item.start !== undefined) example.start = item.start;
    examples.push(example);
  }
  return {
    marker: raw.marker,
    count: raw.count,
    examples,
  };
}

function parseSearchResultItem(raw: unknown): SearchResult | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.excerpt !== 'string'
    || (raw.matchedIn !== 'transcript' && raw.matchedIn !== 'guide' && raw.matchedIn !== 'browse')
  ) {
    return null;
  }
  const session = parseSessionCard(raw.session);
  if (!session) return null;
  if (raw.matchedPassage !== undefined) {
    if (typeof raw.matchedPassage !== 'number' || !Number.isSafeInteger(raw.matchedPassage) || raw.matchedPassage < 1) {
      return null;
    }
  }
  let linguisticEvidence: LinguisticEvidence | undefined;
  if (raw.linguisticEvidence !== undefined) {
    const parsedEvidence = parseLinguisticEvidence(raw.linguisticEvidence);
    if (!parsedEvidence) return null;
    linguisticEvidence = parsedEvidence;
  }
  return {
    session,
    excerpt: raw.excerpt,
    matchedIn: raw.matchedIn,
    ...(raw.matchedPassage !== undefined ? { matchedPassage: raw.matchedPassage } : {}),
    ...(linguisticEvidence !== undefined ? { linguisticEvidence } : {}),
  };
}

/**
 * Runtime boundary validator for `/api/search` JSON responses.
 * Rejects malformed payloads before they can reach `SessionResults`.
 */
export function parseSearchResponse(raw: unknown): SearchResponse | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.total !== 'number' || !Number.isSafeInteger(raw.total) || raw.total < 0
    || typeof raw.page !== 'number' || !Number.isSafeInteger(raw.page) || raw.page < 1
    || typeof raw.pages !== 'number' || !Number.isSafeInteger(raw.pages) || raw.pages < 1
    || (raw.pageSize !== 18 && raw.pageSize !== 36)
    || !Array.isArray(raw.results)
  ) {
    return null;
  }
  const results: SearchResult[] = [];
  for (const item of raw.results) {
    const parsed = parseSearchResultItem(item);
    if (!parsed) return null;
    results.push(parsed);
  }
  const pageSize: SearchPageSize = raw.pageSize;
  return {
    total: raw.total,
    page: raw.page,
    pages: raw.pages,
    pageSize,
    results,
  };
}
