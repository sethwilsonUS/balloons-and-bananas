import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAge } from '../src/lib/age';

test('CHAT ages become readable units with correct singular, plural and explicit zero fields', () => {
  assert.equal(formatAge('1;03.27'), '1 year, 3 months, 27 days');
  assert.equal(formatAge('1;01.01'), '1 year, 1 month, 1 day');
  assert.equal(formatAge('0;00.00'), '0 years, 0 months, 0 days');
  assert.equal(formatAge('2;00.00'), '2 years, 0 months, 0 days');
  assert.equal(formatAge('0;11.31'), '0 years, 11 months, 31 days');
  assert.equal(formatAge('01;3.7'), '1 year, 3 months, 7 days');
});

test('missing precision remains missing rather than being filled with zero', () => {
  assert.equal(formatAge('1;03'), '1 year, 3 months');
  assert.equal(formatAge('1;03.'), '1 year, 3 months');
  assert.equal(formatAge('1;'), '1 year');
  assert.equal(formatAge(' 2;01.03 '), '2 years, 1 month, 3 days');
  assert.equal(formatAge('1'), '1', 'A bare number is not assumed to be CHAT age notation');
});

test('unknown, malformed and out-of-range source values remain verbatim', () => {
  for (const age of ['', 'unknown', '?', '1;??.??', '1;03.?', '1;.27', '-1;03.27', '1;12.00', '1;03.32', '1;003.27', '1;03.027', '1;03.27 extra', '9007199254740992;00.00', '  unknown  ']) {
    assert.equal(formatAge(age), age);
  }
});
