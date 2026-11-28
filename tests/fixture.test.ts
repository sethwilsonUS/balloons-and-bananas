import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parseStoredArchiveData } from '../src/lib/archive-format';
import { makeLinguisticSearch } from '../src/lib/linguistic-search';
import { makeSearch } from '../src/lib/search';
import { getNotationLinks, readingText } from '../src/lib/transcript-display';

test('invented fixture archive is valid v1 stored archive covering all required scenarios and matching files on disk', async () => {
  const fixturePath = path.resolve('tests/fixtures/archive.json');
  const filesRoot = path.resolve('tests/fixtures/files');
  const raw = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, unknown>;
  assert.ok(Array.isArray(raw.entries) && raw.entries.length >= 4, 'Stored fixture keeps v1 entries key');

  const data = parseStoredArchiveData(raw);

  assert.equal(data.version, 1);
  assert.ok(typeof data.generatedAt === 'string' && data.generatedAt.length > 0);
  assert.ok(Array.isArray(data.sessions) && data.sessions.length >= 4);
  assert.ok(Array.isArray(data.documents) && data.documents.length >= 2);
  assert.ok(data.assets && typeof data.assets === 'object');

  // All three transcript origins present
  const origins = new Set(data.sessions.map(session => session.origin));
  assert.deepEqual(origins, new Set(['archived_research', 'talkbank_ai_draft', 'local_ai_draft']));

  // Sessions with and without a source age
  assert.ok(data.sessions.some(session => session.ages.length > 0), 'Expected a session with a source age');
  assert.ok(data.sessions.some(session => session.ages.length === 0), 'Expected a session without a source age');

  // Moments with and without times
  const moments = data.sessions.flatMap(session => session.moments);
  assert.ok(moments.some(moment => moment.start !== null), 'Expected a timed moment');
  assert.ok(moments.some(moment => moment.start === null), 'Expected an untimed moment');

  // Session with no recordings, and sessions with playable MP3 + downloadable WAV
  assert.ok(data.sessions.some(session => session.recordings.length === 0), 'Expected a session with no recordings');
  assert.ok(
    data.sessions.some(session => session.recordings.some(recording => recording.format === 'mp3' && recording.available)),
    'Expected a session with available MP3 playback',
  );
  assert.ok(
    data.sessions.some(session => session.recordings.some(recording => recording.kind === 'listening-copy')),
    'Expected an MP3 listening copy with provenance',
  );

  // CHAT notation and explicit CHI speaker labels
  const linguisticSearch = makeLinguisticSearch(data.sessions);
  assert.ok(linguisticSearch('repetition', 'child').size >= 1, 'Expected explicit CHI repetition CHAT notation');
  assert.ok(linguisticSearch('retracing', 'child').size >= 1, 'Expected explicit CHI retracing CHAT notation');
  assert.ok(linguisticSearch('pause', 'child').size >= 1, 'Expected explicit CHI pause CHAT notation');
  assert.ok(linguisticSearch('wh-question', 'child').size >= 1, 'Expected explicit CHI wh-question');

  const locomotive = data.sessions.find(session => session.id === 'fixture-010815-locomotive');
  assert.ok(locomotive && locomotive.transcript.length >= 3);
  const passage3 = locomotive.transcript[2];
  assert.ok(getNotationLinks(passage3, locomotive.origin).length > 0, 'Passage 3 should carry inspectable CHAT notation');
  assert.notEqual(readingText(passage3, locomotive.origin), passage3.text, 'Passage 3 should differ between simpler reading and notation view');

  // Research document containing a markdown table and downloadable assets
  const researchDocs = data.documents.filter(doc => doc.category !== 'overview');
  assert.ok(
    researchDocs.some(doc => Boolean(doc.markdown && /\|.+\|\n\|\s*---/.test(doc.markdown))),
    'Expected a research/guide document containing a markdown table',
  );
  assert.ok(
    researchDocs.some(doc => doc.assets.length > 0),
    'Expected downloadable document assets',
  );

  // Every referenced asset exists in data.assets and matches real bytes & sha256 on disk
  const referencedIds = new Set<string>();
  for (const session of data.sessions) {
    for (const recording of session.recordings) if (recording.available) referencedIds.add(recording.id);
    for (const source of session.sources) referencedIds.add(source.id);
  }
  for (const doc of data.documents) {
    for (const asset of doc.assets) referencedIds.add(asset.id);
  }
  assert.ok(referencedIds.size >= 8, 'Expected downloadable audio, transcript, and document assets');

  for (const id of referencedIds) {
    assert.ok(Object.hasOwn(data.assets, id), `Referenced asset ${id} missing from data.assets`);
  }
  for (const [id, asset] of Object.entries(data.assets)) {
    assert.ok(asset.pathname.startsWith('archive/v1/files/'), `Asset ${id} pathname must start with archive/v1/files/`);
    const filePath = path.join(filesRoot, asset.pathname.slice('archive/v1/files/'.length));
    const info = await stat(filePath);
    assert.equal(info.size, asset.bytes, `Asset ${id} byte size mismatch`);
    const bytes = await readFile(filePath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(digest, asset.sha256, `Asset ${id} SHA-256 mismatch`);
  }

  // Exact search works cleanly over the fixture
  const search = makeSearch(data);
  const locomotiveHits = search({ query: 'locomotive' });
  assert.equal(locomotiveHits.total, 2);
  assert.equal(locomotiveHits.results[0].session.id, 'fixture-010815-locomotive');
  assert.equal(search({ query: 'submarine' }).total, 1);
  assert.equal(search({ query: 'observatory' }).total, 1);
});
