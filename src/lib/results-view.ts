import type { SearchPageSize, SearchResponse, SearchResult, SearchSort } from './types';

export type SessionView = 'details' | 'list';
export type SearchBusyKind = null | 'search' | 'view';
export const SEARCH_SORTS: readonly SearchSort[] = ['age-asc', 'age-desc', 'relevance'];

export function isSearchSort(value: unknown): value is SearchSort {
  return value === 'age-asc' || value === 'age-desc' || value === 'relevance';
}

const foldWords = (text: string) =>
  text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLocaleLowerCase();

export function pageSizeForView(view: SessionView): SearchPageSize {
  return view === 'list' ? 36 : 18;
}

export function shortOverview(text: string): string {
  const words = text.trim().split(/\s+/);
  let overview = '';
  for (const word of words) {
    if (overview && overview.length + word.length + 1 > 180) return `${overview}…`;
    overview += `${overview ? ' ' : ''}${word}`;
  }
  return overview;
}

/**
 * Returns the excerpt to display for a session card in the active view.
 * Suppresses guide excerpts whose text is already visible in the card's
 * title or overview (full overview in Details, truncated overview in List).
 */
export function visibleExcerpt(result: SearchResult, view: SessionView): string {
  if (result.matchedIn === 'browse' || !result.excerpt) return '';
  const trimmed = result.excerpt.trim();
  if (!trimmed) return '';
  if (result.matchedIn === 'guide') {
    const normalizedExcerpt = foldWords(trimmed.replace(/^…|…$/g, ''));
    const displayedOverview = view === 'list' ? shortOverview(result.session.overview) : result.session.overview;
    const normalizedOverview = foldWords(displayedOverview);
    const normalizedTitle = foldWords(result.session.title);
    if (normalizedExcerpt && (normalizedOverview.includes(normalizedExcerpt) || normalizedTitle.includes(normalizedExcerpt))) {
      return '';
    }
  }
  return trimmed;
}

/**
 * Reuses already-loaded page 1 results when switching Details <-> List so
 * switching views never triggers a redundant search or a stale "Searching…" status.
 */
export function adaptSearchForView(current: SearchResponse, view: SessionView): SearchResponse | null {
  const pageSize = pageSizeForView(view);
  if (current.page !== 1) return null;
  const needed = Math.min(pageSize, current.total);
  if (current.results.length < needed) return null;
  return {
    ...current,
    pageSize,
    pages: Math.max(1, Math.ceil(current.total / pageSize)),
    results: current.results.slice(0, pageSize),
  };
}

export function formatSearchStatus(search: SearchResponse | null, busyKind: SearchBusyKind): string {
  if (busyKind === 'search') return 'Searching…';
  if (busyKind === 'view') return 'Updating view…';
  if (!search) return '';
  if (!search.total) return '0 results';
  const first = (search.page - 1) * search.pageSize + 1;
  const last = Math.min(search.page * search.pageSize, search.total);
  return `${first}–${last} of ${search.total.toLocaleString()} ${search.total === 1 ? 'session' : 'sessions'}${search.pages > 1 ? ` · page ${search.page} of ${search.pages}` : ''}`;
}

/**
 * Computes a column count up to maxColumns that distributes items into balanced
 * rows without leaving a single orphan item on the final row.
 */
export function balancedColumnCount(count: number, maxColumns: number): number {
  if (count <= 1) return 1;
  const boundedMax = Math.max(1, Math.min(count, maxColumns));
  const rows = Math.ceil(count / boundedMax);
  return Math.ceil(count / rows);
}

/**
 * Computes per-item column spans on a 6-track compact grid so every count >= 2
 * partitions into rows of 2 (span 3) and 3 (span 2) with zero single-item orphan rows.
 */
export function compactGridSpans(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [6];
  if (count % 2 === 0) return Array.from({ length: count }, () => 3);
  const twoUpItems = count - 3;
  return [
    ...Array.from({ length: twoUpItems }, () => 3),
    2,
    2,
    2,
  ];
}
