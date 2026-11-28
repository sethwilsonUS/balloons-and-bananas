import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ageBandForParsedAge,
  buildSessionsUrl,
  computeBandBarPercent,
  countSessionsByOrigin,
  filterBrowseSessions,
  formatSessionsBrowseStatus,
  groupSessionsByAgeBand,
  isTranscriptOrigin,
  parseAgeBandHash,
  parseOriginParam,
  parseStoredView,
  toSessionBrowseItem,
  VIEW_STORAGE_KEY,
  type SessionBrowseItem,
} from '../src/lib/sessions-browse';
import type { Session } from '../src/lib/types';

function mockSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    slug: id,
    legacyId: id,
    sourceName: `${id}.cha`,
    title: `Session ${id}`,
    overview: 'Synthetic browse overview.',
    origin: 'archived_research',
    topics: ['Play and imagination'],
    dates: [],
    ages: [],
    inferredAge: null,
    recordings: [],
    preferredRecordingId: null,
    sources: [{ id: 'src-1', name: `${id}.cha`, format: 'cha', label: 'CHAT' }],
    moments: [{ title: 'Moment 1', description: 'Synthetic moment.', start: 1, end: 5, locator: 'Line 1' }],
    limits: ['Synthetic limit.'],
    transcript: [{ text: 'Private transcript line that must stay off browse cards.', start: 0, end: 3 }],
    sourceSha256: 'abc123',
    association: 'Synthetic association.',
    ...overrides,
  };
}

function mockBrowseItem(id: string, overrides: Partial<SessionBrowseItem> = {}): SessionBrowseItem {
  return {
    id,
    slug: id,
    sourceName: `${id}.cha`,
    title: `Session ${id}`,
    overview: 'Synthetic browse overview.',
    origin: 'archived_research',
    topics: [],
    dates: [],
    ages: [],
    inferredAge: null,
    audioStatus: 'none',
    ...overrides,
  };
}

test('VIEW_STORAGE_KEY preserves the existing Details/List preference storage key', () => {
  assert.equal(VIEW_STORAGE_KEY, 'balloons-and-bananas:recordings-view');
});

test('parseOriginParam and isTranscriptOrigin validate transcript origin filters strictly', () => {
  assert.equal(isTranscriptOrigin('archived_research'), true);
  assert.equal(isTranscriptOrigin('talkbank_ai_draft'), true);
  assert.equal(isTranscriptOrigin('local_ai_draft'), true);
  assert.equal(isTranscriptOrigin(''), false);
  assert.equal(isTranscriptOrigin('unknown_origin'), false);
  assert.equal(isTranscriptOrigin(null), false);

  assert.equal(parseOriginParam(undefined), '');
  assert.equal(parseOriginParam(''), '');
  assert.equal(parseOriginParam('archived_research'), 'archived_research');
  assert.equal(parseOriginParam(' talkbank_ai_draft '), 'talkbank_ai_draft');
  assert.equal(parseOriginParam(['local_ai_draft', 'archived_research']), 'local_ai_draft');
  assert.equal(parseOriginParam('bogus'), '');
  assert.equal(parseOriginParam(['bogus', 'archived_research']), '');
});

test('parseStoredView accepts only details or list', () => {
  assert.equal(parseStoredView('details'), 'details');
  assert.equal(parseStoredView('list'), 'list');
  assert.equal(parseStoredView('grid'), null);
  assert.equal(parseStoredView(''), null);
  assert.equal(parseStoredView(null), null);
});

test('toSessionBrowseItem projects lightweight browse fields and omits transcript and moment bodies', () => {
  const withMp3 = toSessionBrowseItem(mockSession('010815', {
    recordings: [{ id: 'a1', name: '010815.mp3', format: 'mp3', duration: 30, bytes: 1000, available: true }],
  }));
  assert.equal(withMp3.audioStatus, 'mp3');
  assert.equal('transcript' in withMp3, false);
  assert.equal('moments' in withMp3, false);
  assert.equal('sources' in withMp3, false);

  const wavOnly = toSessionBrowseItem(mockSession('020110', {
    recordings: [{ id: 'a2', name: '020110.wav', format: 'wav', duration: 30, bytes: 1000, available: true }],
  }));
  assert.equal(wavOnly.audioStatus, 'no-mp3');

  const noAudio = toSessionBrowseItem(mockSession('011103', { recordings: [] }));
  assert.equal(noAudio.audioStatus, 'none');
});

test('ageBandForParsedAge maps boundary months, under-1 ages, year-only ages, oldest bands, and invalid/null ages', () => {
  assert.deepEqual(ageBandForParsedAge({ years: 0, months: 0, days: 0 }), {
    key: 'age-0-0',
    label: '0;0\u20130;5',
    proseRange: '0 to 5 months',
    startMonths: 0,
    endMonths: 5,
  });
  assert.deepEqual(ageBandForParsedAge({ years: 0, months: 5, days: 31 }), {
    key: 'age-0-0',
    label: '0;0\u20130;5',
    proseRange: '0 to 5 months',
    startMonths: 0,
    endMonths: 5,
  });
  assert.deepEqual(ageBandForParsedAge({ years: 0, months: 6, days: 0 }), {
    key: 'age-0-6',
    label: '0;6\u20130;11',
    proseRange: '6 to 11 months',
    startMonths: 6,
    endMonths: 11,
  });
  assert.deepEqual(ageBandForParsedAge({ years: 0, months: 11, days: 31 }), {
    key: 'age-0-6',
    label: '0;6\u20130;11',
    proseRange: '6 to 11 months',
    startMonths: 6,
    endMonths: 11,
  });

  assert.deepEqual(ageBandForParsedAge({ years: 1, months: 0, days: 0 }), {
    key: 'age-1-0',
    label: '1;0\u20131;5',
    proseRange: '1 year, 0 to 5 months',
    startMonths: 12,
    endMonths: 17,
  });
  assert.deepEqual(ageBandForParsedAge({ years: 1, months: 5, days: 31 }), {
    key: 'age-1-0',
    label: '1;0\u20131;5',
    proseRange: '1 year, 0 to 5 months',
    startMonths: 12,
    endMonths: 17,
  });
  assert.deepEqual(ageBandForParsedAge({ years: 1, months: 6, days: 0 }), {
    key: 'age-1-6',
    label: '1;6\u20131;11',
    proseRange: '1 year, 6 to 11 months',
    startMonths: 18,
    endMonths: 23,
  });
  assert.deepEqual(ageBandForParsedAge({ years: 1, months: 11, days: 31 }), {
    key: 'age-1-6',
    label: '1;6\u20131;11',
    proseRange: '1 year, 6 to 11 months',
    startMonths: 18,
    endMonths: 23,
  });

  assert.deepEqual(ageBandForParsedAge({ years: 2, months: 0, days: 1 }), {
    key: 'age-2-0',
    label: '2;0\u20132;5',
    proseRange: '2 years, 0 to 5 months',
    startMonths: 24,
    endMonths: 29,
  });
  assert.deepEqual(ageBandForParsedAge({ years: 2, months: 6, days: 4 }), {
    key: 'age-2-6',
    label: '2;6\u20132;11',
    proseRange: '2 years, 6 to 11 months',
    startMonths: 30,
    endMonths: 35,
  });
  assert.deepEqual(ageBandForParsedAge({ years: 4, months: 7, days: 2 }), {
    key: 'age-4-6',
    label: '4;6\u20134;11',
    proseRange: '4 years, 6 to 11 months',
    startMonths: 54,
    endMonths: 59,
  });
  // Year-only precision maps to the start of that year's first band without inventing months in display.
  assert.deepEqual(ageBandForParsedAge({ years: 2 }), {
    key: 'age-2-0',
    label: '2;0\u20132;5',
    proseRange: '2 years, 0 to 5 months',
    startMonths: 24,
    endMonths: 29,
  });

  const unknown = {
    key: 'age-unknown',
    label: 'Age unknown',
    proseRange: 'No source or filename-inferred age',
    startMonths: null,
    endMonths: null,
  };
  assert.deepEqual(ageBandForParsedAge(null), unknown);
  assert.deepEqual(ageBandForParsedAge({ years: -1, months: 0 }), unknown);
  assert.deepEqual(ageBandForParsedAge({ years: 1, months: 12 }), unknown);
  assert.deepEqual(ageBandForParsedAge({ years: 1, months: -1 }), unknown);
  assert.deepEqual(ageBandForParsedAge({ years: 1, months: 2.5 }), unknown);
});

test('groupSessionsByAgeBand sorts youngest-first into fixed six-month bands and puts Age unknown last', () => {
  assert.deepEqual(groupSessionsByAgeBand([]), []);

  // Single-item edge case
  const single = groupSessionsByAgeBand([
    mockBrowseItem('solo', { sourceName: '020110.cha', ages: ['2;01.10'] }),
  ]);
  assert.equal(single.length, 1);
  assert.equal(single[0].key, 'age-2-0');
  assert.equal(single[0].startIndex, 1);

  const input = [
    mockBrowseItem('unaged-b', { sourceName: 'notes-b.cha', ages: [], inferredAge: null }),
    mockBrowseItem('age4-oldest', { sourceName: '040812.json', ages: [], inferredAge: '4;08.12' }),
    mockBrowseItem('age1-11-late', { sourceName: '011119b.cha', ages: ['1;11.19'], inferredAge: null }),
    mockBrowseItem('age0-under-half', { sourceName: '000412.cha', ages: ['0;04.12'], inferredAge: null }),
    mockBrowseItem('age0-late', { sourceName: '001005.cha', ages: ['0;10.05'], inferredAge: null }),
    mockBrowseItem('age1-05-edge', { sourceName: '010531.cha', ages: ['1;05.31'], inferredAge: null }),
    mockBrowseItem('age1-06-edge', { sourceName: '010600.json', ages: [], inferredAge: '1;06.00' }),
    mockBrowseItem('age2-06-inferred', { sourceName: '020604.json', ages: [], inferredAge: '2;06.04' }),
    mockBrowseItem('age1-00-edge', { sourceName: '010000.cha', ages: ['1;00.00'], inferredAge: null }),
    mockBrowseItem('age2-year-only', { sourceName: '02year.cha', ages: ['2;'], inferredAge: null }),
    mockBrowseItem('age2-01-source', { sourceName: '020110.cha', ages: ['2;01.10'], inferredAge: null }),
    mockBrowseItem('unaged-a', { sourceName: 'notes-a.cha', ages: ['malformed'], inferredAge: null }),
    mockBrowseItem('age1-11-tie-a', { sourceName: '011119a.json', ages: [], inferredAge: '1;11.19' }),
  ];

  const snapshot = input.map(item => item.id);
  const bands = groupSessionsByAgeBand(input);
  // Must not mutate caller input array.
  assert.deepEqual(input.map(item => item.id), snapshot);

  assert.deepEqual(
    bands.map(band => ({
      key: band.key,
      label: band.label,
      startMonths: band.startMonths,
      endMonths: band.endMonths,
      startIndex: band.startIndex,
      ids: band.sessions.map(session => session.id),
    })),
    [
      {
        key: 'age-0-0',
        label: '0;0\u20130;5',
        startMonths: 0,
        endMonths: 5,
        startIndex: 1,
        ids: ['age0-under-half'],
      },
      {
        key: 'age-0-6',
        label: '0;6\u20130;11',
        startMonths: 6,
        endMonths: 11,
        startIndex: 2,
        ids: ['age0-late'],
      },
      {
        key: 'age-1-0',
        label: '1;0\u20131;5',
        startMonths: 12,
        endMonths: 17,
        startIndex: 3,
        ids: ['age1-00-edge', 'age1-05-edge'],
      },
      {
        key: 'age-1-6',
        label: '1;6\u20131;11',
        startMonths: 18,
        endMonths: 23,
        startIndex: 5,
        ids: ['age1-06-edge', 'age1-11-tie-a', 'age1-11-late'],
      },
      {
        key: 'age-2-0',
        label: '2;0\u20132;5',
        startMonths: 24,
        endMonths: 29,
        startIndex: 8,
        ids: ['age2-year-only', 'age2-01-source'],
      },
      {
        key: 'age-2-6',
        label: '2;6\u20132;11',
        startMonths: 30,
        endMonths: 35,
        startIndex: 10,
        ids: ['age2-06-inferred'],
      },
      {
        key: 'age-4-6',
        label: '4;6\u20134;11',
        startMonths: 54,
        endMonths: 59,
        startIndex: 11,
        ids: ['age4-oldest'],
      },
      {
        key: 'age-unknown',
        label: 'Age unknown',
        startMonths: null,
        endMonths: null,
        startIndex: 12,
        ids: ['unaged-a', 'unaged-b'],
      },
    ],
  );
});

test('groupSessionsByAgeBand maintains continuous startIndex across odd and varied band counts (0, 1, 2, 3, 5, 7, 9)', () => {
  const countsToCheck = [0, 1, 2, 3, 5, 7, 9];
  for (const bandCount of countsToCheck) {
    const items: SessionBrowseItem[] = [];
    for (let i = 0; i < bandCount; i += 1) {
      const years = Math.floor(i / 2);
      const months = (i % 2) * 6 + 1;
      const chat = `${years};${String(months).padStart(2, '0')}.05`;
      items.push(mockBrowseItem(`s-${i}`, { sourceName: `${years}${months}.cha`, ages: [chat] }));
    }
    const grouped = groupSessionsByAgeBand(items);
    assert.equal(grouped.length, bandCount);
    let expectedIndex = 1;
    for (const band of grouped) {
      assert.equal(band.startIndex, expectedIndex);
      expectedIndex += band.sessions.length;
    }
  }
});

test('parseAgeBandHash, buildSessionsUrl, and computeBandBarPercent validate inputs and handle edge cases', () => {
  assert.equal(parseAgeBandHash('#age-1-0'), 'age-1-0');
  assert.equal(parseAgeBandHash('age-2-6'), 'age-2-6');
  assert.equal(parseAgeBandHash(' #age-10-0 '), 'age-10-0');
  assert.equal(parseAgeBandHash('#age-unknown'), 'age-unknown');

  for (const invalid of [
    '',
    '#',
    '#age-2',
    '#age-2-3',
    '#age-2-12',
    '#age-unrecorded',
    '#access=secret',
    '#//evil.example',
    null,
    undefined,
  ]) {
    assert.equal(parseAgeBandHash(invalid), '', `Expected invalid hash ${JSON.stringify(invalid)} to be rejected`);
  }

  assert.equal(buildSessionsUrl(''), '/sessions');
  assert.equal(buildSessionsUrl('archived_research'), '/sessions?origin=archived_research');
  assert.equal(buildSessionsUrl('', 'age-2-0'), '/sessions#age-2-0');
  assert.equal(buildSessionsUrl('local_ai_draft', '#age-2-6'), '/sessions?origin=local_ai_draft#age-2-6');
  assert.equal(buildSessionsUrl('local_ai_draft', '#access=obsolete'), '/sessions?origin=local_ai_draft');
  assert.equal(buildSessionsUrl('', 'age-2-3'), '/sessions');

  assert.equal(computeBandBarPercent(0, 10), 0);
  assert.equal(computeBandBarPercent(5, 0), 0);
  assert.equal(computeBandBarPercent(-2, 10), 0);
  assert.equal(computeBandBarPercent(Number.NaN, 10), 0);
  assert.equal(computeBandBarPercent(1, 1), 100);
  assert.equal(computeBandBarPercent(1, 500), 8);
  assert.equal(computeBandBarPercent(25, 50), 50);
  assert.equal(computeBandBarPercent(80, 50), 100);
});

test('filterBrowseSessions, countSessionsByOrigin, and formatSessionsBrowseStatus work across edge cases', () => {
  const items = [
    mockBrowseItem('a', { origin: 'archived_research' }),
    mockBrowseItem('b', { origin: 'talkbank_ai_draft' }),
    mockBrowseItem('c', { origin: 'local_ai_draft' }),
    mockBrowseItem('d', { origin: 'archived_research' }),
  ];

  assert.deepEqual(countSessionsByOrigin(items), {
    archived_research: 2,
    talkbank_ai_draft: 1,
    local_ai_draft: 1,
  });

  assert.equal(filterBrowseSessions(items, '').length, 4);
  assert.deepEqual(filterBrowseSessions(items, 'archived_research').map(s => s.id), ['a', 'd']);
  assert.deepEqual(filterBrowseSessions(items, 'talkbank_ai_draft').map(s => s.id), ['b']);
  assert.deepEqual(filterBrowseSessions(items, 'local_ai_draft').map(s => s.id), ['c']);

  assert.equal(
    formatSessionsBrowseStatus(4, 4, 4, ''),
    'Showing all 4 sessions across 4 age bands, youngest first',
  );
  assert.equal(
    formatSessionsBrowseStatus(1, 4, 1, 'local_ai_draft'),
    'Showing 1 of 4 sessions (local AI draft) across 1 age band, youngest first',
  );
  assert.equal(
    formatSessionsBrowseStatus(0, 4, 0, 'talkbank_ai_draft'),
    '0 TalkBank AI draft sessions',
  );
  assert.equal(
    formatSessionsBrowseStatus(0, 0, 0, ''),
    '0 sessions in the collection',
  );
});
