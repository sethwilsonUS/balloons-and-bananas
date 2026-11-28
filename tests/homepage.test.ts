import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countAvailableCuratedThemes,
  formatBrowseByAgeDescription,
  formatCount,
  summarizeHomepageAgeSpan,
} from '../src/lib/homepage';

test('formatCount handles zero, singular, and plural counts cleanly', () => {
  assert.equal(formatCount(0, 'session', 'sessions'), '0 sessions');
  assert.equal(formatCount(1, 'session', 'sessions'), '1 session');
  assert.equal(formatCount(4, 'session', 'sessions'), '4 sessions');
  assert.equal(formatCount(1, 'TalkBank AI draft', 'TalkBank AI drafts'), '1 TalkBank AI draft');
  assert.equal(formatCount(13, 'TalkBank AI draft', 'TalkBank AI drafts'), '13 TalkBank AI drafts');
});

test('summarizeHomepageAgeSpan computes source, inferred, and mixed spans without inventing precision', () => {
  // Empty and unaged-only collections return null
  assert.equal(summarizeHomepageAgeSpan([]), null);
  assert.equal(
    summarizeHomepageAgeSpan([{ ages: [], inferredAge: null }, { ages: ['invalid'], inferredAge: 'bad' }]),
    null,
  );
  assert.equal(
    formatBrowseByAgeDescription(null),
    'Walk through every session youngest-first, grouped by age and filterable by transcript origin.',
  );

  // Mixed source + inferred ages (matching fixture structure)
  const mixed = summarizeHomepageAgeSpan([
    { ages: ['1;08.15'], inferredAge: null },
    { ages: ['2;01.10'], inferredAge: null },
    { ages: [], inferredAge: '2;06.04' },
    { ages: [], inferredAge: null },
  ]);
  assert.ok(mixed);
  assert.equal(mixed.ageKind, 'mixed');
  assert.equal(mixed.isSingleAge, false);
  assert.equal(mixed.minLabel, '1 year, 8 months');
  assert.equal(mixed.maxLabel, '2 years, 6 months');
  assert.equal(
    formatBrowseByAgeDescription(mixed),
    'Walk through every session youngest-first across source and filename-inferred ages (1 year, 8 months to 2 years, 6 months), filterable by transcript origin.',
  );

  // Source-only collection where source age takes precedence over inferredAge on the same session
  const sourceOnly = summarizeHomepageAgeSpan([
    { ages: ['1;06.26'], inferredAge: '1;06.26' },
    { ages: ['3;00.00'], inferredAge: null },
  ]);
  assert.ok(sourceOnly);
  assert.equal(sourceOnly.ageKind, 'source');
  assert.equal(sourceOnly.minLabel, '1 year, 6 months');
  assert.equal(sourceOnly.maxLabel, '3 years, 0 months');
  assert.match(formatBrowseByAgeDescription(sourceOnly), /recorded source ages \(1 year, 6 months to 3 years, 0 months\)/);

  // Inferred-only collection (including invalid source age falling through to valid inferredAge)
  const inferredOnly = summarizeHomepageAgeSpan([
    { ages: ['not-an-age'], inferredAge: '1;09.02' },
    { ages: [], inferredAge: '2;04.18' },
  ]);
  assert.ok(inferredOnly);
  assert.equal(inferredOnly.ageKind, 'inferred');
  assert.equal(inferredOnly.minLabel, '1 year, 9 months');
  assert.equal(inferredOnly.maxLabel, '2 years, 4 months');
  assert.match(formatBrowseByAgeDescription(inferredOnly), /filename-inferred ages \(1 year, 9 months to 2 years, 4 months\)/);

  // Same year and month, different days: preserves day precision instead of collapsing identical labels
  const sameMonth = summarizeHomepageAgeSpan([
    { ages: ['1;08.05'], inferredAge: null },
    { ages: ['1;08.25'], inferredAge: null },
  ]);
  assert.ok(sameMonth);
  assert.equal(sameMonth.isSingleAge, false);
  assert.equal(sameMonth.minLabel, '1 year, 8 months, 5 days');
  assert.equal(sameMonth.maxLabel, '1 year, 8 months, 25 days');

  // Single age: avoids "X to X" duplication
  const single = summarizeHomepageAgeSpan([{ ages: ['1;08.15'], inferredAge: null }]);
  assert.ok(single);
  assert.equal(single.isSingleAge, true);
  assert.equal(single.minLabel, '1 year, 8 months, 15 days');
  assert.equal(
    formatBrowseByAgeDescription(single),
    'Walk through every session youngest-first (recorded source age: 1 year, 8 months, 15 days), filterable by transcript origin.',
  );

  // Year-only CHAT ages never invent months
  const yearOnly = summarizeHomepageAgeSpan([
    { ages: ['1;'], inferredAge: null },
    { ages: ['3;'], inferredAge: null },
  ]);
  assert.ok(yearOnly);
  assert.equal(yearOnly.minLabel, '1 year');
  assert.equal(yearOnly.maxLabel, '3 years');
});

test('countAvailableCuratedThemes counts only curated positive themes present in catalog topics', () => {
  assert.equal(countAvailableCuratedThemes([]), 0);
  assert.equal(
    countAvailableCuratedThemes([
      { name: 'Unlisted topic', count: 5 },
      { name: 'Play and imagination', count: 2 },
      { name: 'Learning and questions', count: 2 },
      { name: 'Play and imagination', count: 2 },
    ]),
    2,
  );
});
