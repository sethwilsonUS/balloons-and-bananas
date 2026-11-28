import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSessionsUrl,
  countSessionsByOrigin,
  filterBrowseSessions,
  formatSessionsBrowseStatus,
  groupSessionsByAgeYear,
  isTranscriptOrigin,
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

test('groupSessionsByAgeYear sorts youngest-first across source and inferred ages and puts unrecorded last', () => {
  assert.deepEqual(groupSessionsByAgeYear([]), []);

  const input = [
    mockBrowseItem('unaged-b', { sourceName: 'notes-b.cha', ages: [], inferredAge: null }),
    mockBrowseItem('age3', { sourceName: '030410.json', ages: [], inferredAge: '3;04.10' }),
    mockBrowseItem('age1-late', { sourceName: '011119b.cha', ages: ['1;11.19'], inferredAge: null }),
    mockBrowseItem('age0', { sourceName: '001005.cha', ages: ['0;10.05'], inferredAge: null }),
    mockBrowseItem('age2-inferred', { sourceName: '020604.json', ages: [], inferredAge: '2;06.04' }),
    mockBrowseItem('age1-early', { sourceName: '010815.cha', ages: ['1;08.15'], inferredAge: null }),
    mockBrowseItem('age2-source', { sourceName: '020110.cha', ages: ['2;01.10'], inferredAge: null }),
    mockBrowseItem('unaged-a', { sourceName: 'notes-a.cha', ages: ['malformed'], inferredAge: null }),
    mockBrowseItem('age1-tie-a', { sourceName: '011119a.json', ages: [], inferredAge: '1;11.19' }),
  ];

  const snapshot = input.map(item => item.id);
  const groups = groupSessionsByAgeYear(input);
  // Must not mutate caller input array.
  assert.deepEqual(input.map(item => item.id), snapshot);

  assert.deepEqual(
    groups.map(group => ({
      key: group.key,
      year: group.year,
      label: group.label,
      startIndex: group.startIndex,
      ids: group.sessions.map(session => session.id),
    })),
    [
      { key: 'age-0', year: 0, label: 'Under age 1', startIndex: 1, ids: ['age0'] },
      { key: 'age-1', year: 1, label: 'Age 1', startIndex: 2, ids: ['age1-early', 'age1-tie-a', 'age1-late'] },
      { key: 'age-2', year: 2, label: 'Age 2', startIndex: 5, ids: ['age2-source', 'age2-inferred'] },
      { key: 'age-3', year: 3, label: 'Age 3', startIndex: 7, ids: ['age3'] },
      { key: 'age-unrecorded', year: null, label: 'Age not recorded', startIndex: 8, ids: ['unaged-a', 'unaged-b'] },
    ],
  );
});

test('filterBrowseSessions, countSessionsByOrigin, buildSessionsUrl, and formatSessionsBrowseStatus work across edge cases', () => {
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

  assert.equal(buildSessionsUrl(''), '/sessions');
  assert.equal(buildSessionsUrl('archived_research'), '/sessions?origin=archived_research');

  assert.equal(
    formatSessionsBrowseStatus(4, 4, 3, ''),
    'Showing all 4 sessions across 3 age groups, youngest first',
  );
  assert.equal(
    formatSessionsBrowseStatus(1, 4, 1, 'local_ai_draft'),
    'Showing 1 of 4 sessions (local AI draft) across 1 age group, youngest first',
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
