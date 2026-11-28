import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { NextRequest } from 'next/server';
import { parseStoredArchiveData } from '../src/lib/archive-format';
import {
  ACCESS_HASH_BOOTSTRAP_SCRIPT,
  classifyLegacyRootRequest,
  findSessionByLegacyIdOrSlug,
  isSafeRootRelativeDestination,
  parseLegacyPassageParam,
  resolveLegacyDocumentTarget,
  resolveLegacyEntryTarget,
  resolveLegacyRootIntent,
  stripAccessFromHash,
} from '../src/lib/legacy-redirects';
import { proxy } from '../src/proxy';

async function loadFixtureArchive() {
  const raw = JSON.parse(await readFile(path.resolve('tests/fixtures/archive.json'), 'utf8')) as unknown;
  return parseStoredArchiveData(raw);
}

test('table-driven legacy root query classification and resolution across every legacy shape', async () => {
  const data = await loadFixtureArchive();

  const cases: Array<{
    name: string;
    query: string;
    expected:
      | { kind: 'none' }
      | { kind: 'redirect'; destination: string }
      | { kind: 'not-found'; entity: 'session' | 'document' };
  }> = [
    // Plain root & non-legacy root params
    { name: 'bare root', query: '', expected: { kind: 'none' } },
    { name: 'section=sessions left alone', query: 'section=sessions', expected: { kind: 'none' } },
    { name: 'empty entry ignored', query: 'entry=', expected: { kind: 'none' } },
    { name: 'whitespace entry ignored', query: 'entry=%20%20', expected: { kind: 'none' } },
    { name: 'empty document ignored', query: 'document=', expected: { kind: 'none' } },
    { name: 'invalid marker ignored', query: 'marker=not-a-marker', expected: { kind: 'none' } },

    // ?entry=<legacyId> and &passage=N
    {
      name: 'legacyId -> /sessions/<slug>',
      query: 'entry=fixture-010815-locomotive',
      expected: { kind: 'redirect', destination: '/sessions/010815' },
    },
    {
      name: 'legacyId + positive passage -> /sessions/<slug>#pN',
      query: 'entry=fixture-010815-locomotive&passage=3',
      expected: { kind: 'redirect', destination: '/sessions/010815#p3' },
    },
    {
      name: 'legacyId + large passage (handled on session page) -> /sessions/<slug>#p999',
      query: 'entry=fixture-010815-locomotive&passage=999',
      expected: { kind: 'redirect', destination: '/sessions/010815#p999' },
    },
    {
      name: 'legacyId case-insensitive match',
      query: 'entry=FIXTURE-020110-SUBMARINE&passage=2',
      expected: { kind: 'redirect', destination: '/sessions/020110-tb#p2' },
    },
    {
      name: 'slug passed to ?entry= resolves cleanly',
      query: 'entry=020604-LOCAL&passage=1',
      expected: { kind: 'redirect', destination: '/sessions/020604-local#p1' },
    },
    {
      name: 'non-positive passage=0 ignored',
      query: 'entry=fixture-010815-locomotive&passage=0',
      expected: { kind: 'redirect', destination: '/sessions/010815' },
    },
    {
      name: 'negative passage=-4 ignored',
      query: 'entry=fixture-010815-locomotive&passage=-4',
      expected: { kind: 'redirect', destination: '/sessions/010815' },
    },
    {
      name: 'non-numeric passage=abc ignored',
      query: 'entry=fixture-010815-locomotive&passage=abc',
      expected: { kind: 'redirect', destination: '/sessions/010815' },
    },
    {
      name: 'leading-zero passage=03 ignored',
      query: 'entry=fixture-010815-locomotive&passage=03',
      expected: { kind: 'redirect', destination: '/sessions/010815' },
    },
    {
      name: 'validated ?from= preserved alongside ?entry= and &passage=',
      query: 'entry=fixture-010815-locomotive&passage=3&from=%2Fsearch%3Fq%3Dbridge',
      expected: { kind: 'redirect', destination: '/sessions/010815?from=%2Fsearch%3Fq%3Dbridge#p3' },
    },
    {
      name: 'explicit ?from=/sessions preserved alongside ?entry=',
      query: 'entry=fixture-010815-locomotive&from=%2Fsessions',
      expected: { kind: 'redirect', destination: '/sessions/010815?from=%2Fsessions' },
    },
    {
      name: 'valid root marker ?from= preserved alongside ?entry=',
      query: 'entry=fixture-010815-locomotive&from=%2F%3Fmarker%3Drepetition%26speaker%3Dany',
      expected: { kind: 'redirect', destination: '/sessions/010815?from=%2F%3Fmarker%3Drepetition%26speaker%3Dany' },
    },
    {
      name: 'root ?from= with nonempty entry selector rejected (would loop to detail page)',
      query: 'entry=fixture-010815-locomotive&from=%2F%3Fentry%3Dfixture-010815-locomotive%26marker%3Drepetition',
      expected: { kind: 'redirect', destination: '/sessions/010815' },
    },
    {
      name: 'root ?from= with nonempty document selector rejected (resolves to detail page)',
      query: 'entry=fixture-010815-locomotive&from=%2F%3Fdocument%3Dfixture-provenance-guide%26section%3Dsessions',
      expected: { kind: 'redirect', destination: '/sessions/010815' },
    },
    {
      name: 'external ?from= rejected on ?entry= redirect',
      query: 'entry=fixture-010815-locomotive&from=https%3A%2F%2Fevil.example%2Fsearch',
      expected: { kind: 'redirect', destination: '/sessions/010815' },
    },
    {
      name: 'protocol-relative ?from=//evil.example rejected',
      query: 'entry=fixture-010815-locomotive&from=%2F%2Fevil.example%2Fsearch',
      expected: { kind: 'redirect', destination: '/sessions/010815' },
    },
    {
      name: 'backslash-prefixed ?from=/\\evil.example rejected',
      query: 'entry=fixture-010815-locomotive&from=%2F%5Cevil.example%2Fsearch',
      expected: { kind: 'redirect', destination: '/sessions/010815' },
    },
    {
      name: 'unknown ?entry= -> 404 session',
      query: 'entry=unknown-legacy-id',
      expected: { kind: 'not-found', entity: 'session' },
    },
    {
      name: 'unknown ?entry= with passage -> 404 session',
      query: 'entry=unknown-legacy-id&passage=3',
      expected: { kind: 'not-found', entity: 'session' },
    },

    // ?document=<id>
    {
      name: 'known ?document= -> /research/<id>',
      query: 'document=fixture-provenance-guide',
      expected: { kind: 'redirect', destination: '/research/fixture-provenance-guide' },
    },
    {
      name: 'uppercase ?document= -> canonical /research/<id>',
      query: 'document=FIXTURE-RESEARCH-NOTES',
      expected: { kind: 'redirect', destination: '/research/fixture-research-notes' },
    },
    {
      name: 'imported methods-and-audit -> /research/methods-and-audit',
      query: 'document=methods-and-audit',
      expected: { kind: 'redirect', destination: '/research/methods-and-audit' },
    },
    {
      name: 'unknown ?document= -> 404 document',
      query: 'document=nonexistent-doc',
      expected: { kind: 'not-found', entity: 'document' },
    },

    // ?marker=X and ?marker=X&speaker=Y
    {
      name: '?marker=repetition alone -> /search?marker=repetition',
      query: 'marker=repetition',
      expected: { kind: 'redirect', destination: '/search?marker=repetition' },
    },
    {
      name: '?marker=repetition&speaker=child -> canonical /search?marker=repetition',
      query: 'marker=repetition&speaker=child',
      expected: { kind: 'redirect', destination: '/search?marker=repetition' },
    },
    {
      name: '?marker=repetition&speaker=any -> /search?marker=repetition&speaker=any',
      query: 'marker=repetition&speaker=any',
      expected: { kind: 'redirect', destination: '/search?marker=repetition&speaker=any' },
    },
    {
      name: '?marker=wh-question&speaker=any -> /search?marker=wh-question&speaker=any',
      query: 'marker=wh-question&speaker=any',
      expected: { kind: 'redirect', destination: '/search?marker=wh-question&speaker=any' },
    },
    {
      name: '?marker=pause&speaker=invalid falls back to child (omitted)',
      query: 'marker=pause&speaker=invalid',
      expected: { kind: 'redirect', destination: '/search?marker=pause' },
    },
    {
      name: '?marker= with validated extra search params & explicit sort preserves them',
      query: 'marker=retracing&speaker=any&origin=archived_research&sort=age-asc',
      expected: { kind: 'redirect', destination: '/search?origin=archived_research&marker=retracing&speaker=any&sort=age-asc' },
    },
    {
      name: '?marker= preserves curated valid topic',
      query: 'marker=repetition&topic=Play+and+imagination',
      expected: { kind: 'redirect', destination: '/search?topic=Play+and+imagination&marker=repetition' },
    },
    {
      name: '?marker= strips invalid topic and malformed search params before 308 redirect',
      query: 'marker=repetition&topic=Bogus&origin=invalid&view=grid&page=-2&ageMin=30&ageMax=20',
      expected: { kind: 'redirect', destination: '/search?marker=repetition' },
    },

    // Precedence: entry > document > marker
    {
      name: 'entry takes precedence over document and marker',
      query: 'entry=fixture-010815-locomotive&document=fixture-provenance-guide&marker=repetition',
      expected: { kind: 'redirect', destination: '/sessions/010815' },
    },
    {
      name: 'unknown entry still takes precedence over document and marker (404)',
      query: 'entry=unknown-id&document=fixture-provenance-guide&marker=repetition',
      expected: { kind: 'not-found', entity: 'session' },
    },
    {
      name: 'document takes precedence over marker',
      query: 'document=fixture-provenance-guide&marker=repetition&speaker=any',
      expected: { kind: 'redirect', destination: '/research/fixture-provenance-guide' },
    },
    {
      name: 'empty entry falls through to document',
      query: 'entry=&document=fixture-provenance-guide',
      expected: { kind: 'redirect', destination: '/research/fixture-provenance-guide' },
    },
  ];

  for (const tc of cases) {
    const params = new URLSearchParams(tc.query);
    const intent = classifyLegacyRootRequest(params);
    const resolved = resolveLegacyRootIntent(intent, data);
    assert.deepEqual(resolved, tc.expected, tc.name);

    // Also verify plain Record<string, string | string[] | undefined> parity (App Router searchParams shape)
    const record: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of params.entries()) {
      const existing = record[key];
      if (existing === undefined) record[key] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else record[key] = [existing, value];
    }
    assert.deepEqual(
      resolveLegacyRootIntent(classifyLegacyRootRequest(record), data),
      tc.expected,
      `${tc.name} (record searchParams)`,
    );
  }
});

test('resolveLegacyDocumentTarget redirects methods-and-audit to /about when retired from archive documents', async () => {
  const data = await loadFixtureArchive();
  const withoutMethods = data.documents.filter(doc => doc.id !== 'methods-and-audit');

  assert.deepEqual(resolveLegacyDocumentTarget(withoutMethods, 'methods-and-audit'), {
    kind: 'redirect',
    destination: '/about',
  });
  assert.deepEqual(resolveLegacyDocumentTarget(withoutMethods, 'METHODS-AND-AUDIT'), {
    kind: 'redirect',
    destination: '/about',
  });
  assert.deepEqual(resolveLegacyDocumentTarget(withoutMethods, 'unknown-doc'), {
    kind: 'not-found',
    entity: 'document',
  });
});

test('findSessionByLegacyIdOrSlug supports distinct id, legacyId, and slug without prototype pollution', async () => {
  const data = await loadFixtureArchive();
  const customSession = {
    ...data.sessions[0],
    id: 'current-id-01',
    legacyId: 'legacy-id-01',
    slug: '011119d-82-supp',
  };

  assert.equal(findSessionByLegacyIdOrSlug([customSession], 'legacy-id-01')?.slug, '011119d-82-supp');
  assert.equal(findSessionByLegacyIdOrSlug([customSession], 'current-id-01')?.slug, '011119d-82-supp');
  assert.equal(findSessionByLegacyIdOrSlug([customSession], '011119D-82-SUPP')?.slug, '011119d-82-supp');
  assert.equal(findSessionByLegacyIdOrSlug([customSession], 'toString'), null);
  assert.equal(resolveLegacyEntryTarget([customSession], 'legacy-id-01', 12).kind, 'redirect');
});

test('parseLegacyPassageParam and isSafeRootRelativeDestination reject malformed inputs', () => {
  assert.equal(parseLegacyPassageParam('1'), 1);
  assert.equal(parseLegacyPassageParam(' 42 '), 42);
  for (const invalid of [null, undefined, '', '0', '-1', '01', '1.5', '1e2', 'abc', '999999999999999999999']) {
    assert.equal(parseLegacyPassageParam(invalid), null, String(invalid));
  }

  assert.equal(isSafeRootRelativeDestination('/sessions/010815#p3'), true);
  assert.equal(isSafeRootRelativeDestination('/search?marker=repetition&speaker=any'), true);
  for (const unsafe of ['', '//evil.example/foo', '/\\evil.example', 'https://evil.example', '/search\r\nX-Injected: 1']) {
    assert.equal(isSafeRootRelativeDestination(unsafe), false, unsafe);
  }
});

test('table-driven stripAccessFromHash strips #access= and preserves all other fragments with inline bootstrap parity', () => {
  const cases: Array<{ hash: string; expected: string | null }> = [
    { hash: '', expected: null },
    { hash: '#', expected: null },
    { hash: '#p42', expected: null },
    { hash: '#t=12:34', expected: null },
    { hash: '#inferred-ages', expected: null },
    { hash: '#how-to-cite', expected: null },
    { hash: '#access-and-analytics', expected: null },
    { hash: '#access', expected: null },
    { hash: '#access=old-secret-token', expected: '' },
    { hash: '#ACCESS=UPPER-TOKEN', expected: '' },
    { hash: '#access=', expected: '' },
    { hash: '#access=secret&', expected: '' },
    { hash: '#access=secret&p42', expected: '#p42' },
    { hash: '#p42&access=secret', expected: '#p42' },
    { hash: '#access=secret&t=12:34', expected: '#t=12:34' },
    { hash: '#access=k1&inferred-ages&ACCESS=k2', expected: '#inferred-ages' },
    { hash: '#p3&access=secret&extra=1', expected: '#p3&extra=1' },
  ];

  for (const tc of cases) {
    assert.equal(stripAccessFromHash(tc.hash), tc.expected, `stripAccessFromHash(${tc.hash})`);

    // Execute the exact pre-paint inline bootstrap script in a sandboxed VM to guarantee 100% parity
    const initialHref = `https://archive.example/sessions/010815?from=%2Fsearch${tc.hash}`;
    let replacedHref: string | null = null;
    const sandbox = {
      URL,
      location: {
        href: initialHref,
        hash: tc.hash,
      },
      history: {
        state: { marker: 1 },
        replaceState: (_state: unknown, _title: string, url: string) => {
          replacedHref = url;
        },
      },
    };
    vm.runInNewContext(ACCESS_HASH_BOOTSTRAP_SCRIPT, sandbox);

    if (tc.expected === null) {
      assert.equal(replacedHref, null, `bootstrap should not call replaceState for ${tc.hash}`);
    } else {
      const expectedUrl = new URL(initialHref);
      expectedUrl.hash = tc.expected;
      assert.equal(replacedHref, expectedUrl.href, `bootstrap replaceState parity for ${tc.hash}`);
    }
  }
});

test('Next.js 16 proxy() returns HTTP 308 with private headers for /?marker= and passes through /?entry=, /?document=, and /', () => {
  const markerAny = proxy(new NextRequest('https://archive.example/?marker=repetition&speaker=any'));
  assert.equal(markerAny.status, 308);
  assert.equal(markerAny.headers.get('location'), 'https://archive.example/search?marker=repetition&speaker=any');
  assert.match(markerAny.headers.get('cache-control') || '', /\bno-store\b/i);
  assert.match(markerAny.headers.get('cdn-cache-control') || '', /\bno-store\b/i);
  assert.match(markerAny.headers.get('vercel-cdn-cache-control') || '', /\bno-store\b/i);
  assert.match(markerAny.headers.get('x-robots-tag') || '', /\bnoindex\b/i);
  assert.equal(markerAny.headers.get('referrer-policy'), 'no-referrer');

  const markerDefault = proxy(new NextRequest('https://archive.example/?marker=pause'));
  assert.equal(markerDefault.status, 308);
  assert.equal(markerDefault.headers.get('location'), 'https://archive.example/search?marker=pause');

  const markerInvalidTopic = proxy(new NextRequest('https://archive.example/?marker=repetition&topic=Bogus'));
  assert.equal(markerInvalidTopic.status, 308);
  assert.equal(markerInvalidTopic.headers.get('location'), 'https://archive.example/search?marker=repetition');

  const markerValidTopic = proxy(new NextRequest('https://archive.example/?marker=repetition&topic=Play+and+imagination'));
  assert.equal(markerValidTopic.status, 308);
  assert.equal(markerValidTopic.headers.get('location'), 'https://archive.example/search?topic=Play+and+imagination&marker=repetition');

  // Entry and document take precedence over marker and pass through to page.tsx for archive lookup
  for (const passThroughUrl of [
    'https://archive.example/',
    'https://archive.example/?entry=fixture-010815-locomotive',
    'https://archive.example/?entry=fixture-010815-locomotive&marker=repetition',
    'https://archive.example/?document=fixture-provenance-guide&marker=repetition',
    'https://archive.example/?marker=bogus',
  ]) {
    const res = proxy(new NextRequest(passThroughUrl));
    assert.equal(res.status, 200, `expected passthrough for ${passThroughUrl}`);
    assert.equal(res.headers.get('location'), null, `expected no redirect header for ${passThroughUrl}`);
  }
});
