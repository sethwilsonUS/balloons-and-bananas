import assert from 'node:assert/strict';
import test from 'node:test';
import { requestOriginIsAllowed } from '../src/lib/access';
import { POST as access } from '../src/app/api/access/route';
import { GET as session, DELETE as endSession } from '../src/app/api/session/route';
import { GET as share } from '../src/app/api/share/route';

test('origin guard accepts only explicit same-origin browser requests', () => {
  const target = 'https://balloons-and-bananas.vercel.app';
  const request = (origin?: string, extra: Record<string, string> = {}) => new Request(`${target}/api/access`, {
    method: 'POST',
    headers: { ...(origin === undefined ? {} : { origin }), ...extra },
  });
  assert.equal(requestOriginIsAllowed(request(target)), true);
  for (const origin of [
    undefined, '', 'null', 'https://evil.example', 'http://balloons-and-bananas.vercel.app',
    `${target}.evil.example`, `${target}/`, `${target}/path`, `${target}:444`,
    `${target} https://evil.example`, 'file://', 'not a URL',
  ]) assert.equal(requestOriginIsAllowed(request(origin)), false);
  assert.equal(requestOriginIsAllowed(request('https://evil.example', {
    'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https',
  })), false);
  assert.equal(requestOriginIsAllowed(new Request('http://127.0.0.1:3000/api/access', {
    method: 'POST', headers: { origin: 'http://127.0.0.1:3000' },
  })), true);
  assert.equal(requestOriginIsAllowed(new Request('http://127.0.0.1:3000/api/access', { method: 'POST' })), false);
  assert.equal(requestOriginIsAllowed({} as Request), false);
});

test('origin follows the browser Host when Next normalizes the request URL', () => {
  const request = (origin: string, host: string, extra: Record<string, string> = {}) => new Request('http://localhost:4317/api/access', {
    method: 'POST', headers: { origin, host, ...extra },
  });
  assert.equal(requestOriginIsAllowed(request('http://127.0.0.1:4317', '127.0.0.1:4317')), true);
  assert.equal(requestOriginIsAllowed(request('http://localhost:4317', '127.0.0.1:4317')), false);
  assert.equal(requestOriginIsAllowed(request('http://evil.example', '127.0.0.1:4317', {
    'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'http',
  })), false);
  assert.equal(requestOriginIsAllowed(request('http://[::1]:4317', '[::1]:4317')), true);
  for (const host of [
    '', 'localhost:4317,evil.example', 'evil.example@localhost:4317',
    'localhost:4317/path', 'localhost:4317?query=1', 'localhost:4317#fragment',
    'localhost:4317\\anything', 'localhost:4317 evil.example', '%6cocalhost:4317',
    '[::1', 'localhost:999999',
  ]) assert.equal(requestOriginIsAllowed(request('http://localhost:4317', host)), false);
});

test('Vercel uses HTTPS and the actual custom-domain Host, not forwarded headers', () => {
  const previous = process.env.VERCEL;
  try {
    process.env.VERCEL = '1';
    const request = (origin: string, extra: Record<string, string> = {}) => new Request('http://internal:3000/api/access', {
      method: 'POST', headers: { origin, host: 'archive.example.com', ...extra },
    });
    assert.equal(requestOriginIsAllowed(request('https://archive.example.com')), true);
    assert.equal(requestOriginIsAllowed(request('http://archive.example.com')), false);
    assert.equal(requestOriginIsAllowed(request('https://evil.example', {
      'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https',
    })), false);
    assert.equal(requestOriginIsAllowed(request('http://archive.example.com', {
      'x-forwarded-proto': 'http',
    })), false);
    assert.equal(requestOriginIsAllowed(new Request('http://internal:3000/api/access', {
      method: 'POST', headers: { host: 'archive.example.com' },
    })), false);
  } finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
});

test('public compatibility routes need neither a key nor a cookie and never issue credentials', async () => {
  const target = 'https://balloons-and-bananas.vercel.app';
  const previous = process.env.ARCHIVE_SHARE_KEY;
  delete process.env.ARCHIVE_SHARE_KEY;
  try {
    for (const body of ['', 'not JSON', '{"key":"retired-link-value"}']) {
      const response = await access(new Request(`${target}/api/access`, {
        method: 'POST', headers: { origin: target }, body,
      }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { authorized: true });
      assert.equal(response.headers.get('set-cookie'), null);
    }
    for (const response of [await session(), await endSession(new Request(`${target}/api/session`, {
      method: 'DELETE', headers: { origin: target, cookie: 'archive_session=obsolete-value' },
    }))]) {
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { authorized: true });
      assert.equal(response.headers.get('set-cookie'), null);
    }
    const link = await share();
    assert.deepEqual(await link.json(), { url: '/' });
    assert.equal(link.headers.get('set-cookie'), null);
  } finally {
    if (previous === undefined) delete process.env.ARCHIVE_SHARE_KEY;
    else process.env.ARCHIVE_SHARE_KEY = previous;
  }
});

test('public compatibility POST and DELETE retain same-origin protection', async () => {
  for (const origin of [undefined, 'null', 'https://other.example']) {
    for (const [handler, method] of [[access, 'POST'], [endSession, 'DELETE']] as const) {
      const response = await handler(new Request('https://archive.example/api/access', {
        method, headers: origin === undefined ? {} : { origin },
      }));
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: 'Request not allowed.' });
      assert.equal(response.headers.get('set-cookie'), null);
    }
  }
});
