import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareParsedAges,
  compareSessionsByAge,
  effectiveSessionAge,
  filenameStem,
  formatAge,
  inferAgeFromStem,
  parseChatAge,
} from '../src/lib/age';

test('CHAT ages become readable units with correct singular, plural and explicit zero fields', () => {
  assert.equal(formatAge('1;03.27'), '1 year, 3 months, 27 days');
  assert.equal(formatAge('1;01.01'), '1 year, 1 month, 1 day');
  assert.equal(formatAge('0;00.00'), '0 years, 0 months, 0 days');
  assert.equal(formatAge('2;00.00'), '2 years, 0 months, 0 days');
  assert.equal(formatAge('0;11.31'), '0 years, 11 months, 31 days');
  assert.equal(formatAge('01;3.7'), '1 year, 3 months, 7 days');
});

test('missing precision remains missing rather than being filled with zero', () => {
  assert.equal(formatAge('1;03'), '1 year, 3 months');
  assert.equal(formatAge('1;03.'), '1 year, 3 months');
  assert.equal(formatAge('1;'), '1 year');
  assert.equal(formatAge(' 2;01.03 '), '2 years, 1 month, 3 days');
  assert.equal(formatAge('1'), '1', 'A bare number is not assumed to be CHAT age notation');
});

test('unknown, malformed and out-of-range source values remain verbatim', () => {
  for (const age of ['', 'unknown', '?', '1;??.??', '1;03.?', '1;.27', '-1;03.27', '1;12.00', '1;03.32', '1;003.27', '1;03.027', '1;03.27 extra', '9007199254740992;00.00', '  unknown  ']) {
    assert.equal(formatAge(age), age);
    assert.equal(parseChatAge(age), null);
  }
});

test('inferAgeFromStem parses valid 6-digit stems with optional ASCII letter and rejects invalid stems', () => {
  assert.equal(inferAgeFromStem('010626'), '1;06.26');
  assert.equal(inferAgeFromStem('020319b'), '2;03.19');
  assert.equal(inferAgeFromStem('020319B'), '2;03.19');
  assert.equal(inferAgeFromStem('010600'), '1;06.00');
  assert.equal(inferAgeFromStem('000000'), '0;00.00');
  assert.equal(inferAgeFromStem('001131a'), '0;11.31');
  assert.equal(inferAgeFromStem('100005z'), '10;00.05');

  for (const invalid of [
    '',
    '01062',
    '0106260',
    '010626ab',
    '010626-b',
    '010626_a',
    '011201',
    '011201a',
    '010632',
    '010699',
    'notes',
    '010626\n',
    ' 010626',
    '010626 ',
    '010626é',
    '٠١٠٦٢٦',
  ]) {
    assert.equal(inferAgeFromStem(invalid), null, `Expected stem ${JSON.stringify(invalid)} to be rejected`);
  }
});

test('filenameStem strips directory prefixes and final file extension', () => {
  assert.equal(filenameStem('transcripts/010626.cha'), '010626');
  assert.equal(filenameStem('transcripts-ai/0extra/83/020319b.json'), '020319b');
  assert.equal(filenameStem('020319a.cha'), '020319a');
  assert.equal(filenameStem('plain-name'), 'plain-name');
});

test('compareParsedAges orders tuples numerically without month/day overflow distortion', () => {
  assert.ok(compareParsedAges(parseChatAge('1;01.31')!, parseChatAge('1;02.00')!) < 0);
  assert.ok(compareParsedAges(parseChatAge('1;11.31')!, parseChatAge('2;00.00')!) < 0);
  assert.ok(compareParsedAges(parseChatAge('2;00.00')!, parseChatAge('10;00.00')!) < 0);
  assert.ok(compareParsedAges(parseChatAge('1;03')!, parseChatAge('1;03.00')!) < 0);
  assert.equal(compareParsedAges(parseChatAge('2;03.19')!, parseChatAge('02;3.19')!), 0);
});

test('effectiveSessionAge prefers source age over inferredAge and keeps them distinct', () => {
  assert.deepEqual(
    effectiveSessionAge({ ages: ['1;06.26'], inferredAge: '3;00.00' }),
    { years: 1, months: 6, days: 26 },
  );
  assert.deepEqual(
    effectiveSessionAge({ ages: [], inferredAge: '2;03.19' }),
    { years: 2, months: 3, days: 19 },
  );
  assert.equal(effectiveSessionAge({ ages: [], inferredAge: null }), null);
  assert.deepEqual(effectiveSessionAge({ ages: ['unknown'], inferredAge: '2;03.19' }), { years: 2, months: 3, days: 19 });
});

test('compareSessionsByAge sorts by source-or-inferred age, breaks ties by filename stem, and puts no-age last', () => {
  const sessions = [
    { id: 'no-age-b', sourceName: 'transcripts/notes-b.cha', ages: [], inferredAge: null },
    { id: 'tie-b', sourceName: 'transcripts/020319b.cha', ages: ['2;03.19'], inferredAge: null },
    { id: 'inferred-young', sourceName: 'transcripts-ai/0extra/82/010904a.json', ages: [], inferredAge: '1;09.04' },
    { id: 'source-youngest', sourceName: 'transcripts/010626.cha', ages: ['1;06.26'], inferredAge: null },
    { id: 'tie-a', sourceName: 'transcripts-ai/0extra/83/020319a.json', ages: [], inferredAge: '2;03.19' },
    { id: 'same-stem-wav', sourceName: 'transcripts-ai/0wav/011119d.json', ages: [], inferredAge: '1;11.19' },
    { id: 'same-stem-supp', sourceName: 'transcripts-ai/0extra/82-supp/011119d.json', ages: [], inferredAge: '1;11.19' },
    { id: 'no-age-a', sourceName: 'transcripts-ai/notes-a.json', ages: [], inferredAge: null },
  ];

  const asc = [...sessions].sort((a, b) => compareSessionsByAge(a, b, 'asc')).map(s => s.id);
  assert.deepEqual(asc, [
    'source-youngest',
    'inferred-young',
    'same-stem-supp',
    'same-stem-wav',
    'tie-a',
    'tie-b',
    'no-age-a',
    'no-age-b',
  ]);

  const desc = [...sessions].sort((a, b) => compareSessionsByAge(a, b, 'desc')).map(s => s.id);
  assert.deepEqual(desc, [
    'tie-a',
    'tie-b',
    'same-stem-supp',
    'same-stem-wav',
    'inferred-young',
    'source-youngest',
    'no-age-a',
    'no-age-b',
  ]);
});
