import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptSearchForView, balancedColumnCount, formatSearchStatus } from '../src/lib/results-view';
import { ARCHIVE_NAME, ARCHIVE_SUBTITLE, formatDocumentTitle } from '../src/lib/site';
import type { EntryCard, SearchResponse } from '../src/lib/types';

function mockCard(id: string): EntryCard {
  return {
    id,
    sourceName: `${id}.cha`,
    title: `Session ${id}`,
    overview: 'An invented fixture overview.',
    origin: 'archived_research',
    topics: [],
    dates: [],
    ages: [],
    audio: [],
    preferredAudioId: null,
  };
}

function mockResponse(count: number, total: number, page: number, pageSize: 18 | 36): SearchResponse {
  return {
    total,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    pageSize,
    results: Array.from({ length: count }, (_, index) => ({
      entry: mockCard(`entry-${index + 1}`),
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
  assert.equal(formatDocumentTitle({ kind: 'recordings', hasFilters: false }), 'Recordings · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'recordings', hasFilters: true }), 'Search results · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'recording' }), 'Recording · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'recording', title: 'Blue locomotive and wooden bridge' }), 'Blue locomotive and wooden bridge · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'recording', notFound: true }), 'Recording not found · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'research' }), 'Research & context · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'document', title: 'Fixture annotation provenance guide' }), 'Fixture annotation provenance guide · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'document', title: null }), 'Document not found · The Seth Tapes');
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
  assert.equal(adaptedDetails.results[17].entry.id, 'entry-18');

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
  assert.equal(formatSearchStatus(settled, null), '1–18 of 50 guides · page 1 of 3');
  assert.equal(formatSearchStatus(mockResponse(4, 4, 1, 36), null), '1–4 of 4 guides');
  assert.equal(formatSearchStatus(mockResponse(0, 0, 1, 18), null), '0 results');
  assert.equal(formatSearchStatus(null, null), '');
});

test('balancedColumnCount avoids single-orphan rows across typical theme counts', () => {
  for (const count of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const cols = balancedColumnCount(count, 4);
    assert.ok(cols >= 1 && cols <= 4);
    const remainder = count % cols;
    assert.notEqual(remainder, 1, `Expected count=${count} with cols=${cols} not to leave 1 orphan`);
  }
  assert.equal(balancedColumnCount(8, 4), 4);
  assert.equal(balancedColumnCount(8, 2), 2);
  assert.equal(balancedColumnCount(6, 4), 3);
  assert.equal(balancedColumnCount(5, 4), 3);
});
