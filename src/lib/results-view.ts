import type { SearchPageSize, SearchResponse } from './types';

export type RecordingView = 'details' | 'list';
export type SearchBusyKind = null | 'search' | 'view';

export function pageSizeForView(view: RecordingView): SearchPageSize {
  return view === 'list' ? 36 : 18;
}

/**
 * Reuses already-loaded page 1 results when switching Details <-> List so
 * switching views never triggers a redundant search or a stale "Searching…" status.
 */
export function adaptSearchForView(current: SearchResponse, view: RecordingView): SearchResponse | null {
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
  return `${first}–${last} of ${search.total.toLocaleString()} guides${search.pages > 1 ? ` · page ${search.page} of ${search.pages}` : ''}`;
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
