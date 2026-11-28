import assert from 'node:assert/strict';
import test from 'node:test';
import { ANALYTICS_ORIGIN, analyticsCollectorBody, sanitizeAnalyticsUrl, sanitizeArchiveEvent } from '../src/lib/analytics-policy';
import { POST } from '../src/app/api/analytics/[kind]/route';

const RECORDING = 'archive-010101';
const AUDIO = 'a'.repeat(32);

test('analytics removes private URLs, referrers, identifiers, traits and unknown fields', () => {
  const poisoned = {
    o: `${ANALYTICS_ORIGIN}/recording?query=private-words#access=private-key`,
    r: 'https://example.org/private/path?email=private@example.org',
    dp: '/private/path', userId: 'private-person', groupId: 'private-group',
    props: { email: 'private@example.org' }, f: { p: { privateFlag: 'private-value' } },
    __cdp: { private: 'private-value' }, ts: 0, sdkv: 'private-value',
    en: 'audio_start', ed: {
      recordingId: RECORDING, origin: 'archived_research', audioId: AUDIO,
      query: 'private-words', excerpt: 'private-transcript', access: 'private-key',
      url: 'https://example.org/private-signed-url', nested: { email: 'private@example.org' },
    },
  };
  const body = analyticsCollectorBody('event', poisoned, 8, 1234);
  assert.deepEqual(body, {
    o: `${ANALYTICS_ORIGIN}/recording`, ts: 1234, sdkn: '@vercel/analytics', sdkv: '2.0.1', r: '', dp: '/recording',
    en: 'audio_start', ed: { recordingId: RECORDING, origin: 'archived_research', audioId: AUDIO },
  });
  assert.equal(JSON.stringify(body).includes('private'), false);
  const page = analyticsCollectorBody('view', poisoned, 8, 1234);
  assert.equal('en' in page!, false);
  assert.equal('ed' in page!, false);
  assert.equal(JSON.stringify(page).includes('private'), false);
});

test('event allowlist rejects arbitrary text in known fields and oversized/nonfinite counts', () => {
  for (const name of ['private search', '__proto__', 'constructor', 'identify', 'group', null]) {
    assert.equal(sanitizeArchiveEvent(name, { recordingId: RECORDING }), null);
  }
  for (const value of ['private@example.org', 'local-private-words', 'archive-010101?access=secret', RECORDING + '\n', null, {}, ['abc']]) {
    assert.equal(sanitizeArchiveEvent('audio_start', { recordingId: value }), null);
  }
  for (const queryLength of [-1, 301, NaN, Infinity, 2.5, 'private-words']) {
    assert.equal(sanitizeArchiveEvent('search_completed', { results: 2, queryLength }), null);
  }
  assert.equal(sanitizeArchiveEvent('filter_changed', { filter: 'theme', value: 'private-words' }), null);
  for (const sortValue of ['age-asc', 'age-desc', 'relevance']) {
    assert.deepEqual(
      sanitizeArchiveEvent('filter_changed', { filter: 'sort', value: sortValue }),
      { name: 'filter_changed', properties: { filter: 'sort', value: sortValue } },
    );
  }
  for (const invalidSort of ['oldest', 'newest', 'private-sort']) {
    assert.equal(sanitizeArchiveEvent('filter_changed', { filter: 'sort', value: invalidSort }), null);
  }
  assert.equal(sanitizeArchiveEvent('source_download', { recordingId: RECORDING, format: 'private-filename.txt' }), null);
  assert.equal(sanitizeArchiveEvent('audio_error', { recordingId: RECORDING, errorCode: 'private error message' }), null);
  assert.equal(sanitizeArchiveEvent('audio_start', { origin: 'archived_research' }), null);
});

test('Pro events fit two properties and Plus expands to eight without changing counts', () => {
  const input = { en: 'search_completed', ed: {
    queryLength: 11, wordCount: 2, results: 7, page: 1, view: 'list', origin: '', marker: '', theme: '',
  } };
  const pro = analyticsCollectorBody('event', input, 2)!;
  const plus = analyticsCollectorBody('event', input, 8)!;
  assert.equal('ed' in pro && Object.keys(pro.ed).length, 2);
  assert.equal('ed' in plus && Object.keys(plus.ed).length, 8);
  assert.deepEqual('ed' in pro && pro.ed, { results: 7, queryLength: 11 });
  assert.equal('en' in pro && pro.en, 'search_completed');
  assert.equal('en' in plus && plus.en, 'search_completed');
});

test('virtual page sanitizer never retains unrecognized paths, query strings or hashes', () => {
  for (const url of [null, {}, 'https://example.org/private', `${ANALYTICS_ORIGIN}/?entry=secret#access=secret`, `${ANALYTICS_ORIGIN}/private`]) {
    assert.equal(sanitizeAnalyticsUrl(url), `${ANALYTICS_ORIGIN}/overview`);
  }
  assert.equal(sanitizeAnalyticsUrl(`${ANALYTICS_ORIGIN}/research?secret=1#access=secret`), `${ANALYTICS_ORIGIN}/research`);
  assert.equal(sanitizeAnalyticsUrl(`${ANALYTICS_ORIGIN}/about?secret=1#inferred-ages`), `${ANALYTICS_ORIGIN}/about`);
});

test('public relay blocks foreign requests, bounds bodies and forwards only clean context', async () => {
  const previous = { vercel: process.env.VERCEL, env: process.env.VERCEL_ENV, plus: process.env.ARCHIVE_ANALYTICS_PLUS, fetch: globalThis.fetch };
  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = 'production';
  process.env.ARCHIVE_ANALYTICS_PLUS = '1';
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return new Response(null, { status: 204 });
  };
  const cookie = 'archive_session=obsolete-private-cookie';
  const event = { o: `${ANALYTICS_ORIGIN}/recording?private=query#access=secret`, r: 'https://private.example.org', userId: 'private-person', en: 'audio_start', ed: { recordingId: RECORDING, origin: 'archived_research', audioId: AUDIO, excerpt: 'private' } };
  const request = (body: unknown = event, overrides: Record<string, string> = {}) => new Request(`${ANALYTICS_ORIGIN}/api/analytics/event`, { method: 'POST', headers: {
    host: 'balloons-and-bananas.vercel.app', origin: ANALYTICS_ORIGIN, cookie,
    'content-type': 'application/json', 'user-agent': 'Test Browser', 'x-forwarded-for': '192.0.2.2',
    referer: `${ANALYTICS_ORIGIN}/?private=secret`, authorization: 'private-token', ...overrides,
  }, body: JSON.stringify(body) });
  const context = { params: Promise.resolve({ kind: 'event' }) };
  try {
    assert.equal((await POST(request(event, { origin: 'https://example.org' }), context)).status, 403);
    assert.equal((await POST(request({ ...event, padding: 'x'.repeat(5000) }), context)).status, 400);
    assert.equal((await POST(request(), { params: Promise.resolve({ kind: 'identify' }) })).status, 404);
    assert.equal(calls.length, 0);
    const response = await POST(request(event, { cookie: '' }), context);
    assert.equal(response.status, 204);
    assert.match(response.headers.get('cache-control')!, /no-store/);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${ANALYTICS_ORIGIN}/_vercel/insights/event`);
    assert.deepEqual(Object.fromEntries(calls[0].headers), {
      'content-type': 'application/json', 'user-agent': 'Test Browser', 'x-va-server': '1', 'x-vercel-ip': '192.0.2.2',
    });
    assert.equal(JSON.stringify(calls[0].body).includes('private'), false);
    assert.equal(JSON.stringify(calls[0].body).includes('secret'), false);
    process.env.VERCEL_ENV = 'preview';
    assert.equal((await POST(request(), context)).status, 204);
    assert.equal(calls.length, 1);
    process.env.VERCEL_ENV = 'production';
    globalThis.fetch = async () => { throw new Error('private upstream error'); };
    const failure = await POST(request(), context);
    assert.equal(failure.status, 502);
    assert.equal(await failure.text(), '');
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of Object.entries({ VERCEL: previous.vercel, VERCEL_ENV: previous.env, ARCHIVE_ANALYTICS_PLUS: previous.plus })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
