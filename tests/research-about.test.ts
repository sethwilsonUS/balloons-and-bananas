import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { INFERRED_AGE_EXPLANATION_HREF } from '../src/lib/age';
import { parseStoredArchiveData } from '../src/lib/archive-format';
import {
  extractReferencedSessionSlugs,
  findDocumentById,
  formatDocumentCategory,
  getResearchDocuments,
  rewriteLegacyDocumentHref,
  summarizeArchiveForAbout,
} from '../src/lib/research';
import { formatDocumentTitle, formatResearchDocumentPageTitle } from '../src/lib/site';

test('findDocumentById resolves exact IDs, flags non-canonical casing, and rejects missing IDs', async () => {
  const raw = JSON.parse(await readFile(path.resolve('tests/fixtures/archive.json'), 'utf8')) as unknown;
  const data = parseStoredArchiveData(raw);

  const exact = findDocumentById(data.documents, 'fixture-provenance-guide');
  assert.ok(exact);
  assert.equal(exact.document.id, 'fixture-provenance-guide');
  assert.equal(exact.canonical, true);

  const upper = findDocumentById(data.documents, 'FIXTURE-PROVENANCE-GUIDE');
  assert.ok(upper);
  assert.equal(upper.document.id, 'fixture-provenance-guide');
  assert.equal(upper.canonical, false);

  assert.equal(findDocumentById(data.documents, 'does-not-exist'), null);
  assert.equal(findDocumentById(data.documents, '   '), null);
});

test('getResearchDocuments excludes overview documents and formats document categories', async () => {
  const raw = JSON.parse(await readFile(path.resolve('tests/fixtures/archive.json'), 'utf8')) as unknown;
  const data = parseStoredArchiveData(raw);

  const researchDocs = getResearchDocuments(data.documents);
  assert.equal(researchDocs.length, 3);
  assert.ok(researchDocs.every(doc => doc.category !== 'overview'));

  assert.equal(formatDocumentCategory('research'), 'Research material');
  assert.equal(formatDocumentCategory('guide'), 'Archive guide');
  assert.equal(formatDocumentCategory('overview'), 'Collection overview');
});

test('rewriteLegacyDocumentHref converts legacy v1 ?document= links to /research/<doc> preserving fragments', () => {
  assert.equal(rewriteLegacyDocumentHref('/?document=annotation-provenance'), '/research/annotation-provenance');
  assert.equal(rewriteLegacyDocumentHref('?document=methods-and-audit'), '/research/methods-and-audit');
  assert.equal(
    rewriteLegacyDocumentHref('/?document=research-source-quality#peters-1987'),
    '/research/research-source-quality#peters-1987',
  );
  assert.equal(rewriteLegacyDocumentHref('/?document=my%20doc'), '/research/my%20doc');
  assert.equal(rewriteLegacyDocumentHref('/?document=%E0%A4%A'), '/research/%25E0%25A4%25A');
  assert.equal(rewriteLegacyDocumentHref('/research/annotation-provenance'), null);
  assert.equal(rewriteLegacyDocumentHref('/?entry=archive-010626'), null);
  assert.equal(rewriteLegacyDocumentHref('https://doi.org/10.21415/T5NS4D'), null);
});

test('extractReferencedSessionSlugs maps only legacy ?entry= links present in markdown', async () => {
  const raw = JSON.parse(await readFile(path.resolve('tests/fixtures/archive.json'), 'utf8')) as unknown;
  const data = parseStoredArchiveData(raw);

  const overviewDoc = data.documents.find(doc => doc.id === 'fixture-overview-note');
  assert.ok(overviewDoc);
  assert.deepEqual(
    extractReferencedSessionSlugs(overviewDoc.markdown, data.sessions),
    { 'fixture-010815-locomotive': '010815' },
  );

  const provenanceDoc = data.documents.find(doc => doc.id === 'fixture-provenance-guide');
  assert.ok(provenanceDoc);
  assert.deepEqual(extractReferencedSessionSlugs(provenanceDoc.markdown, data.sessions), {});
});

test('summarizeArchiveForAbout computes live request-time counts across origins, recordings, and age types', async () => {
  const raw = JSON.parse(await readFile(path.resolve('tests/fixtures/archive.json'), 'utf8')) as unknown;
  const data = parseStoredArchiveData(raw);

  const summary = summarizeArchiveForAbout(data);
  assert.deepEqual(summary, {
    sessions: 4,
    recordings: 3,
    listeningCopies: 1,
    moments: 6,
    original: 2,
    talkbankAi: 1,
    localAi: 1,
    sourceAgeSessions: 2,
    inferredAgeSessions: 1,
    unagedSessions: 1,
    documents: 3,
  });
});

test('page titles and inferred-age anchor target match the route contract', () => {
  assert.equal(INFERRED_AGE_EXPLANATION_HREF, '/about#inferred-ages');
  assert.equal(formatDocumentTitle({ kind: 'research' }), 'Research & context · The Seth Tapes');
  assert.equal(formatDocumentTitle({ kind: 'about' }), 'About & methods · The Seth Tapes');
  assert.equal(
    formatResearchDocumentPageTitle('Annotation provenance'),
    'Annotation provenance · Research · The Seth Tapes',
  );
  assert.equal(
    formatResearchDocumentPageTitle(null),
    'Document not found · Research · The Seth Tapes',
  );
});
