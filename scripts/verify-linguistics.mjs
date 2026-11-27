#!/usr/bin/env node
// Focused release checks. Prints counts only, never archive excerpts or credentials.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let checks = 0;
let stage = 'configuration';
const verify = (condition, name) => { assert.ok(condition, name); checks++; };

try {
  const base = new URL(process.argv[2]);
  const local = ['127.0.0.1', 'localhost'].includes(base.hostname);
  verify(!base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 'origin only');
  verify(local || base.origin === 'https://balloons-and-bananas.vercel.app', 'approved destination');
  verify(base.protocol === 'https:' || (local && base.protocol === 'http:'), 'secure remote transport');
  process.loadEnvFile('.env.local');
  const key = process.env.ARCHIVE_SHARE_KEY;
  verify(typeof key === 'string' && key.length >= 32, 'key configured');
  const data = JSON.parse(await readFile('private-data/archive.json', 'utf8'));
  const byId = new Map(data.entries.map(entry => [entry.id, entry]));
  let cookie;
  async function call(body, { authenticated = true, origin = base.origin, raw = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (authenticated && cookie) headers.Cookie = cookie;
    if (origin) headers.Origin = origin;
    return fetch(new URL('/api/search', base), {
      method: 'POST', headers, body: raw ? body : JSON.stringify(body),
      redirect: 'manual', signal: AbortSignal.timeout(60_000),
    });
  }
  function privateHeaders(response) {
    verify(/no-store/.test(response.headers.get('cache-control') || ''), 'search no-store');
    verify(/noindex/.test(response.headers.get('x-robots-tag') || ''), 'search noindex');
  }

  stage = 'anonymous linguistic request';
  let response = await call({ marker: 'repetition', speaker: 'any' }, { authenticated: false });
  verify(response.status === 401, 'anonymous denied');
  privateHeaders(response);
  await response.arrayBuffer();

  stage = 'access';
  response = await fetch(new URL('/api/access', base), {
    method: 'POST', headers: { Origin: base.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }), redirect: 'manual', signal: AbortSignal.timeout(30_000),
  });
  verify(response.status === 200, 'access succeeds');
  cookie = response.headers.get('set-cookie')?.split(';')[0];
  verify(Boolean(cookie), 'session established');
  await response.arrayBuffer();

  stage = 'invalid filter validation';
  for (const invalid of [
    { marker: 'made-up' }, { marker: ['question'] }, { marker: {} }, { marker: null },
    { speaker: 'guessed-child' }, { speaker: ['child'] }, { speaker: null },
    ...[null, '36', 0, -1, 1, 18.5, 37, 1000, [], {}].map(pageSize => ({ pageSize })),
  ]) {
    response = await call(invalid);
    verify(response.status === 400, 'bad filter rejected');
    privateHeaders(response);
    await response.arrayBuffer();
  }
  response = await call('{', { raw: true });
  verify(response.status === 400, 'malformed JSON rejected');
  await response.arrayBuffer();
  response = await call({ marker: 'question' }, { origin: 'https://unrelated.invalid' });
  verify(response.status === 403, 'foreign origin denied');
  await response.arrayBuffer();

  stage = 'details and list pagination';
  response = await call({ sort: 'oldest' });
  const defaultPage = await response.json();
  verify(response.status === 200 && defaultPage.pageSize === 18, 'default details size unchanged');
  const firstPages = {};
  for (const pageSize of [18, 36]) {
    response = await call({ pageSize, sort: 'oldest' });
    const first = await response.json();
    privateHeaders(response);
    verify(response.status === 200 && first.pageSize === pageSize, 'effective page size reported');
    verify(first.total === data.entries.length && first.results.length === pageSize, 'full first page');
    verify(first.pages === Math.ceil(first.total / pageSize) && first.page === 1, 'page count respects size');
    firstPages[pageSize] = first.results.map(row => row.entry.id);
    response = await call({ pageSize, page: 2, sort: 'oldest' });
    const second = await response.json();
    verify(response.status === 200 && second.page === 2 && second.results.length === pageSize, 'second page');
    verify(second.results.every(row => !firstPages[pageSize].includes(row.entry.id)), 'adjacent pages do not overlap');
    response = await call({ pageSize, page: 99999, sort: 'oldest' });
    const last = await response.json();
    verify(response.status === 200 && last.page === first.pages, 'oversized page clamps to last');
    verify(last.results.length === first.total - (first.pages - 1) * pageSize, 'complete final page');
    verify([...first.results, ...second.results, ...last.results].every(row => !('transcript' in row.entry) && byId.get(row.entry.id)?.origin === row.entry.origin), 'pagination preserves source labels and private projection');
  }
  verify(firstPages[18].every((id, index) => firstPages[36][index] === id), 'switching density preserves ordering');
  response = await call({ pageSize: 18, page: 2, sort: 'oldest' });
  const secondDetails = await response.json();
  verify(secondDetails.results.every((row, index) => firstPages[36][18 + index] === row.entry.id), 'one list page equals two details pages');

  stage = 'linguistic pagination in list view';
  response = await call({ marker: 'repetition', speaker: 'any', pageSize: 36, page: 2 });
  const listMarkers = await response.json();
  verify(response.status === 200 && listMarkers.total === 81 && listMarkers.page === 2 && listMarkers.pages === 3 && listMarkers.results.length === 36, 'marker filter precedes compact pagination');
  verify(listMarkers.results.every(row => row.linguisticEvidence?.marker === 'repetition' && row.linguisticEvidence.examples.length > 0 && row.entry.origin !== 'local_ai_draft'), 'compact marker page retains source evidence');

  const markers = ['repetition', 'retracing', 'pause', 'question', 'wh-question', 'negation', 'first-person', 'deixis'];
  const totals = {};
  let sample;
  for (const marker of markers) for (const speaker of ['child', 'any']) {
    stage = `${marker}/${speaker}`;
    response = await call({ marker, speaker });
    verify(response.status === 200, 'valid marker succeeds');
    privateHeaders(response);
    const result = await response.json();
    totals[`${marker}/${speaker}`] = result.total;
    verify(Number.isSafeInteger(result.total) && result.total >= 0, 'bounded total');
    verify(result.results.length <= 18, 'bounded page');
    for (const row of result.results) {
      const original = byId.get(row.entry.id);
      verify(Boolean(original), 'known source');
      verify(!('transcript' in row.entry), 'no full transcript in search card');
      const evidence = row.linguisticEvidence;
      verify(evidence?.marker === marker && evidence.count > 0, 'matching evidence');
      verify(evidence.examples.length > 0 && evidence.examples.length <= 3, 'bounded examples');
      for (const example of evidence.examples) {
        const segment = original.transcript[example.segmentIndex];
        verify(Boolean(segment), 'valid source locator');
        verify(example.speaker === segment.speaker, 'speaker not inferred');
        verify(typeof example.text === 'string' && example.text.length <= 600, 'bounded excerpt');
        // Truncated excerpts retain the source's text, with an ellipsis at the cut.
        verify(segment.text.includes(example.text.replace(/^…|…$/g, '')), 'excerpt belongs to source');
        verify(!/LOCAL AI-GENERATED EDITORIAL|\[Source |\n\s*Note:/.test(example.text), 'notes are not examples');
        if (speaker === 'child') verify(original.origin === 'archived_research' && /\(CHI(?:[,)]|\s)/.test(segment.speaker || ''), 'explicit archived child only');
        if (['repetition', 'retracing', 'pause'].includes(marker)) verify(original.origin !== 'local_ai_draft', 'CHAT notation requires CHAT source');
      }
      sample ??= row;
    }
  }
  verify(totals['repetition/child'] === 4, 'independent audit repetition coverage');
  verify(totals['retracing/child'] === 0 && totals['retracing/any'] === 1, 'independent audit retracing coverage');
  verify(totals['pause/child'] === 23, 'independent audit pause coverage');
  for (const marker of markers) verify(totals[`${marker}/child`] <= totals[`${marker}/any`], 'child subset');

  stage = 'combined filters and query excerpt';
  const source = byId.get(sample.entry.id);
  response = await call({ marker: sample.linguisticEvidence.marker, speaker: 'child', origin: source.origin, topic: source.topics[0] || '', query: source.sourceName, page: 1 });
  const combined = await response.json();
  verify(response.status === 200 && combined.results.some(row => row.entry.id === source.id), 'query marker source theme intersection');
  verify(combined.results.every(row => row.entry.origin === source.origin && (!source.topics[0] || row.entry.topics.includes(source.topics[0]))), 'all filter conditions respected');

  stage = 'AI child exclusion';
  for (const origin of ['local_ai_draft', 'talkbank_ai_draft']) {
    response = await call({ marker: 'question', origin, speaker: 'child' });
    verify(response.status === 200 && (await response.json()).total === 0, 'AI speakers never identified as child');
  }
  console.log(JSON.stringify({ status: 'passed', checks, totals }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'failed', stage, checks, check: error instanceof assert.AssertionError ? error.message : 'Request or configuration failed' }));
  process.exitCode = 1;
}
