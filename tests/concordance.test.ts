import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareConcordanceSessions,
  CONCORDANCE_CONTEXT_CHARS,
  CONCORDANCE_PAGE_SIZE,
  extractConcordanceMatch,
  isConcordancePageSize,
  makeConcordance,
  parseConcordanceBody,
} from '../src/lib/concordance';
import type { ArchiveData, Passage, Session } from '../src/lib/types';

function mockSession(id: string, changes: Partial<Session> = {}): Session {
  return {
    id,
    slug: id,
    legacyId: id,
    sourceName: `${id}.cha`,
    title: `Session ${id}`,
    overview: 'Synthetic session overview.',
    origin: 'archived_research',
    topics: [],
    dates: [],
    ages: [],
    inferredAge: null,
    recordings: [],
    preferredRecordingId: null,
    sources: [],
    moments: [],
    limits: [],
    transcript: [],
    sourceSha256: '',
    association: '',
    ...changes,
  };
}

const child = (text: string, changes: Partial<Passage> = {}): Passage => ({
  speaker: 'Child (CHI, target child)',
  text,
  ...changes,
});

const parent = (text: string, changes: Partial<Passage> = {}): Passage => ({
  speaker: 'Parent (FAT, father)',
  text,
  ...changes,
});

test('extractConcordanceMatch matches exact words, phrases, quoted phrases, accents, apostrophes, CHAT notation, and Unicode safely', () => {
  // Single word with exact word boundaries ("no" must not match "not", "now", "know", or "piano").
  const boundary = extractConcordanceMatch('not now, know piano, no , I want lanterns .', 'no');
  assert.deepEqual(boundary, {
    leftContext: 'not now, know piano,',
    match: 'no',
    rightContext: ', I want lanterns .',
  });
  assert.equal(extractConcordanceMatch('not now, know piano .', 'no'), null);

  // Case-insensitive and accent-insensitive matching preserves exact original source casing and diacritics (NFC & NFD).
  const nfc = extractConcordanceMatch('Visiting the Café by the bridge .', 'cafe');
  assert.deepEqual(nfc, {
    leftContext: 'Visiting the',
    match: 'Café',
    rightContext: 'by the bridge .',
  });
  const nfd = extractConcordanceMatch('Visiting the Cafe\u0301 by the bridge .', 'cafe');
  assert.deepEqual(nfd, {
    leftContext: 'Visiting the',
    match: 'Cafe\u0301',
    rightContext: 'by the bridge .',
  });

  // Curly and straight apostrophes match interchangeably while retaining authentic source text.
  const apostrophe = extractConcordanceMatch('I don’t want that one .', "don't");
  assert.deepEqual(apostrophe, {
    leftContext: 'I',
    match: 'don’t',
    rightContext: 'want that one .',
  });

  // Exact contiguous phrase matching (including optional outer straight or curly quotes).
  const phrase = extractConcordanceMatch('blue [/] blue locomotive !', 'blue locomotive');
  assert.deepEqual(phrase, {
    leftContext: 'blue [/]',
    match: 'blue locomotive',
    rightContext: '!',
  });
  assert.deepEqual(
    extractConcordanceMatch('blue [/] blue locomotive !', '"blue locomotive"'),
    phrase,
  );
  assert.deepEqual(
    extractConcordanceMatch('blue [/] blue locomotive !', '“blue locomotive”'),
    phrase,
  );
  // Non-contiguous words must not match an exact phrase.
  assert.equal(extractConcordanceMatch('blue wooden locomotive !', 'blue locomotive'), null);

  // CHAT notation matches literally without requiring alphanumeric word boundaries and distinguishes [/] vs [//].
  assert.deepEqual(extractConcordanceMatch('blue [/] blue locomotive !', '[/]'), {
    leftContext: 'blue',
    match: '[/]',
    rightContext: 'blue locomotive !',
  });
  assert.equal(extractConcordanceMatch('where [//] where is the bridge ?', '[/]'), null);
  assert.deepEqual(extractConcordanceMatch('where [//] where is the bridge (.) papa ?', '(.)'), {
    leftContext: 'where [//] where is the bridge',
    match: '(.)',
    rightContext: 'papa ?',
  });

  // Multiple occurrences in one passage return a single slice anchored at the first exact match.
  assert.deepEqual(extractConcordanceMatch('blue [/] blue locomotive !', 'blue'), {
    leftContext: '',
    match: 'blue',
    rightContext: '[/] blue locomotive !',
  });

  // Astral Unicode characters (surrogate pairs) are never split during matching or truncation.
  const astralPrefix = '🚂 '.repeat(40);
  const astralSuffix = ' 🌉'.repeat(40);
  const astral = extractConcordanceMatch(`${astralPrefix}locomotive${astralSuffix}`, 'locomotive', 24);
  assert.ok(astral);
  assert.equal(astral.match, 'locomotive');
  assert.ok(astral.leftContext.startsWith('…'));
  assert.ok(astral.rightContext.endsWith('…'));
  assert.equal(/\uFFFD/.test(astral.leftContext + astral.rightContext), false);
  // Ensure no lone UTF-16 surrogates appear in truncated strings.
  const hasLoneSurrogate = (value: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
  assert.equal(hasLoneSurrogate(astral.leftContext), false);
  assert.equal(hasLoneSurrogate(astral.rightContext), false);

  // Empty/whitespace queries return null cleanly.
  assert.equal(extractConcordanceMatch('blue locomotive', ''), null);
  assert.equal(extractConcordanceMatch('blue locomotive', '   '), null);
  assert.equal(extractConcordanceMatch('blue locomotive', '""'), null);
});

test('extractConcordanceMatch truncates long left and right contexts cleanly with ellipses only when elided', () => {
  const longLeft = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma';
  const longRight = 'tau upsilon phi chi psi omega one two three four five six seven eight nine ten eleven twelve';
  const slice = extractConcordanceMatch(`${longLeft} locomotive ${longRight}`, 'locomotive', CONCORDANCE_CONTEXT_CHARS);
  assert.ok(slice);
  assert.equal(slice.match, 'locomotive');
  assert.ok(slice.leftContext.startsWith('…'));
  assert.ok(slice.leftContext.endsWith('rho sigma'));
  assert.ok(slice.leftContext.length <= CONCORDANCE_CONTEXT_CHARS + 1);
  assert.ok(slice.rightContext.startsWith('tau upsilon'));
  assert.ok(slice.rightContext.endsWith('…'));
  assert.ok(slice.rightContext.length <= CONCORDANCE_CONTEXT_CHARS + 1);

  const shortSlice = extractConcordanceMatch('blue locomotive !', 'locomotive', CONCORDANCE_CONTEXT_CHARS);
  assert.deepEqual(shortSlice, {
    leftContext: 'blue',
    match: 'locomotive',
    rightContext: '!',
  });
});

test('makeConcordance returns exact transcript passage matches only (zero guide-only hits, metadata, or dependent tiers) ordered strictly by age', () => {
  const data: ArchiveData = {
    version: 1,
    generatedAt: '',
    assets: {},
    documents: [],
    sessions: [
      mockSession('late-local', {
        slug: '020604-local',
        sourceName: '020604-local.json',
        origin: 'local_ai_draft',
        title: 'Harbor lighthouse',
        overview: 'Mentions a wooden track and a locomotive.',
        inferredAge: '2;06.04',
        topics: ['Outings and nature'],
        transcript: [
          { text: 'Can the blue locomotive meet the ferry at the pier?', start: 10 },
          { text: '[[LOCAL AI-GENERATED EDITORIAL PROVENANCE COMMENT | locomotive editorial note | END LOCAL AI EDITORIAL COMMENT]]' },
        ],
      }),
      mockSession('unaged-research', {
        slug: '011103',
        sourceName: '011103.cha',
        origin: 'archived_research',
        title: 'Cardboard observatory',
        overview: 'Mentions a wooden track in guide prose.',
        topics: ['Learning and questions'],
        transcript: [
          { text: '[Source Comment] locomotive in metadata header' },
          child('the bright [/] bright locomotive (.) right here .', { start: null }),
        ],
      }),
      mockSession('tie-b', {
        slug: '010815b',
        sourceName: '010815b.cha',
        origin: 'archived_research',
        title: 'Second session at 1;08.15',
        ages: ['1;08.15'],
        topics: ['Play and imagination'],
        transcript: [
          child('another locomotive on the wooden station .', { start: 3 }),
        ],
      }),
      mockSession('tie-a', {
        slug: '010815a',
        sourceName: '010815a.cha',
        origin: 'archived_research',
        title: 'First session at 1;08.15',
        overview: 'Assembling a wooden track across the table.',
        ages: ['1;08.15'],
        topics: ['Play and imagination'],
        moments: [
          { title: 'Wooden track crossing', description: 'Testing the wooden track.', start: 1, end: 5, locator: 'Lines 1–3' },
        ],
        transcript: [
          child('blue [/] blue locomotive !', { start: 0 }),
          parent('where does the locomotive go next ?', { start: 4 }),
          child('where [//] where is the bridge (.) papa ?\n  Note: pointing at the locomotive note', { start: 9 }),
        ],
      }),
    ],
  };

  const concordance = makeConcordance(data);

  // Exact matches ordered by age (source or inferred youngest-first), ties by lowercase slug, then 1-based passage number, unaged last.
  const result = concordance({ query: 'locomotive' });
  assert.equal(result.total, 5);
  assert.equal(result.sessionCount, 4);
  assert.equal(result.page, 1);
  assert.equal(result.pages, 1);
  assert.equal(result.pageSize, CONCORDANCE_PAGE_SIZE);
  assert.deepEqual(
    result.rows.map(row => `${row.sessionSlug}#p${row.passageNumber}`),
    [
      '010815a#p1',
      '010815a#p2',
      '010815b#p1',
      '020604-local#p1',
      '011103#p2',
    ],
  );
  // Passage 3 of 010815a only mentions "locomotive" in a dependent Note line -> excluded.
  // Passage 1 of 011103 is speakerless metadata -> excluded.
  // Passage 2 of 020604-local is an editorial comment -> excluded.
  assert.equal(result.rows[0].speaker, 'Child (CHI, target child)');
  assert.equal(result.rows[1].speaker, 'Parent (FAT, father)');
  assert.equal(result.rows[3].speaker, null);
  assert.deepEqual(result.rows[3].ages, []);
  assert.equal(result.rows[3].inferredAge, '2;06.04');
  assert.equal(result.rows[4].ages.length, 0);
  assert.equal(result.rows[4].inferredAge, null);

  // Guide-only phrase ("wooden track") never produces concordance rows.
  const guideOnly = concordance({ query: 'wooden track' });
  assert.equal(guideOnly.total, 0);
  assert.equal(guideOnly.sessionCount, 0);
  assert.deepEqual(guideOnly.rows, []);

  // Empty query returns empty result cleanly.
  const empty = concordance({ query: '   ' });
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.rows, []);

  // Comparator breaks ties by lowercase slug directly.
  assert.ok(
    compareConcordanceSessions(
      { id: '1', slug: '010815a', sourceName: 'z.cha', ages: ['1;08.15'], inferredAge: null },
      { id: '2', slug: '010815b', sourceName: 'a.cha', ages: ['1;08.15'], inferredAge: null },
    ) < 0,
  );
});

test('makeConcordance applies origin, speaker, age-range, topic, and passage-level linguistic marker filters consistently', () => {
  const data: ArchiveData = {
    version: 1,
    generatedAt: '',
    assets: {},
    documents: [],
    sessions: [
      mockSession('research-young', {
        slug: '010815',
        origin: 'archived_research',
        ages: ['1;08.15'],
        topics: ['Play and imagination'],
        transcript: [
          child('blue [/] blue locomotive !', { start: 0 }),
          parent('where does the locomotive go next ?', { start: 4 }),
        ],
      }),
      mockSession('talkbank-mid', {
        slug: '020110-tb',
        origin: 'talkbank_ai_draft',
        ages: ['2;01.10'],
        topics: ['Play and imagination'],
        transcript: [
          { speaker: 'Participant (PAR1)', text: 'the yellow locomotive [/] locomotive dives .', start: 0 },
        ],
      }),
      mockSession('local-old', {
        slug: '020604-local',
        origin: 'local_ai_draft',
        inferredAge: '2;06.04',
        topics: ['Outings and nature'],
        transcript: [
          { text: 'Can the blue locomotive meet the ferry at the pier?', start: 10 },
        ],
      }),
      mockSession('unaged', {
        slug: '011103',
        origin: 'archived_research',
        topics: ['Learning and questions'],
        transcript: [
          child('no locomotive here .', { start: null }),
        ],
      }),
    ],
  };

  const concordance = makeConcordance(data);

  // Origin filter.
  assert.deepEqual(
    concordance({ query: 'locomotive', origin: 'talkbank_ai_draft' }).rows.map(r => `${r.sessionSlug}#p${r.passageNumber}`),
    ['020110-tb#p1'],
  );

  // Speaker filter: 'child' restricts strictly to explicit CHI in archived_research.
  assert.deepEqual(
    concordance({ query: 'locomotive', speaker: 'child' }).rows.map(r => `${r.sessionSlug}#p${r.passageNumber}`),
    ['010815#p1', '011103#p1'],
  );

  // Topic filter.
  assert.deepEqual(
    concordance({ query: 'locomotive', topic: 'Outings and nature' }).rows.map(r => `${r.sessionSlug}#p${r.passageNumber}`),
    ['020604-local#p1'],
  );

  // Age-range filter uses source-or-inferred age and excludes unaged sessions.
  assert.deepEqual(
    concordance({ query: 'locomotive', ageMin: 24, ageMax: 35 }).rows.map(r => `${r.sessionSlug}#p${r.passageNumber}`),
    ['020110-tb#p1', '020604-local#p1'],
  );
  // Inverted age range returns 0 cleanly.
  assert.equal(concordance({ query: 'locomotive', ageMin: 35, ageMax: 24 }).total, 0);

  // Linguistic marker intersects at the PASSAGE level:
  // default speaker for marker is 'child' (excludes Parent FAT, TalkBank PAR1, and local AI).
  assert.deepEqual(
    concordance({ query: 'locomotive', marker: 'repetition' }).rows.map(r => `${r.sessionSlug}#p${r.passageNumber}`),
    ['010815#p1'],
  );
  assert.deepEqual(
    concordance({ query: 'locomotive', marker: 'repetition', speaker: 'any' }).rows.map(r => `${r.sessionSlug}#p${r.passageNumber}`),
    ['010815#p1', '020110-tb#p1'],
  );
  // Question marker with child scope -> 0 (neither question passage is CHI).
  assert.equal(concordance({ query: 'locomotive', marker: 'question', speaker: 'child' }).total, 0);
  // Question marker with any scope -> parent question in 010815#p2 and local AI question in 020604-local#p1.
  assert.deepEqual(
    concordance({ query: 'locomotive', marker: 'question', speaker: 'any' }).rows.map(r => `${r.sessionSlug}#p${r.passageNumber}`),
    ['010815#p2', '020604-local#p1'],
  );
});

test('makeConcordance paginates cleanly with accurate total, sessionCount, and clamped page numbers', () => {
  const manyPassages: Passage[] = Array.from({ length: 65 }, (_, index) =>
    child(`turn ${index + 1} locomotive sound .`, { start: index }),
  );
  const data: ArchiveData = {
    version: 1,
    generatedAt: '',
    assets: {},
    documents: [],
    sessions: [
      mockSession('s1', { slug: '010815', ages: ['1;08.15'], transcript: manyPassages.slice(0, 40) }),
      mockSession('s2', { slug: '020110', ages: ['2;01.10'], transcript: manyPassages.slice(40) }),
    ],
  };

  const concordance = makeConcordance(data);

  const page1 = concordance({ query: 'locomotive', page: 1 });
  assert.equal(page1.total, 65);
  assert.equal(page1.sessionCount, 2);
  assert.equal(page1.page, 1);
  assert.equal(page1.pages, 2);
  assert.equal(page1.pageSize, 50);
  assert.equal(page1.rows.length, 50);
  assert.equal(page1.rows[0].sessionSlug, '010815');
  assert.equal(page1.rows[0].passageNumber, 1);
  assert.equal(page1.rows[49].sessionSlug, '020110');
  assert.equal(page1.rows[49].passageNumber, 10);

  const page2 = concordance({ query: 'locomotive', page: 2 });
  assert.equal(page2.total, 65);
  assert.equal(page2.sessionCount, 2);
  assert.equal(page2.page, 2);
  assert.equal(page2.pages, 2);
  assert.equal(page2.rows.length, 15);
  assert.equal(page2.rows[0].sessionSlug, '020110');
  assert.equal(page2.rows[0].passageNumber, 11);
  assert.equal(page2.rows[14].passageNumber, 25);

  // Out-of-bounds pages clamp cleanly.
  assert.equal(concordance({ query: 'locomotive', page: 999 }).page, 2);
  assert.equal(concordance({ query: 'locomotive', page: -3 }).page, 1);
  assert.equal(concordance({ query: 'locomotive', page: NaN }).page, 1);

  assert.equal(isConcordancePageSize(50), true);
  for (const invalid of [null, undefined, 0, 18, 36, 51, '50', NaN]) {
    assert.equal(isConcordancePageSize(invalid), false);
  }
});

test('parseConcordanceBody validates /api/concordance request payloads and rejects invalid or inverted fields', () => {
  const valid = parseConcordanceBody({
    query: 'locomotive',
    topic: 'Play and imagination',
    origin: 'archived_research',
    ageMin: 18,
    ageMax: 36,
    marker: 'repetition',
    speaker: 'any',
    page: 2,
    pageSize: 50,
  });
  assert.deepEqual(valid, {
    ok: true,
    request: {
      query: 'locomotive',
      topic: 'Play and imagination',
      origin: 'archived_research',
      ageMin: 18,
      ageMax: 36,
      marker: 'repetition',
      speaker: 'any',
      page: 2,
      pageSize: 50,
    },
  });

  // Empty strings for optional origin/marker stay accepted cleanly.
  assert.deepEqual(parseConcordanceBody({ query: 'locomotive', origin: '', marker: '' }), {
    ok: true,
    request: { query: 'locomotive', origin: '', marker: '' },
  });

  for (const invalidBody of [
    null,
    [],
    'locomotive',
    { query: 123 },
    { topic: 42 },
    { origin: 'bogus_origin' },
    { ageMin: -1 },
    { ageMax: 241 },
    { ageMin: 1.5 },
    { ageMin: 30, ageMax: 20 },
    { marker: 'bogus_marker' },
    { speaker: 'unknown_speaker' },
    { page: '2' },
    { page: Infinity },
    { pageSize: 18 },
  ]) {
    const result = parseConcordanceBody(invalidBody);
    assert.equal(result.ok, false, `Expected parseConcordanceBody to reject ${JSON.stringify(invalidBody)}`);
  }
});
