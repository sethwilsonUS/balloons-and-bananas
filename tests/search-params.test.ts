import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSearchHref,
  buildSessionHrefFromSearch,
  concordanceRequestFromUrlState,
  defaultSortForQuery,
  defaultSpeakerForSearch,
  hasActiveSearchFilters,
  hasExplicitSortParam,
  isSafeSearchReturnPath,
  MAX_SEARCH_PAGE,
  MAX_SEARCH_QUERY_LENGTH,
  parseConcordanceResponse,
  parseSearchResponse,
  parseSearchUrlParams,
  resolveSortForQueryChange,
  searchRequestFromUrlState,
  serializeSearchUrlParams,
  type SearchUrlState,
} from '../src/lib/search-params';
import { selectableTopicSet } from '../src/lib/topics';

const VALID_TOPICS = new Set([
  'Play and imagination',
  'Learning and questions',
  'Outings and nature',
]);

test('parseSearchUrlParams parses all supported parameters from URLSearchParams and Next.js plain records', () => {
  const fromUrl = parseSearchUrlParams(
    new URLSearchParams('q=blue+locomotive&topic=Play+and+imagination&origin=archived_research&marker=repetition&speaker=any&ageMin=18&ageMax=30&sort=age-desc&view=list&page=3'),
    { validTopics: VALID_TOPICS },
  );
  assert.deepEqual(fromUrl, {
    query: 'blue locomotive',
    topic: 'Play and imagination',
    origin: 'archived_research',
    marker: 'repetition',
    speaker: 'any',
    ageMin: 18,
    ageMax: 30,
    sort: 'age-desc',
    view: 'list',
    page: 3,
  });

  // Next.js page searchParams plain object (including repeated keys as string[]).
  const fromRecord = parseSearchUrlParams(
    {
      q: ['locomotive', 'ignored-second'],
      topic: 'Learning and questions',
      origin: 'local_ai_draft',
      marker: 'wh-question',
      speaker: 'child',
      ageMin: '0',
      ageMax: '0',
      sort: 'age-asc',
      view: 'details',
      page: '2',
    },
    { validTopics: VALID_TOPICS },
  );
  assert.deepEqual(fromRecord, {
    query: 'locomotive',
    topic: 'Learning and questions',
    origin: 'local_ai_draft',
    marker: 'wh-question',
    speaker: 'child',
    ageMin: 0,
    ageMax: 0,
    sort: 'age-asc',
    view: 'details',
    page: 2,
  });
});

test('parseSearchUrlParams rejects or safely ignores invalid, out-of-range, and inverted parameters', () => {
  const invalid = parseSearchUrlParams(
    new URLSearchParams('q=+++&topic=Unknown+Theme&origin=invalid_origin&marker=fake&speaker=any&ageMin=-5&ageMax=999&sort=oldest&view=grid&page=0'),
    { validTopics: VALID_TOPICS },
  );
  assert.deepEqual(invalid, {
    query: '',
    topic: '',
    origin: '',
    marker: '',
    speaker: 'child',
    ageMin: undefined,
    ageMax: undefined,
    sort: 'age-asc',
    view: 'details',
    page: 1,
  });

  // Inverted age range is ignored completely rather than producing a 400 or invented span.
  const inverted = parseSearchUrlParams(new URLSearchParams('ageMin=30&ageMax=20'));
  assert.equal(inverted.ageMin, undefined);
  assert.equal(inverted.ageMax, undefined);

  // Speaker without an active linguistic marker resets to default child.
  const orphanSpeaker = parseSearchUrlParams(new URLSearchParams('speaker=any'));
  assert.equal(orphanSpeaker.marker, '');
  assert.equal(orphanSpeaker.speaker, 'child');

  // Non-integer and malformed page/age values are ignored; huge values are clamped/rejected.
  for (const badPage of ['0', '-1', '1.5', 'abc', '1e3', '']) {
    assert.equal(parseSearchUrlParams(new URLSearchParams(`page=${badPage}`)).page, 1);
  }
  assert.equal(parseSearchUrlParams(new URLSearchParams('page=999999999')).page, MAX_SEARCH_PAGE);
  assert.equal(parseSearchUrlParams(new URLSearchParams(`q=${'a'.repeat(400)}`)).query.length, MAX_SEARCH_QUERY_LENGTH);

  // Default sort reacts to presence of query.
  assert.equal(defaultSortForQuery(''), 'age-asc');
  assert.equal(defaultSortForQuery('locomotive'), 'relevance');
  assert.equal(parseSearchUrlParams(new URLSearchParams('q=locomotive')).sort, 'relevance');
  assert.equal(parseSearchUrlParams(new URLSearchParams('origin=archived_research')).sort, 'age-asc');
});

test('serializeSearchUrlParams and buildSearchHref omit defaults, preserve 0 months, and round-trip losslessly', () => {
  const bare = parseSearchUrlParams(new URLSearchParams());
  assert.equal(buildSearchHref(bare), '/search');

  const states: SearchUrlState[] = [
    { query: 'locomotive', topic: '', origin: '', marker: '', speaker: 'child', ageMin: undefined, ageMax: undefined, sort: 'relevance', view: 'details', page: 1 },
    { query: 'locomotive', topic: '', origin: '', marker: '', speaker: 'child', ageMin: undefined, ageMax: undefined, sort: 'age-asc', view: 'details', page: 1 },
    { query: '', topic: 'Play and imagination', origin: 'local_ai_draft', marker: 'repetition', speaker: 'any', ageMin: 0, ageMax: 30, sort: 'age-desc', view: 'list', page: 4 },
    { query: '', topic: '', origin: '', marker: 'pause', speaker: 'child', ageMin: 24, ageMax: undefined, sort: 'age-asc', view: 'details', page: 1 },
  ];

  for (const state of states) {
    const serialized = serializeSearchUrlParams(state);
    const reparsed = parseSearchUrlParams(serialized, { validTopics: VALID_TOPICS });
    assert.deepEqual(reparsed, state);
  }

  // Canonical defaults omitted cleanly.
  assert.equal(buildSearchHref(states[0]), '/search?q=locomotive');
  assert.equal(buildSearchHref(states[1]), '/search?q=locomotive&sort=age-asc');
  assert.equal(buildSearchHref(states[3]), '/search?marker=pause&ageMin=24');

  // Zero-month lower bound is serialized explicitly (never dropped as falsy).
  assert.ok(buildSearchHref(states[2]).includes('ageMin=0'));

  // Inverted bounds are never emitted even if passed programmatically.
  assert.equal(
    buildSearchHref({ ...bare, ageMin: 36, ageMax: 18 }),
    '/search',
  );
});

test('hasActiveSearchFilters and searchRequestFromUrlState map URL state cleanly to /api/search payloads', () => {
  const bare = parseSearchUrlParams(new URLSearchParams('sort=age-desc&view=list'));
  assert.equal(hasActiveSearchFilters(bare), false);
  assert.equal(hasActiveSearchFilters({ ...bare, ageMin: 0 }), true);
  assert.equal(hasActiveSearchFilters({ ...bare, ageMax: 0 }), true);
  assert.equal(hasActiveSearchFilters({ ...bare, query: 'bell' }), true);
  assert.equal(hasActiveSearchFilters({ ...bare, origin: 'archived_research' }), true);

  const full = parseSearchUrlParams(
    new URLSearchParams('q=ferry&topic=Outings+and+nature&origin=local_ai_draft&marker=question&speaker=any&ageMin=24&ageMax=36&sort=age-asc&view=list&page=2'),
    { validTopics: VALID_TOPICS },
  );
  assert.deepEqual(searchRequestFromUrlState(full), {
    query: 'ferry',
    topic: 'Outings and nature',
    origin: 'local_ai_draft',
    marker: 'question',
    speaker: 'any',
    ageMin: 24,
    ageMax: 36,
    sort: 'age-asc',
    page: 2,
    pageSize: 36,
  });

  const withoutAge = searchRequestFromUrlState(bare);
  assert.equal('ageMin' in withoutAge, false);
  assert.equal('ageMax' in withoutAge, false);
  assert.equal(withoutAge.pageSize, 36);
});

test('buildSessionHrefFromSearch appends validated returnTo and #p<N> passage anchors while rejecting unsafe return paths', () => {
  assert.equal(buildSessionHrefFromSearch('010815'), '/sessions/010815');
  assert.equal(
    buildSessionHrefFromSearch('020604-local', { passage: 3, returnTo: '/search?q=pier' }),
    '/sessions/020604-local?from=%2Fsearch%3Fq%3Dpier#p3',
  );
  assert.equal(
    buildSessionHrefFromSearch('010815', { returnTo: '/search' }),
    '/sessions/010815?from=%2Fsearch',
  );

  // Invalid passage numbers are ignored.
  for (const badPassage of [0, -1, 1.5, NaN, Infinity]) {
    assert.equal(
      buildSessionHrefFromSearch('010815', { passage: badPassage, returnTo: '/search?q=bell' }),
      '/sessions/010815?from=%2Fsearch%3Fq%3Dbell',
    );
  }

  // Unsafe returnTo values are rejected cleanly.
  for (const unsafe of ['', '//evil.com', 'https://evil.com/search', 'javascript:alert(1)', '/sessions', '/search-other', '/search?q=a\nb']) {
    assert.equal(isSafeSearchReturnPath(unsafe), false, `Expected ${JSON.stringify(unsafe)} to be rejected`);
    assert.equal(buildSessionHrefFromSearch('010815', { passage: 2, returnTo: unsafe }), '/sessions/010815#p2');
  }
});

test('explicit sort detection and query-transition sort resolution preserve explicit sorts while defaulting bare /search to relevance', () => {
  assert.equal(hasExplicitSortParam(new URLSearchParams('')), false);
  assert.equal(hasExplicitSortParam(new URLSearchParams('sort=invalid')), false);
  assert.equal(hasExplicitSortParam(new URLSearchParams('sort=age-desc')), true);
  assert.equal(hasExplicitSortParam(new URLSearchParams('sort=age-asc')), true);
  assert.equal(hasExplicitSortParam(new URLSearchParams('sort=relevance')), true);

  // Bare /search switches to relevance when adding a query, and back to age-asc when cleared.
  assert.equal(resolveSortForQueryChange('age-asc', false, true, false), 'relevance');
  assert.equal(resolveSortForQueryChange('relevance', true, false, false), 'age-asc');

  // Explicit age-desc or age-asc stays preserved when adding or clearing a query.
  assert.equal(resolveSortForQueryChange('age-desc', false, true, true), 'age-desc');
  assert.equal(resolveSortForQueryChange('age-asc', false, true, true), 'age-asc');
  assert.equal(resolveSortForQueryChange('age-desc', true, false, true), 'age-desc');

  // Serializing with explicitSort keeps sort=age-asc even on empty-query URLs (e.g. view switches),
  // while leaving bare /search clean when sort was inferred.
  const emptyList = parseSearchUrlParams(new URLSearchParams('sort=age-asc&view=list'));
  assert.equal(buildSearchHref(emptyList), '/search?view=list');
  assert.equal(buildSearchHref(emptyList, { explicitSort: true }), '/search?sort=age-asc&view=list');
  assert.equal(
    hasExplicitSortParam(serializeSearchUrlParams(emptyList, { explicitSort: true })),
    true,
  );
  assert.equal(
    hasExplicitSortParam(serializeSearchUrlParams(emptyList, { explicitSort: false })),
    false,
  );
});

test('selectableTopicSet aligns URL topic validation strictly with curated dropdown themes', () => {
  const selectable = selectableTopicSet([
    { name: 'Play and imagination' },
    { name: 'Uncurated custom topic' },
  ]);
  assert.equal(selectable.has('Play and imagination'), true);
  assert.equal(selectable.has('Uncurated custom topic'), false);
  assert.equal(
    parseSearchUrlParams(new URLSearchParams('topic=Uncurated+custom+topic'), { validTopics: selectable }).topic,
    '',
  );
});

test('parseSearchResponse validates the /api/search response boundary and rejects malformed payloads', () => {
  const validPayload = {
    total: 1,
    page: 1,
    pages: 1,
    pageSize: 18,
    results: [
      {
        matchedIn: 'transcript',
        matchedPassage: 3,
        excerpt: 'Can the blue locomotive meet the ferry at the pier?',
        session: {
          id: 'fixture-020604-lighthouse',
          slug: '020604-local',
          legacyId: 'fixture-020604-lighthouse',
          sourceName: '020604-local.json',
          title: 'Paper lighthouse and harbor bells',
          overview: 'Synthetic overview.',
          origin: 'local_ai_draft',
          topics: ['Music and stories'],
          dates: [],
          ages: [],
          inferredAge: '2;06.04',
          recordings: [{ id: 'a1', name: '020604.mp3', format: 'mp3', duration: 18, bytes: 1024, available: true, kind: 'original' }],
          preferredRecordingId: 'a1',
        },
        linguisticEvidence: {
          marker: 'question',
          count: 1,
          examples: [{ passageIndex: 2, text: 'Can the blue locomotive meet the ferry at the pier?', start: 10 }],
        },
      },
    ],
  };

  const parsed = parseSearchResponse(validPayload);
  assert.ok(parsed);
  assert.equal(parsed.total, 1);
  assert.equal(parsed.results[0].matchedPassage, 3);
  assert.equal(parsed.results[0].session.slug, '020604-local');

  // Negative boundary cases: malformed outer fields, missing session, invalid origin, invalid matchedPassage.
  for (const malformed of [
    null,
    [],
    {},
    { ...validPayload, total: -1 },
    { ...validPayload, page: 0 },
    { ...validPayload, pages: 0 },
    { ...validPayload, pageSize: 20 },
    { ...validPayload, results: [{}] },
    { ...validPayload, results: [{ ...validPayload.results[0], matchedIn: 'unknown' }] },
    { ...validPayload, results: [{ ...validPayload.results[0], matchedPassage: 0 }] },
    { ...validPayload, results: [{ ...validPayload.results[0], session: { ...validPayload.results[0].session, origin: 'bogus' } }] },
    { ...validPayload, results: [{ ...validPayload.results[0], session: { ...validPayload.results[0].session, topics: 'not-an-array' } }] },
    { ...validPayload, results: [{ ...validPayload.results[0], linguisticEvidence: { marker: 'bogus', count: 1, examples: [] } }] },
  ]) {
    assert.equal(parseSearchResponse(malformed), null, `Expected malformed payload to be rejected: ${JSON.stringify(malformed)}`);
  }
});

test('view=concordance URL state parses, serializes, omits sort, preserves speaker scope, and maps cleanly to /api/concordance', () => {
  // Open concordance defaults speaker to 'any' and always orders by age-asc.
  const open = parseSearchUrlParams(new URLSearchParams('q=locomotive&view=concordance&sort=age-desc'));
  assert.equal(open.view, 'concordance');
  assert.equal(open.speaker, 'any');
  assert.equal(open.sort, 'age-asc');
  assert.equal(hasExplicitSortParam(new URLSearchParams('q=locomotive&view=concordance&sort=age-desc')), false);
  assert.equal(buildSearchHref(open), '/search?q=locomotive&view=concordance');
  assert.equal(defaultSpeakerForSearch('', 'concordance'), 'any');
  assert.equal(defaultSpeakerForSearch('repetition', 'concordance'), 'child');
  assert.equal(defaultSpeakerForSearch('', 'details'), 'child');

  // Explicit speaker=child without a marker is preserved in concordance URLs and marks filters active.
  const childOnly = parseSearchUrlParams(new URLSearchParams('q=locomotive&speaker=child&view=concordance'));
  assert.equal(childOnly.speaker, 'child');
  assert.equal(buildSearchHref(childOnly), '/search?q=locomotive&speaker=child&view=concordance');
  assert.deepEqual(parseSearchUrlParams(serializeSearchUrlParams(childOnly)), childOnly);
  assert.equal(
    hasActiveSearchFilters(parseSearchUrlParams(new URLSearchParams('speaker=child&view=concordance'))),
    true,
  );
  assert.equal(
    hasActiveSearchFilters(parseSearchUrlParams(new URLSearchParams('view=concordance'))),
    false,
  );

  // Linguistic marker in concordance defaults speaker to 'child' and serializes speaker=any explicitly.
  const markerChild = parseSearchUrlParams(new URLSearchParams('q=locomotive&marker=repetition&view=concordance'));
  assert.equal(markerChild.speaker, 'child');
  assert.equal(buildSearchHref(markerChild), '/search?q=locomotive&marker=repetition&view=concordance');

  const markerAny = parseSearchUrlParams(new URLSearchParams('q=locomotive&marker=repetition&speaker=any&view=concordance&ageMin=18&ageMax=36&page=2'));
  assert.equal(markerAny.speaker, 'any');
  assert.equal(buildSearchHref(markerAny), '/search?q=locomotive&marker=repetition&speaker=any&ageMin=18&ageMax=36&view=concordance&page=2');
  assert.deepEqual(concordanceRequestFromUrlState(markerAny), {
    query: 'locomotive',
    topic: '',
    origin: '',
    marker: 'repetition',
    speaker: 'any',
    ageMin: 18,
    ageMax: 36,
    page: 2,
    pageSize: 50,
  });
});

test('parseConcordanceResponse validates /api/concordance payloads at runtime and rejects malformed inputs', () => {
  const validPayload = {
    total: 2,
    sessionCount: 2,
    page: 1,
    pages: 1,
    pageSize: 50,
    rows: [
      {
        sessionId: 'fixture-010815-locomotive',
        sessionSlug: '010815',
        sessionTitle: 'Blue locomotive and wooden bridge',
        sourceName: '010815.cha',
        origin: 'archived_research',
        ages: ['1;08.15'],
        inferredAge: null,
        passageNumber: 1,
        speaker: 'Child (CHI, target child)',
        start: 0,
        leftContext: 'blue [/] blue',
        match: 'locomotive',
        rightContext: '!',
      },
      {
        sessionId: 'fixture-020604-lighthouse',
        sessionSlug: '020604-local',
        sessionTitle: 'Paper lighthouse and harbor bells',
        sourceName: '020604-local.json',
        origin: 'local_ai_draft',
        ages: [],
        inferredAge: '2;06.04',
        passageNumber: 3,
        speaker: null,
        start: 10,
        leftContext: 'Can the blue',
        match: 'locomotive',
        rightContext: 'meet the ferry at the pier?',
      },
    ],
  };

  const parsed = parseConcordanceResponse(validPayload);
  assert.ok(parsed);
  assert.equal(parsed.total, 2);
  assert.equal(parsed.sessionCount, 2);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[1].speaker, null);

  for (const malformed of [
    null,
    [],
    {},
    { ...validPayload, total: -1 },
    { ...validPayload, sessionCount: 3 },
    { ...validPayload, page: 0 },
    { ...validPayload, pages: 0 },
    { ...validPayload, page: 2, pages: 1 },
    { ...validPayload, total: 0, sessionCount: 0 },
    { ...validPayload, pageSize: 18 },
    { ...validPayload, rows: [{}] },
    { ...validPayload, rows: [{ ...validPayload.rows[0], sessionId: '' }] },
    { ...validPayload, rows: [{ ...validPayload.rows[0], sessionSlug: '' }] },
    { ...validPayload, rows: [{ ...validPayload.rows[0], origin: 'bogus' }] },
    { ...validPayload, rows: [{ ...validPayload.rows[0], passageNumber: 0 }] },
    { ...validPayload, rows: [{ ...validPayload.rows[0], start: -1 }] },
    { ...validPayload, rows: [{ ...validPayload.rows[0], match: '' }] },
    { ...validPayload, rows: [{ ...validPayload.rows[0], ages: '1;08.15' }] },
  ]) {
    assert.equal(parseConcordanceResponse(malformed), null, `Expected malformed concordance payload to be rejected: ${JSON.stringify(malformed)}`);
  }
});
