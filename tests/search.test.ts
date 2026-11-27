import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSearchPageSize, makeSearch } from '../src/lib/search';
import type { ArchiveData, ArchiveEntry } from '../src/lib/types';

function entry(id: string, changes: Partial<ArchiveEntry>): ArchiveEntry {
  return { id, sourceName: id + '.txt', title: 'An everyday conversation', overview: 'A short conversation.', origin: 'archived_research', topics: [], dates: [], ages: [], audio: [], preferredAudioId: null, sources: [], moments: [], limits: [], transcript: [], sourceSha256: '', association: '', ...changes };
}
const data: ArchiveData = { version: 1, generatedAt: '', assets: {}, documents: [], entries: [
  entry('research', { title: 'Café and model trains', topics: ['Play'], dates: ['1983-01-02'], overview: 'Building a station together.', transcript: [{ text: 'Before lunch they ask about the blue locomotive and discuss where it should stop. Later they make lunch.' }] }),
  entry('ai', { origin: 'local_ai_draft', title: 'A walk in the garden', topics: ['Outdoors'], transcript: [{ text: 'They wonder whether the locomotive could carry flowers, then return to counting petals.' }] }),
  entry('orphan', { title: 'A missing recording', topics: ['Play'], dates: ['1982-01-02'], overview: 'The transcript mentions an imaginary submarine.', transcript: [{ text: 'A submarine travels under the garden.' }] }),
] };

test('finds transcript-only words and returns surrounding source text', () => {
  const result = makeSearch(data)({ query: 'locomotive' });
  assert.equal(result.total, 2);
  assert.ok(result.results.every(r => r.matchedIn === 'transcript' && r.excerpt.includes('locomotive')));
  assert.ok(result.results.find(r => r.entry.id === 'research')!.excerpt.includes('Before lunch'));
  assert.ok(!('transcript' in result.results[0].entry), 'Search does not send all transcript segments');
});
test('searches title, summary and transcript with accent and prefix matching', () => {
  const search = makeSearch(data);
  assert.equal(search({ query: 'cafe train' }).results[0].entry.id, 'research');
  assert.equal(search({ query: 'imaginary submarine' }).results[0].matchedIn, 'summary');
  assert.equal(search({ query: 'garden locomotive' }).results[0].entry.id, 'ai');
});
test('combines origin and topic filters without dropping transcript-only entries', () => {
  const search = makeSearch(data);
  assert.deepEqual(search({ query: 'locomotive', origin: 'local_ai_draft' }).results.map(r => r.entry.id), ['ai']);
  const play = search({ topic: 'Play', sort: 'oldest' });
  assert.deepEqual(play.results.map(r => r.entry.id), ['orphan', 'research']);
  assert.equal(play.results[0].entry.audio.length, 0);
});
test('unknown dates sort last in both chronological directions and page bounds are safe', () => {
  const search = makeSearch(data);
  assert.deepEqual(search({ sort: 'oldest' }).results.map(r => r.entry.id), ['orphan', 'research', 'ai']);
  assert.deepEqual(search({ sort: 'newest' }).results.map(r => r.entry.id), ['research', 'orphan', 'ai']);
  assert.equal(search({ page: -9 }).page, 1);
  assert.equal(search({ page: 1000 }).page, 1);
  assert.equal(search({ query: 'xyzzzznosuchword' }).total, 0);
});

test('linguistic evidence filters transcript speech while retaining entry-level query/topic/origin semantics', () => {
  const dataWithMarkers: ArchiveData = { ...data, entries: [
    entry('child-question', { title: 'Garden adventure', topics: ['Outdoors'], transcript: [{ text: 'where is it ?\n  Note: at home', speaker: 'Seth (CHI, target child)', start: 4.5 }] }),
    entry('summary-only', { title: 'Garden adventure: where is it?', topics: ['Outdoors'], transcript: [{ text: 'hello .', speaker: 'Seth (CHI, target child)' }] }),
    entry('other-topic', { title: 'Garden adventure', topics: ['Play'], transcript: [{ text: 'where is it ?', speaker: 'Seth (CHI, target child)' }] }),
    entry('ai-question', { title: 'Garden adventure', topics: ['Outdoors'], origin: 'local_ai_draft', transcript: [{ text: 'where is it ?' }] }),
  ] };
  const search = makeSearch(dataWithMarkers);
  const result = search({ query: 'garden', topic: 'Outdoors', marker: 'wh-question' });
  assert.equal(result.total, 1);
  assert.equal(result.results[0].entry.id, 'child-question');
  assert.equal(result.results[0].matchedIn, 'summary');
  assert.ok(result.results[0].excerpt.includes('Garden adventure'));
  assert.equal(result.results[0].linguisticEvidence!.examples[0].text, 'where is it ?');
  assert.equal(result.results[0].linguisticEvidence!.examples[0].segmentIndex, 0);
  assert.equal(result.results[0].linguisticEvidence!.examples[0].start, 4.5);
  assert.deepEqual(search({ query: 'garden', marker: 'wh-question', speaker: 'any', origin: 'local_ai_draft' }).results.map(r => r.entry.id), ['ai-question']);
  assert.equal(search({ query: 'garden', marker: 'wh-question', origin: 'local_ai_draft' }).total, 0);
  assert.ok(!('linguisticEvidence' in search({ query: 'garden' }).results[0]), 'Ordinary results do not add marker evidence');
  assert.equal(search({ marker: '' }).total, 4);
});

test('linguistic filtering occurs before pagination, with bounded source evidence on each returned card', () => {
  const transcript = [{ text: 'no .', speaker: 'Seth (CHI, target child)' }];
  const many: ArchiveData = { ...data, entries: Array.from({ length: 41 }, (_, n) => entry(`entry-${String(n).padStart(2, '0')}`, { transcript: n < 22 ? transcript : [{ text: 'yes .', speaker: 'Seth (CHI, target child)' }] })) };
  const search = makeSearch(many);
  const page = search({ marker: 'negation', page: 2 });
  assert.equal(page.total, 22);
  assert.equal(page.pages, 2);
  assert.equal(page.results.length, 4);
  assert.ok(page.results.every(result => result.matchedIn === 'browse' && result.excerpt === '' && result.linguisticEvidence?.count === 1));
  assert.equal(search({ marker: 'negation', page: 999 }).page, 2);
  assert.equal(search({ marker: 'retracing' }).total, 0);
});

test('list pages use 36 entries while default detail pages retain 18 with consistent bounds', () => {
  const many: ArchiveData = { ...data, entries: Array.from({ length: 73 }, (_, n) => entry(`entry-${String(n).padStart(2, '0')}`, { overview: 'A private summary.', transcript: [{ text: 'Private full transcript.' }] })) };
  const search = makeSearch(many);
  const details = search({});
  assert.equal(details.pageSize, 18);
  assert.equal(details.results.length, 18);
  assert.equal(details.pages, 5);
  const list = search({ pageSize: 36 });
  assert.equal(list.pageSize, 36);
  assert.equal(list.total, 73);
  assert.equal(list.results.length, 36);
  assert.equal(list.pages, 3);
  assert.deepEqual(list.results.slice(0, 18), details.results);
  const page2 = search({ pageSize: 36, page: 2 });
  assert.equal(page2.results[0].entry.id, 'entry-36');
  assert.equal(page2.results.at(-1)!.entry.id, 'entry-71');
  const last = search({ pageSize: 36, page: 99 });
  assert.equal(last.page, 3);
  assert.deepEqual(last.results.map(result => result.entry.id), ['entry-72']);
  assert.equal(search({ pageSize: 36, page: -5 }).page, 1);
  assert.ok(list.results.every(result => !('transcript' in result.entry) && !('sources' in result.entry) && !('sourceSha256' in result.entry)), 'Larger pages retain the same public card projection');
});

test('list pagination applies query, origin, theme and linguistic filters before slicing', () => {
  const transcript = [{ text: 'no garden .', speaker: 'Seth (CHI, target child)' }];
  const many: ArchiveData = { ...data, entries: [
    ...Array.from({ length: 40 }, (_, n) => entry(`eligible-${String(n).padStart(2, '0')}`, { topics: ['Outdoors'], transcript })),
    entry('other-theme', { topics: ['Play'], transcript }),
    entry('other-origin', { origin: 'local_ai_draft', topics: ['Outdoors'], transcript }),
    entry('no-marker', { topics: ['Outdoors'], transcript: [{ text: 'garden .', speaker: 'Seth (CHI, target child)' }] }),
    entry('no-query', { topics: ['Outdoors'], transcript: [{ text: 'no .', speaker: 'Seth (CHI, target child)' }] }),
  ] };
  const search = makeSearch(many);
  const result = search({ query: 'garden', topic: 'Outdoors', origin: 'archived_research', marker: 'negation', speaker: 'any', pageSize: 36, page: 2 });
  assert.equal(result.total, 40);
  assert.equal(result.pageSize, 36);
  assert.equal(result.pages, 2);
  assert.equal(result.results.length, 4);
  assert.ok(result.results.every(item => item.entry.id.startsWith('eligible-') && item.matchedIn === 'transcript' && item.linguisticEvidence?.count === 1 && item.linguisticEvidence.examples.length === 1));
  const empty = search({ marker: 'retracing', pageSize: 36, page: 99 });
  assert.equal(empty.total, 0);
  assert.equal(empty.page, 1);
  assert.equal(empty.pages, 1);
  assert.equal(empty.pageSize, 36);
  assert.deepEqual(empty.results, []);
});

test('page-size validation allows only numeric 18 or 36 and direct callers remain bounded', () => {
  assert.ok(isSearchPageSize(18));
  assert.ok(isSearchPageSize(36));
  for (const value of [null, undefined, '', '18', '36', true, [], {}, 0, -18, 1, 18.5, 35, 37, 1000, NaN, Infinity]) {
    assert.equal(isSearchPageSize(value), false);
  }
  const many: ArchiveData = { ...data, entries: Array.from({ length: 40 }, (_, n) => entry(`entry-${n}`, {})) };
  const invalid = makeSearch(many)({ pageSize: 1000 as 18 });
  assert.equal(invalid.pageSize, 18);
  assert.equal(invalid.results.length, 18);
});
