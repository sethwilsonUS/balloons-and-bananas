import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SessionBody } from '../src/components/SessionDetail';
import {
  DEFAULT_BACK_TO_RESULTS_HREF,
  findNearestPassageIndex,
  formatAdjacentAgeSummary,
  formatCanonicalPassageUrl,
  formatTimeReadyAnnouncement,
  getAdjacentSessions,
  getBackToResultsHref,
  parseSessionHash,
  resolveBackToResultsUrl,
} from '../src/lib/session-reading';
import type { Passage, Session } from '../src/lib/types';

test('parseSessionHash parses #pN passage anchors and rejects invalid passage hashes', () => {
  assert.deepEqual(parseSessionHash('#p1'), { kind: 'passage', passage: 1 });
  assert.deepEqual(parseSessionHash('#p42'), { kind: 'passage', passage: 42 });
  assert.deepEqual(parseSessionHash('p108'), { kind: 'passage', passage: 108 });
  assert.deepEqual(parseSessionHash('#P7'), { kind: 'passage', passage: 7 });

  for (const invalid of ['', '#', '#p0', '#p-3', '#p1.5', '#p42abc', '#guide', '#moments', '#transcript', '#access=secret', '#p999999999999999999999']) {
    assert.equal(parseSessionHash(invalid), null, invalid);
  }
});

test('parseSessionHash parses #t=mm:ss, #t=hh:mm:ss, #t=seconds, and encoded colons, rejecting malformed timestamps', () => {
  assert.deepEqual(parseSessionHash('#t=0'), { kind: 'time', seconds: 0 });
  assert.deepEqual(parseSessionHash('#t=754'), { kind: 'time', seconds: 754 });
  assert.deepEqual(parseSessionHash('#t=12:34'), { kind: 'time', seconds: 754 });
  assert.deepEqual(parseSessionHash('#t=0:05'), { kind: 'time', seconds: 5 });
  assert.deepEqual(parseSessionHash('#t=00:00'), { kind: 'time', seconds: 0 });
  assert.deepEqual(parseSessionHash('#t=1:02:03'), { kind: 'time', seconds: 3723 });
  assert.deepEqual(parseSessionHash('#T=12%3A34'), { kind: 'time', seconds: 754 });
  assert.deepEqual(parseSessionHash('t=1%3A02%3A03'), { kind: 'time', seconds: 3723 });

  for (const invalid of ['#t=', '#t=abc', '#t=-5', '#t=12:60', '#t=1:60:00', '#t=1:2:3', '#t=1:02:60', '#t=12.5', '#t=1:2:3:4', '#t=%E0%A4%A']) {
    assert.equal(parseSessionHash(invalid), null, invalid);
  }
});

test('findNearestPassageIndex locates containing, boundary, gap, and untimed passages cleanly', () => {
  const timed: Passage[] = [
    { text: 'one', start: 0, end: 4 },
    { text: 'two', start: 4, end: 9 },
    { text: 'three', start: 9, end: 15 },
    { text: 'four', start: 20, end: 26 },
    { text: 'untimed tail', start: null, end: null },
  ];

  assert.deepEqual(findNearestPassageIndex(timed, 0), { index: 0, timed: true });
  assert.deepEqual(findNearestPassageIndex(timed, 2), { index: 0, timed: true });
  assert.deepEqual(findNearestPassageIndex(timed, 4), { index: 1, timed: true });
  assert.deepEqual(findNearestPassageIndex(timed, 9), { index: 2, timed: true });
  assert.deepEqual(findNearestPassageIndex(timed, 12), { index: 2, timed: true });
  // Inside gap [15, 20]: 16 is closer to passage 3 (end 15), 19 is closer to passage 4 (start 20)
  assert.deepEqual(findNearestPassageIndex(timed, 16), { index: 2, timed: true });
  assert.deepEqual(findNearestPassageIndex(timed, 19), { index: 3, timed: true });
  // Beyond last timed passage
  assert.deepEqual(findNearestPassageIndex(timed, 30), { index: 3, timed: true });

  // Untimed transcript falls back to index 0 with timed=false
  const untimed: Passage[] = [
    { text: 'first', start: null, end: null },
    { text: 'second', start: null, end: null },
  ];
  assert.deepEqual(findNearestPassageIndex(untimed, 12), { index: 0, timed: false });

  // Empty transcript or invalid time returns null
  assert.equal(findNearestPassageIndex([], 12), null);
  assert.equal(findNearestPassageIndex(timed, -1), null);
  assert.equal(findNearestPassageIndex(timed, Number.NaN), null);
});

test('formatTimeReadyAnnouncement uses spoken words matching accessibility copy', () => {
  assert.equal(
    formatTimeReadyAnnouncement(754, 'ready'),
    'Ready at 12 minutes 34 seconds. Press play to listen.',
  );
  assert.equal(
    formatTimeReadyAnnouncement(0, 'ready'),
    'Ready at 0 seconds. Press play to listen.',
  );
  assert.equal(
    formatTimeReadyAnnouncement(3723, 'ready'),
    'Ready at 1 hour 2 minutes 3 seconds. Press play to listen.',
  );
  assert.equal(
    formatTimeReadyAnnouncement(12, 'no-audio', { hasTimedPassage: true }),
    'No playable recording is available for this session. Showing the transcript near 12 seconds.',
  );
  assert.equal(
    formatTimeReadyAnnouncement(12, 'no-audio', { hasTimedPassage: false }),
    'No playable recording is available for this session. Showing the transcript below.',
  );
  assert.equal(
    formatTimeReadyAnnouncement(754, 'out-of-range', { duration: 36 }),
    '12 minutes 34 seconds is beyond this recording’s duration (36 seconds). Showing the nearest transcript passage.',
  );
});

test('getAdjacentSessions follows canonical age order (source-or-inferred, ties by stem, unaged last)', () => {
  const sessions = [
    { id: 's-unaged-b', slug: 'unaged-b', sourceName: 'z-unaged.cha', ages: [], inferredAge: null },
    { id: 's-tie-b', slug: '020110b', sourceName: '020110b.json', ages: [], inferredAge: '2;01.10' },
    { id: 's-older', slug: '020604-local', sourceName: '020604-local.json', ages: [], inferredAge: '2;06.04' },
    { id: 's-young', slug: '010815', sourceName: '010815.cha', ages: ['1;08.15'], inferredAge: null },
    { id: 's-unaged-a', slug: 'unaged-a', sourceName: 'a-unaged.cha', ages: [], inferredAge: null },
    { id: 's-tie-a', slug: '020110a', sourceName: '020110a.cha', ages: ['2;01.10'], inferredAge: null },
  ];

  // Expected order: 010815 -> 020110a -> 020110b -> 020604-local -> unaged-a -> unaged-b
  const first = getAdjacentSessions(sessions, '010815');
  assert.equal(first.previous, null);
  assert.equal(first.next?.slug, '020110a');

  const tieA = getAdjacentSessions(sessions, '020110a');
  assert.equal(tieA.previous?.slug, '010815');
  assert.equal(tieA.next?.slug, '020110b');

  const tieB = getAdjacentSessions(sessions, '020110b');
  assert.equal(tieB.previous?.slug, '020110a');
  assert.equal(tieB.next?.slug, '020604-local');

  const older = getAdjacentSessions(sessions, '020604-local');
  assert.equal(older.previous?.slug, '020110b');
  assert.equal(older.next?.slug, 'unaged-a');

  const last = getAdjacentSessions(sessions, 'unaged-b');
  assert.equal(last.previous?.slug, 'unaged-a');
  assert.equal(last.next, null);

  assert.deepEqual(getAdjacentSessions(sessions, 'missing'), { previous: null, next: null });
});

test('formatAdjacentAgeSummary distinguishes source age, inferred age, and unaged sessions', () => {
  assert.deepEqual(
    formatAdjacentAgeSummary({ ages: ['1;08.15'], inferredAge: null }),
    { text: '1 year, 8 months, 15 days (1;08.15)', inferred: false },
  );
  assert.deepEqual(
    formatAdjacentAgeSummary({ ages: [], inferredAge: '2;06.04' }),
    { text: '2 years, 6 months, 4 days (2;06.04, inferred from filename)', inferred: true },
  );
  assert.deepEqual(
    formatAdjacentAgeSummary({ ages: [], inferredAge: null }),
    { text: 'age not recorded', inferred: false },
  );
});

test('resolveBackToResultsUrl and getBackToResultsHref accept safe same-origin search/browse URLs and fall back to /sessions', () => {
  const origin = 'https://archive.example';

  assert.equal(
    resolveBackToResultsUrl('/search?q=locomotive&sort=relevance', origin),
    '/search?q=locomotive&sort=relevance',
  );
  assert.equal(
    resolveBackToResultsUrl('https://archive.example/search?topic=Play#access=old', origin),
    '/search?topic=Play',
  );
  assert.equal(
    resolveBackToResultsUrl('/sessions?origin=archived_research', origin),
    '/sessions?origin=archived_research',
  );
  assert.equal(
    resolveBackToResultsUrl('/?section=sessions', origin),
    '/?section=sessions',
  );
  assert.equal(
    resolveBackToResultsUrl('/?marker=repetition&speaker=child', origin),
    '/?marker=repetition&speaker=child',
  );

  // Reject unsafe, cross-origin, or non-results URLs
  for (const rejected of [
    '',
    '/',
    '/sessions/010815',
    '/research/methods',
    'https://evil.example/search?q=test',
    '//evil.example/search',
    'javascript:alert(1)',
    '/search\nSet-Cookie: bad=1',
  ]) {
    assert.equal(resolveBackToResultsUrl(rejected, origin), null, rejected);
  }

  assert.equal(
    getBackToResultsHref(['https://evil.example/search', '/search?q=bridge'], origin),
    '/search?q=bridge',
  );
  assert.equal(
    getBackToResultsHref([null, undefined, 'https://evil.example/search'], origin),
    DEFAULT_BACK_TO_RESULTS_HREF,
  );
});

test('formatCanonicalPassageUrl builds clean canonical /sessions/<slug>#p<N> URLs', () => {
  assert.equal(
    formatCanonicalPassageUrl('010815', 42, 'https://archive.example'),
    'https://archive.example/sessions/010815#p42',
  );
  assert.equal(
    formatCanonicalPassageUrl('011119d-82-supp', 3, 'http://127.0.0.1:3103'),
    'http://127.0.0.1:3103/sessions/011119d-82-supp#p3',
  );
});

test('SessionBody renders all 135 passages without a 100-passage cap or Show more button', () => {
  const longSession: Session = {
    id: 'fixture-long-reading',
    slug: '010901-long',
    legacyId: 'fixture-long-reading',
    sourceName: '010901-long.cha',
    title: 'Synthetic long reading session',
    overview: 'Synthetic 135-passage session verifying removal of the 100-passage cap.',
    origin: 'archived_research',
    topics: ['Play and imagination'],
    dates: [],
    ages: ['1;09.01'],
    inferredAge: null,
    recordings: [],
    preferredRecordingId: null,
    sources: [],
    moments: [],
    limits: [],
    transcript: Array.from({ length: 135 }, (_, idx) => ({
      speaker: idx % 2 === 0 ? 'Child (CHI, target child)' : 'Parent (FAT, father)',
      text: idx === 134
        ? 'synthetic final utterance with windmill lantern token'
        : `synthetic utterance number ${idx + 1} for scroll responsiveness check`,
      start: idx * 6,
      end: idx * 6 + 5,
    })),
    sourceSha256: '0'.repeat(64),
    association: 'Synthetic fixture',
  };

  const html = renderToStaticMarkup(
    React.createElement(SessionBody, {
      session: longSession,
      headingLevel: 2,
      momentsBeforePlayer: true,
      enableHashNavigation: true,
    }),
  );

  const lineMatches = html.match(/class="transcript-line"/g) ?? [];
  assert.equal(lineMatches.length, 135);
  assert.match(html, /id="p1"/);
  assert.match(html, /id="p135"/);
  assert.match(html, /windmill lantern token/);
  assert.doesNotMatch(html, /Show \d+ more passages/i);
});
