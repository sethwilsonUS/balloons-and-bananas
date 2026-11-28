import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveSessionSlug, findSessionBySlug, isValidSessionSlug } from '../src/lib/sessions';
import type { Session } from '../src/lib/types';

function mockSession(slug: string, overrides: Partial<Session> = {}): Session {
  return {
    id: `archive-${slug}`,
    slug,
    legacyId: `archive-${slug}`,
    sourceName: `transcripts/${slug}.cha`,
    title: `Session ${slug}`,
    overview: 'Synthetic overview.',
    origin: 'archived_research',
    topics: [],
    dates: [],
    ages: [],
    inferredAge: null,
    recordings: [],
    preferredRecordingId: null,
    sources: [],
    moments: [],
    limits: [],
    transcript: [],
    sourceSha256: '',
    association: '',
    ...overrides,
  };
}

test('isValidSessionSlug accepts lowercase URL slugs and rejects invalid formats', () => {
  for (const valid of ['010626', '011119d', '011119d-82-supp', '020110-tb', '020604-local']) {
    assert.equal(isValidSessionSlug(valid), true, valid);
  }
  for (const invalid of ['', '010626A', '010626_a', '-010626', '010626-', '01--06', '010626/sub', 'bad slug']) {
    assert.equal(isValidSessionSlug(invalid), false, invalid);
  }
});

test('deriveSessionSlug uses lower-case filename stems and applies the approved 011119d collision rule', () => {
  assert.equal(deriveSessionSlug('transcripts/010626.cha'), '010626');
  assert.equal(deriveSessionSlug('transcripts-ai/0extra/83/020319B.json'), '020319b');
  assert.equal(deriveSessionSlug('transcripts-ai/0wav/011119d.json'), '011119d');
  assert.equal(deriveSessionSlug('transcripts-ai/0extra/82-supp/011119d.json'), '011119d-82-supp');
  assert.equal(deriveSessionSlug('./transcripts-ai/0extra/82-supp/011119d.json'), '011119d-82-supp');
  assert.equal(deriveSessionSlug('', 'archive-010626'), 'archive-010626');
});

test('findSessionBySlug resolves exact slugs, flags non-canonical casing, and rejects legacy IDs or unknown slugs', () => {
  const sessions = [
    mockSession('010626'),
    mockSession('011119d', { id: 'local-0wav-011119d', legacyId: 'local-0wav-011119d' }),
    mockSession('011119d-82-supp', { id: 'local-0extra-82-supp-011119d', legacyId: 'local-0extra-82-supp-011119d' }),
  ];

  const exact = findSessionBySlug(sessions, '010626');
  assert.ok(exact);
  assert.equal(exact.session.slug, '010626');
  assert.equal(exact.canonical, true);

  const upper = findSessionBySlug(sessions, '011119D');
  assert.ok(upper);
  assert.equal(upper.session.slug, '011119d');
  assert.equal(upper.canonical, false);

  const supp = findSessionBySlug(sessions, '011119d-82-supp');
  assert.ok(supp);
  assert.equal(supp.session.legacyId, 'local-0extra-82-supp-011119d');
  assert.equal(supp.canonical, true);

  assert.equal(findSessionBySlug(sessions, 'archive-010626'), null);
  assert.equal(findSessionBySlug(sessions, 'does-not-exist'), null);
  assert.equal(findSessionBySlug(sessions, '   '), null);
});
