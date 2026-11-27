import assert from 'node:assert/strict';
import test from 'node:test';
import { checkBasicBot } from '../src/lib/bot-protection';

test('interactive protection explicitly uses free Basic and accepts a human verdict', async () => {
  let calls = 0;
  const response = await checkBasicBot(async options => {
    calls++;
    assert.deepEqual(options, { advancedOptions: { checkLevel: 'basic' } });
    return { isBot: false };
  });
  assert.equal(calls, 1);
  assert.equal(response, null);
});

test('positive bot verdict returns an accessible retry response with no credentials', async () => {
  const response = await checkBasicBot(async () => ({ isBot: true }));
  assert.equal(response?.status, 403);
  assert.deepEqual(await response?.json(), { error: 'This request could not be verified. Please reload the page and try again.' });
  assert.match(response!.headers.get('cache-control')!, /no-store/);
  assert.equal(response!.headers.get('set-cookie'), null);
});

test('BotID service or SDK failure leaves public archive functionality available', async () => {
  assert.equal(await checkBasicBot(async () => { throw new Error('Synthetic service failure'); }), null);
});
