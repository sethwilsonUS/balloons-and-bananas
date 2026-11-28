import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_DRAFT_QUALIFIER,
  buildSessionCitations,
  CORPUS_CREDIT_LINE,
  CORPUS_DOI_ID,
  CORPUS_DOI_URL,
  CORPUS_TITLE,
  escapeBibtexValue,
  formatBibtexKey,
  formatCanonicalCitationUrl,
  formatLocalCalendarDateIso,
  type CitationSessionInput,
} from '../src/lib/citations';

const ACCESS_DATE = '2026-11-27';
const SITE_ORIGIN = 'https://thesethtapes.example';

const archivedSession: CitationSessionInput = {
  slug: '010815',
  ages: ['1;08.15'],
  inferredAge: null,
  dates: ['1983-01-15'],
  origin: 'archived_research',
};

const talkbankAiSession: CitationSessionInput = {
  slug: '020110-tb',
  ages: ['2;01.10'],
  inferredAge: null,
  dates: ['1983-06-10'],
  origin: 'talkbank_ai_draft',
};

const localAiInferredSession: CitationSessionInput = {
  slug: '020604-local',
  ages: [],
  inferredAge: '2;06.04',
  dates: [],
  origin: 'local_ai_draft',
};

const unagedSession: CitationSessionInput = {
  slug: '011103',
  ages: [],
  inferredAge: null,
  dates: ['1983-04-03'],
  origin: 'archived_research',
};

const undatedUnagedSession: CitationSessionInput = {
  slug: '011119d-82-supp',
  ages: [],
  inferredAge: null,
  dates: [],
  origin: 'archived_research',
};

test('approved corpus credit line and constants match TalkBank Peters/Wilson Corpus metadata', () => {
  assert.equal(CORPUS_TITLE, 'CHILDES English Peters/Wilson Corpus');
  assert.equal(CORPUS_DOI_ID, '10.21415/T5NS4D');
  assert.equal(CORPUS_DOI_URL, 'https://doi.org/10.21415/T5NS4D');
  assert.equal(
    CORPUS_CREDIT_LINE,
    'Peters, Ann, and Bob Wilson. CHILDES English Peters/Wilson Corpus (TalkBank, https://doi.org/10.21415/T5NS4D), via The Seth Tapes',
  );
  assert.equal(AI_DRAFT_QUALIFIER, '(machine transcription, unreviewed)');
});

test('buildSessionCitations produces Chicago, APA, and BibTeX for an archived research session and passage', () => {
  const whole = buildSessionCitations(archivedSession, {
    origin: SITE_ORIGIN,
    accessDate: ACCESS_DATE,
  });

  assert.equal(whole.bibtexKey, 'sethtapes_010815');
  assert.equal(whole.url, 'https://thesethtapes.example/sessions/010815');
  assert.equal(whole.accessDateIso, '2026-11-27');
  assert.equal(whole.isAiDraft, false);
  assert.equal(whole.ageLabel, 'age 1;08.15');
  assert.equal(whole.ageIsInferred, false);

  assert.equal(
    whole.chicago,
    'Peters, Ann, and Bob Wilson. "Session 010815" (age 1;08.15; recorded January 15, 1983). Archived research transcript. In CHILDES English Peters/Wilson Corpus (TalkBank, https://doi.org/10.21415/T5NS4D), via The Seth Tapes. Accessed November 27, 2026. https://thesethtapes.example/sessions/010815',
  );
  assert.equal(
    whole.apa,
    'Peters, A., & Wilson, B. (1983, January 15). Session 010815 (age 1;08.15) [Archived research transcript]. CHILDES English Peters/Wilson Corpus (TalkBank, https://doi.org/10.21415/T5NS4D), via The Seth Tapes. Retrieved November 27, 2026, from https://thesethtapes.example/sessions/010815',
  );
  assert.ok(whole.bibtex.startsWith('@misc{sethtapes_010815,\n'));
  assert.ok(whole.bibtex.includes('  author       = {Peters, Ann and Wilson, Bob},'));
  assert.ok(whole.bibtex.includes('  title        = {{Session 010815}},'));
  assert.ok(whole.bibtex.includes('  year         = {1983},'));
  assert.ok(whole.bibtex.includes('  month        = jan,'));
  assert.ok(whole.bibtex.includes('  doi          = {10.21415/T5NS4D},'));
  assert.ok(whole.bibtex.includes('  url          = {https://thesethtapes.example/sessions/010815},'));
  assert.ok(whole.bibtex.includes('  urldate      = {2026-11-27},'));
  assert.ok(whole.bibtex.includes('  note         = {Archived research transcript; age 1;08.15; recorded January 15, 1983; accessed November 27, 2026}'));

  // Archived research citations never carry the AI-draft qualifier
  for (const text of [whole.chicago, whole.apa, whole.bibtex]) {
    assert.ok(!text.includes(AI_DRAFT_QUALIFIER), text);
    assert.ok(!text.toLowerCase().includes('inferred'), text);
  }

  // Passage citation includes passage number, #p42 URL, and predictable BibTeX key
  const passage = buildSessionCitations(
    { ...archivedSession, slug: '010626' },
    { passageNumber: 42, origin: SITE_ORIGIN, accessDate: new Date('2026-11-27T18:30:00Z') },
  );
  assert.equal(passage.bibtexKey, 'sethtapes_010626_p42');
  assert.equal(passage.url, 'https://thesethtapes.example/sessions/010626#p42');
  assert.ok(passage.chicago.includes('"Session 010626, passage 42"'));
  assert.ok(passage.chicago.endsWith('https://thesethtapes.example/sessions/010626#p42'));
  assert.ok(passage.apa.includes('Session 010626, passage 42 (age 1;08.15)'));
  assert.ok(passage.apa.endsWith('https://thesethtapes.example/sessions/010626#p42'));
  assert.ok(passage.bibtex.startsWith('@misc{sethtapes_010626_p42,\n'));
  assert.ok(passage.bibtex.includes('  title        = {{Session 010626, passage 42}},'));
  assert.ok(passage.bibtex.includes('  url          = {https://thesethtapes.example/sessions/010626#p42},'));
});

test('TalkBank AI draft citations state TalkBank AI draft and include "(machine transcription, unreviewed)" in all formats', () => {
  const result = buildSessionCitations(talkbankAiSession, {
    passageNumber: 2,
    origin: SITE_ORIGIN,
    accessDate: ACCESS_DATE,
  });

  assert.equal(result.isAiDraft, true);
  assert.equal(result.bibtexKey, 'sethtapes_020110-tb_p2');
  assert.equal(result.url, 'https://thesethtapes.example/sessions/020110-tb#p2');

  for (const text of [result.chicago, result.apa, result.bibtex]) {
    assert.ok(text.includes('TalkBank AI draft'), text);
    assert.ok(text.includes(AI_DRAFT_QUALIFIER), text);
    assert.ok(text.includes('age 2;01.10'), text);
    assert.ok(!text.toLowerCase().includes('inferred'), text);
    assert.ok(text.includes('June 10, 1983') || text.includes('1983, June 10'), text);
    assert.ok(text.includes('https://thesethtapes.example/sessions/020110-tb#p2'), text);
  }
  assert.ok(result.bibtex.includes('  year         = {1983},'));
  assert.ok(result.bibtex.includes('  month        = jun,'));
});

test('local AI draft citations label inferred ages explicitly, omit unknown dates without inferring them, and carry the AI-draft qualifier', () => {
  const result = buildSessionCitations(localAiInferredSession, {
    passageNumber: 3,
    origin: SITE_ORIGIN,
    accessDate: ACCESS_DATE,
  });

  assert.equal(result.isAiDraft, true);
  assert.equal(result.ageLabel, 'inferred age 2;06.04');
  assert.equal(result.ageIsInferred, true);
  assert.equal(result.bibtexKey, 'sethtapes_020604-local_p3');

  assert.equal(
    result.chicago,
    'Peters, Ann, and Bob Wilson. "Session 020604-local, passage 3" (inferred age 2;06.04). Local AI draft (machine transcription, unreviewed). In CHILDES English Peters/Wilson Corpus (TalkBank, https://doi.org/10.21415/T5NS4D), via The Seth Tapes. Accessed November 27, 2026. https://thesethtapes.example/sessions/020604-local#p3',
  );
  assert.equal(
    result.apa,
    'Peters, A., & Wilson, B. (n.d.). Session 020604-local, passage 3 (inferred age 2;06.04) [Local AI draft (machine transcription, unreviewed)]. CHILDES English Peters/Wilson Corpus (TalkBank, https://doi.org/10.21415/T5NS4D), via The Seth Tapes. Retrieved November 27, 2026, from https://thesethtapes.example/sessions/020604-local#p3',
  );
  assert.ok(result.bibtex.includes('Local AI draft (machine transcription, unreviewed); inferred age 2;06.04; accessed November 27, 2026'));
  assert.ok(!result.bibtex.includes('  year         ='), 'BibTeX must not invent a year when no date is known');
  assert.ok(!result.bibtex.includes('  month        ='), 'BibTeX must not invent a month when no date is known');
  assert.ok(!result.chicago.includes('recorded '), 'Chicago must not invent a recording date');
});

test('source age takes precedence over inferredAge when both are present, and missing age/date omit cleanly', () => {
  const bothAges = buildSessionCitations(
    { ...archivedSession, ages: ['1;08.15', '1;08.16'], inferredAge: '1;08.15' },
    { origin: SITE_ORIGIN, accessDate: ACCESS_DATE },
  );
  assert.equal(bothAges.ageIsInferred, false);
  assert.equal(bothAges.ageLabel, 'age 1;08.15 / 1;08.16');
  assert.ok(bothAges.chicago.includes('(age 1;08.15 / 1;08.16; recorded January 15, 1983)'));
  assert.ok(!bothAges.chicago.includes('inferred'));

  const unagedWithDate = buildSessionCitations(unagedSession, {
    origin: SITE_ORIGIN,
    accessDate: ACCESS_DATE,
  });
  assert.equal(unagedWithDate.ageLabel, null);
  assert.equal(unagedWithDate.ageIsInferred, false);
  assert.ok(unagedWithDate.chicago.includes('"Session 011103" (recorded April 3, 1983).'));
  assert.ok(unagedWithDate.apa.includes('(1983, April 3). Session 011103 [Archived research transcript].'));
  assert.ok(unagedWithDate.bibtex.includes('note         = {Archived research transcript; recorded April 3, 1983; accessed November 27, 2026}'));

  const neither = buildSessionCitations(undatedUnagedSession, {
    origin: SITE_ORIGIN,
    accessDate: ACCESS_DATE,
  });
  assert.equal(neither.bibtexKey, 'sethtapes_011119d-82-supp');
  assert.ok(neither.chicago.includes('"Session 011119d-82-supp." Archived research transcript.'));
  assert.ok(neither.apa.includes('(n.d.). Session 011119d-82-supp [Archived research transcript].'));
  assert.ok(neither.bibtex.includes('note         = {Archived research transcript; accessed November 27, 2026}'));
});

test('handles multiple dates, bare years, and invalid calendar date strings without silently rolling over', () => {
  const sameYearMulti = buildSessionCitations(
    { ...archivedSession, dates: ['1983-01-15', '1983-01-16'] },
    { origin: SITE_ORIGIN, accessDate: ACCESS_DATE },
  );
  assert.ok(sameYearMulti.chicago.includes('recorded January 15, 1983 / January 16, 1983'));
  assert.ok(sameYearMulti.apa.includes('(1983, January 15 / 1983, January 16)'));
  assert.ok(sameYearMulti.bibtex.includes('  year         = {1983},'));
  assert.ok(!sameYearMulti.bibtex.includes('  month        ='));

  const crossYearMulti = buildSessionCitations(
    { ...archivedSession, dates: ['1983-12-30', '1984-01-02'] },
    { origin: SITE_ORIGIN, accessDate: ACCESS_DATE },
  );
  assert.ok(!crossYearMulti.bibtex.includes('  year         ='));

  const bareYear = buildSessionCitations(
    { ...archivedSession, dates: ['1983'] },
    { origin: SITE_ORIGIN, accessDate: ACCESS_DATE },
  );
  assert.ok(bareYear.apa.includes('(1983).'));
  assert.ok(bareYear.bibtex.includes('  year         = {1983},'));
  assert.ok(!bareYear.bibtex.includes('  month        ='));

  // Feb 30 is not a valid ISO calendar date — keep verbatim instead of rolling over to March 2
  const invalidIsoDate = buildSessionCitations(
    { ...archivedSession, dates: ['1983-02-30'] },
    { origin: SITE_ORIGIN, accessDate: ACCESS_DATE },
  );
  assert.ok(invalidIsoDate.chicago.includes('recorded 1983-02-30'));
  assert.ok(!invalidIsoDate.chicago.includes('March'));
});

test('escapeBibtexValue and BibTeX generation escape LaTeX/BibTeX special characters and unmatched braces safely without altering brace depth', () => {
  assert.equal(
    escapeBibtexValue('a\\b {c} & % $ # _ ^ ~'),
    'a\\textbackslash{}b \\textbraceleft{}c\\textbraceright{} \\& \\% \\$ \\# \\_ \\textasciicircum{} \\textasciitilde{}',
  );
  assert.equal(escapeBibtexValue('line 1\n\tline 2\r\nline 3'), 'line 1 line 2 line 3');

  // Unmatched opening and closing braces must preserve balanced BibTeX brace depth independently
  const assertBalancedBraces = (bibtex: string) => {
    let depth = 0;
    for (const ch of bibtex) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      assert.ok(depth >= 0, `Negative brace depth in BibTeX:\n${bibtex}`);
    }
    assert.equal(depth, 0, `Unbalanced final brace depth (${depth}) in BibTeX:\n${bibtex}`);
  };

  const unmatchedOpen = buildSessionCitations(
    { ...archivedSession, ages: ['1;06{26'] },
    { origin: SITE_ORIGIN, accessDate: ACCESS_DATE },
  );
  assert.ok(unmatchedOpen.bibtex.includes('age 1;06\\textbraceleft{}26'));
  assertBalancedBraces(unmatchedOpen.bibtex);

  const unmatchedClose = buildSessionCitations(
    { ...archivedSession, ages: ['1;06}26'] },
    { origin: SITE_ORIGIN, accessDate: ACCESS_DATE },
  );
  assert.ok(unmatchedClose.bibtex.includes('age 1;06\\textbraceright{}26'));
  assertBalancedBraces(unmatchedClose.bibtex);

  const tricky = buildSessionCitations(
    {
      slug: '01_06&26%test',
      ages: ['1;06.26_a'],
      inferredAge: null,
      dates: ['Summer & Fall {1983}'],
      origin: 'archived_research',
    },
    { passageNumber: 7, origin: SITE_ORIGIN, accessDate: ACCESS_DATE },
  );
  assert.equal(tricky.bibtexKey, 'sethtapes_01-06-26-test_p7');
  assert.ok(tricky.bibtex.includes('title        = {{Session 01\\_06\\&26\\%test, passage 7}},'));
  assert.ok(tricky.bibtex.includes('age 1;06.26\\_a; recorded Summer \\& Fall \\textbraceleft{}1983\\textbraceright{};'));
  assertBalancedBraces(tricky.bibtex);
});

test('URL builder, BibTeX key collision freedom, and validation handle origins and reject invalid slugs cleanly', () => {
  assert.equal(formatCanonicalCitationUrl('010815'), '/sessions/010815');
  assert.equal(formatCanonicalCitationUrl('010815', 42), '/sessions/010815#p42');
  assert.equal(
    formatCanonicalCitationUrl('010815', 42, 'https://thesethtapes.example/some/path?ignored=1'),
    'https://thesethtapes.example/sessions/010815#p42',
  );
  // Reject non-HTTP(S) origins cleanly by falling back to root-relative path
  assert.equal(formatCanonicalCitationUrl('010815', 3, 'javascript:alert(1)'), '/sessions/010815#p3');
  assert.equal(formatCanonicalCitationUrl('010815', 3, 'not a url'), '/sessions/010815#p3');

  // Dot-segment slugs must be rejected so URL resolution never escapes /sessions/
  for (const dotSlug of ['.', '..', ' . ', ' .. ']) {
    assert.throws(
      () => formatCanonicalCitationUrl(dotSlug, 2, 'https://example.org'),
      RangeError,
      `Expected RangeError for dot slug "${dotSlug}"`,
    );
    assert.throws(
      () => buildSessionCitations({ ...archivedSession, slug: dotSlug }, { accessDate: ACCESS_DATE }),
      RangeError,
      `Expected RangeError for dot slug "${dotSlug}"`,
    );
  }

  // Session slug ending in -p42 must NEVER collide with passage 42 of session 010626
  assert.equal(formatBibtexKey('010626'), 'sethtapes_010626');
  assert.equal(formatBibtexKey('010626', 42), 'sethtapes_010626_p42');
  assert.equal(formatBibtexKey('010626-p42'), 'sethtapes_010626-p42');
  assert.notEqual(formatBibtexKey('010626-p42'), formatBibtexKey('010626', 42));
  assert.notEqual(formatBibtexKey('010626_p42'), formatBibtexKey('010626', 42));
  assert.equal(formatBibtexKey('---'), 'sethtapes_session');

  // Negative boundary tests for invalid slugs, passage numbers, and access dates
  assert.throws(() => buildSessionCitations({ ...archivedSession, slug: '   ' }), RangeError);
  for (const badPassage of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => buildSessionCitations(archivedSession, { passageNumber: badPassage, accessDate: ACCESS_DATE }),
      RangeError,
      `Expected RangeError for passageNumber=${String(badPassage)}`,
    );
  }
  for (const badDate of ['2026-02-30', '2026-13-01', 'not-a-date', new Date('invalid')]) {
    assert.throws(
      () => buildSessionCitations(archivedSession, { accessDate: badDate }),
      RangeError,
      `Expected RangeError for accessDate=${String(badDate)}`,
    );
  }

  assert.match(formatLocalCalendarDateIso(new Date(2026, 10, 27)), /^2026-11-27$/);
  assert.throws(() => formatLocalCalendarDateIso(new Date('invalid')), RangeError);
});
