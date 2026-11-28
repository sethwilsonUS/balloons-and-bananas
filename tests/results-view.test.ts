import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptSearchForView, balancedColumnCount, compactGridSpans, formatSearchStatus, shortOverview, visibleExcerpt } from '../src/lib/results-view';
import { ARCHIVE_NAME, ARCHIVE_SUBTITLE, formatDocumentTitle, formatSessionPageTitle } from '../src/lib/site';
import type { SearchResponse, SearchResult, SessionCard } from '../src/lib/types';

function mockCard(id: string): SessionCard {
  return {
    id,
    slug: id,
    legacyId: id,
    sourceName: `${id}.cha`,
    title: `Session ${id}`,
    overview: 'An invented fixture overview.',
    origin: 'archived_research',
    topics: [],
    dates: [],
    ages: [],
    inferredAge: null,
    recordings: [],
    preferredRecordingId: null,
  };
}

function mockResponse(count: number, total: number, page: number, pageSize: 18 | 36): SearchResponse {
  return {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    pageSize,
    results: Array.from({ length: count }, (_, index) => ({
      session: mockCard(`session-${index + 1}`),
      excerpt: '',
      matchedIn: 'browse' as const,
    })),
  };
}

test('site branding uses one name and descriptive per-view document titles', () => {
  assert.equal(ARCHIVE_NAME, 'The Seth Tapes');
  assert.equal(ARCHIVE_SUBTITLE, 'A childhood-language archive from the Peters/Wilson corpus');

  assert.equal(formatDocumentTitle({ kind: 'loading' }), 'The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'error' }), 'Archive unavailable · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'overview' }), 'Overview · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'sessions', hasFilters: false }), 'Sessions · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'sessions', hasFilters: true }), 'Search results · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'search', hasFilters: false }), 'Search · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'search', hasFilters: true }), 'Search results · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'session' }), 'Session · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'session', title: 'Blue locomotive and wooden bridge' }), 'Blue locomotive and wooden bridge · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'session', notFound: true }), 'Session not found · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'research' }), 'Research & context · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'document', title: 'Fixture annotation provenance guide' }), 'Fixture annotation provenance guide · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'document', title: null }), 'Document not found · The Seth Tapes');

  // Per-session route titles distinguish source age, inferred age, and unaged sessions.
  assert.equal(
    formatSessionPageTitle({ slug: '010626', ages: ['1;06.26'], inferredAge: null }),
    'Session 010626 (age 1;06.26) · The Seth Tapes',
  );
  assert.equal(
    formatSessionPageTitle({ slug: '020604-local', ages: [], inferredAge: '2;06.04' }),
    'Session 020604-local (inferred age 2;06.04) · The Seth Tapes',
  );
  assert.equal(
    formatSessionPageTitle({ slug: '011103', ages: [], inferredAge: null }),
    'Session 011103 · The Seth Tapes',
  );
  assert.equal(
    formatSessionPageTitle({ slug: '011119d-82-supp', ages: [], inferredAge: '1;11.19' }),
    'Session 011119d-82-supp (inferred age 1;11.19) · The Seth Tapes',
  );
});

test('adaptSearchForView reuses already-loaded page 1 results across Details and List without refetching', () => {
  // Small result set (4 <= 18): both Details -> List and List -> Details adapt synchronously.
  const smallDetails = mockResponse(4, 4, 1, 18);
  const smallList = adaptSearchForView(smallDetails, 'list');
  assert.ok(smallList);
  assert.equal(smallList.pageSize, 36);
  assert.equal(smallList.pages, 1);
  assert.equal(smallList.results.length, 4);

  // Large result set loaded in List (36 of 100): switching to Details slices the first 18 synchronously.
  const largeList = mockResponse(36, 100, 1, 36);
  const adaptedDetails = adaptSearchForView(largeList, 'details');
  assert.ok(adaptedDetails);
  assert.equal(adaptedDetails.pageSize, 18);
  assert.equal(adaptedDetails.pages, 6);
  assert.equal(adaptedDetails.results.length, 18);
  assert.equal(adaptedDetails.results[17].session.id, 'session-18');

  // Large result set loaded in Details (18 of 100): switching to List requires fetching 36.
  const largeDetails = mockResponse(18, 100, 1, 18);
  assert.equal(adaptSearchForView(largeDetails, 'list'), null);

  // Page 2 always requires fetching page 1 when switching views.
  const pageTwo = mockResponse(18, 100, 2, 18);
  assert.equal(adaptSearchForView(pageTwo, 'list'), null);
  assert.equal(adaptSearchForView(pageTwo, 'details'), null);

  // Empty result set adapts cleanly in both views.
  const empty = mockResponse(0, 0, 1, 18);
  const emptyList = adaptSearchForView(empty, 'list');
  assert.ok(emptyList);
  assert.equal(emptyList.pageSize, 36);
  assert.equal(emptyList.total, 0);
});

test('formatSearchStatus distinguishes searching, view updates, and settled result counts', () => {
  const settled = mockResponse(18, 50, 1, 18);
  assert.equal(formatSearchStatus(settled, 'search'), 'Searching…');
  assert.equal(formatSearchStatus(settled, 'view'), 'Updating view…');
  assert.equal(formatSearchStatus(settled, null), '1–18 of 50 sessions · page 1 of 3');
  assert.equal(formatSearchStatus(mockResponse(4, 4, 1, 36), null), '1–4 of 4 sessions');
  assert.equal(formatSearchStatus(mockResponse(1, 1, 1, 18), null), '1–1 of 1 session');
  assert.equal(formatSearchStatus(mockResponse(0, 0, 1, 18), null), '0 results');
  assert.equal(formatSearchStatus(null, null), '');
});

test('balancedColumnCount and compactGridSpans avoid single-orphan rows across wide and compact counts', () => {
  for (const count of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const cols = balancedColumnCount(count, 4);
    assert.ok(cols >= 1 && cols <= 4);
    const remainder = count % cols;
    assert.notEqual(remainder, 1, `Expected count=${count} with cols=${cols} not to leave 1 orphan`);
  }
  assert.equal(balancedColumnCount(8, 4), 4);
  assert.equal(balancedColumnCount(6, 4), 3);
  assert.equal(balancedColumnCount(5, 4), 3);

  const rowSizesFromSpans = (spans: number[]): number[] => {
    const rows: number[] = [];
    let rowTracks = 0;
    let rowItems = 0;
    for (const span of spans) {
      if (rowTracks + span > 6) {
        rows.push(rowItems);
        rowTracks = 0;
        rowItems = 0;
      }
      rowTracks += span;
      rowItems += 1;
    }
    if (rowItems > 0) rows.push(rowItems);
    return rows;
  };

  assert.deepEqual(rowSizesFromSpans(compactGridSpans(1)), [1]);
  assert.deepEqual(rowSizesFromSpans(compactGridSpans(2)), [2]);
  assert.deepEqual(rowSizesFromSpans(compactGridSpans(3)), [3]);
  assert.deepEqual(rowSizesFromSpans(compactGridSpans(4)), [2, 2]);
  assert.deepEqual(rowSizesFromSpans(compactGridSpans(5)), [2, 3]);
  assert.deepEqual(rowSizesFromSpans(compactGridSpans(6)), [2, 2, 2]);
  assert.deepEqual(rowSizesFromSpans(compactGridSpans(7)), [2, 2, 3]);
  assert.deepEqual(rowSizesFromSpans(compactGridSpans(8)), [2, 2, 2, 2]);
  assert.deepEqual(rowSizesFromSpans(compactGridSpans(9)), [2, 2, 2, 3]);
  for (const count of [2, 3, 4, 5, 6, 7, 8, 9]) {
    const rows = rowSizesFromSpans(compactGridSpans(count));
    assert.equal(rows.reduce((sum, n) => sum + n, 0), count);
    assert.ok(Math.min(...rows) >= 2, `Compact count=${count} left an orphan row: ${rows.join(',')}`);
  }
});

test('visibleExcerpt is view-aware: Details suppresses full-overview excerpts while List keeps excerpts hidden past truncation', () => {
  const longOverview = 'Opening remarks about folding paper maps, sorting wooden blocks, and lining up cardboard houses across the kitchen table while naming streets, corners, and bridges before eventually spotting a telescopic lantern hanging beside the back veranda.';
  assert.ok(shortOverview(longOverview).length < longOverview.length);
  assert.ok(!shortOverview(longOverview).includes('telescopic lantern'));

  const truncatedOverviewResult: SearchResult = {
    session: { ...mockCard('long-overview'), overview: longOverview },
    matchedIn: 'guide',
    excerpt: '…naming streets, corners, and bridges before eventually spotting a telescopic lantern hanging beside the back veranda.',
  };
  assert.equal(visibleExcerpt(truncatedOverviewResult, 'details'), '');
  assert.equal(visibleExcerpt(truncatedOverviewResult, 'list'), truncatedOverviewResult.excerpt);

  const visibleInShortResult: SearchResult = {
    session: { ...mockCard('long-overview'), overview: longOverview },
    matchedIn: 'guide',
    excerpt: 'Opening remarks about folding paper maps, sorting wooden blocks',
  };
  assert.equal(visibleExcerpt(visibleInShortResult, 'details'), '');
  assert.equal(visibleExcerpt(visibleInShortResult, 'list'), '');

  const momentResult: SearchResult = {
    session: { ...mockCard('long-overview'), overview: longOverview },
    matchedIn: 'guide',
    excerpt: 'Lantern check: Counting three brass lanterns along the railing.',
  };
  assert.equal(visibleExcerpt(momentResult, 'details'), momentResult.excerpt);
  assert.equal(visibleExcerpt(momentResult, 'list'), momentResult.excerpt);
});
