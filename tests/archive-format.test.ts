import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { buildCatalog, parseStoredArchiveData, type StoredSession } from '../src/lib/archive-format';

function validStoredSession(overrides: Partial<Record<keyof StoredSession, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'fixture-valid',
    sourceName: '010815.cha',
    title: 'Valid synthetic session',
    overview: 'Synthetic overview.',
    origin: 'archived_research',
    topics: ['Play and imagination'],
    dates: ['1983-01-15'],
    ages: ['1;08.15'],
    audio: [],
    preferredAudioId: null,
    sources: [],
    moments: [],
    limits: [],
    transcript: [],
    sourceSha256: '0'.repeat(64),
    association: 'Synthetic fixture.',
    ...overrides,
  };
}

test('parseStoredArchiveData maps unchanged stored archive.json v1 keys into glossary domain objects', async () => {
  const raw = JSON.parse(await readFile(path.resolve('tests/fixtures/archive.json'), 'utf8')) as Record<string, unknown>;

  // Stored JSON retains legacy storage keys (`entries`, `audio`, `preferredAudioId`).
  assert.ok(Array.isArray(raw.entries));
  assert.equal('sessions' in raw, false);

  const data = parseStoredArchiveData(raw);
  assert.equal(data.version, 1);
  assert.equal(data.sessions.length, (raw.entries as unknown[]).length);

  const submarine = data.sessions.find(session => session.id === 'fixture-020110-submarine');
  assert.ok(submarine);
  assert.equal(submarine.recordings.length, 2);
  assert.equal(submarine.preferredRecordingId, 'fixture-audio-submarine-mp3');
  assert.equal('audio' in (submarine as unknown as Record<string, unknown>), false);
  assert.equal('preferredAudioId' in (submarine as unknown as Record<string, unknown>), false);

  const summary = buildCatalog(data);
  assert.deepEqual(summary.counts, {
    sessions: 4,
    recordings: 3,
    moments: 6,
    original: 2,
    talkbankAi: 1,
    localAi: 1,
  });
});

test('parseStoredArchiveData rejects malformed stored payloads and incomplete session entries', () => {
  const wrap = (entries: unknown[]) => ({ version: 1, generatedAt: '', entries, documents: [], assets: {} });

  for (const invalid of [
    null,
    [],
    {},
    { version: 2, generatedAt: '', entries: [], documents: [], assets: {} },
    { version: 1, generatedAt: '', entries: 'not-array', documents: [], assets: {} },
    wrap([{ id: 'bad-session' }]),
    // Arrays present, but missing required fields like topics/title/origin/etc.
    wrap([{ id: 'incomplete-session', audio: [], transcript: [], moments: [] }]),
    wrap([validStoredSession({ topics: undefined })]),
    wrap([validStoredSession({ topics: [123] })]),
    wrap([validStoredSession({ origin: 'unknown_origin' })]),
    wrap([validStoredSession({ preferredAudioId: 42 })]),
    wrap([validStoredSession({ sources: null })]),
    wrap([validStoredSession({ sourceSha256: undefined })]),
    { version: 1, generatedAt: '', entries: [], documents: [], assets: null },
  ]) {
    assert.throws(() => parseStoredArchiveData(invalid), /Archive format mismatch/);
  }
});
