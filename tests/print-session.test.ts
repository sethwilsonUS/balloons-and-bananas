import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { formatPrintSessionHeader, normalizeHttpOrigin } from '../src/lib/print';
import { extractPdfText, normalizePdfText, parseToUnicodeCMap } from './e2e/helpers/pdf-text';

function buildSyntheticPdf(pages: Array<{ contentStream: string; toUnicodeCMap: string }>): Buffer {
  const objects: Array<{ id: number; body: string; stream?: Buffer }> = [];

  // 1: Catalog, 2: Pages
  const pageIds: number[] = [];
  let nextId = 3;

  for (const page of pages) {
    const pageId = nextId++;
    const contentId = nextId++;
    const fontId = nextId++;
    const cmapId = nextId++;
    pageIds.push(pageId);

    const compressedContent = deflateSync(Buffer.from(page.contentStream, 'latin1'));
    const compressedCMap = deflateSync(Buffer.from(page.toUnicodeCMap, 'latin1'));

    objects.push({
      id: pageId,
      body: `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    });
    objects.push({
      id: contentId,
      body: `<< /Filter /FlateDecode /Length ${compressedContent.length} >>`,
      stream: compressedContent,
    });
    objects.push({
      id: fontId,
      body: `<< /Type /Font /Subtype /Type0 /ToUnicode ${cmapId} 0 R >>`,
    });
    objects.push({
      id: cmapId,
      body: `<< /Filter /FlateDecode /Length ${compressedCMap.length} >>`,
      stream: compressedCMap,
    });
  }

  const allObjects = [
    { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { id: 2, body: `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>` },
    ...objects,
  ];

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  for (const obj of allObjects) {
    if (obj.stream) {
      chunks.push(Buffer.from(`${obj.id} 0 obj\n${obj.body}\nstream\n`, 'latin1'));
      chunks.push(obj.stream);
      chunks.push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
    } else {
      chunks.push(Buffer.from(`${obj.id} 0 obj\n${obj.body}\nendobj\n`, 'latin1'));
    }
  }
  chunks.push(Buffer.from('%%EOF\n', 'latin1'));
  return Buffer.concat(chunks);
}

test('formatPrintSessionHeader formats canonical archive + session header and rejects invalid slugs', () => {
  assert.equal(formatPrintSessionHeader('010815'), 'The Seth Tapes · Session 010815');
  assert.equal(formatPrintSessionHeader('  020604-local  '), 'The Seth Tapes · Session 020604-local');
  assert.throws(() => formatPrintSessionHeader(''), RangeError);
  assert.throws(() => formatPrintSessionHeader('   '), RangeError);
  assert.throws(() => formatPrintSessionHeader('..'), RangeError);
});

test('normalizeHttpOrigin accepts valid HTTP(S) origins and rejects invalid/non-HTTP values', () => {
  assert.equal(normalizeHttpOrigin('https://example.org/sessions/010815?foo=1'), 'https://example.org');
  assert.equal(normalizeHttpOrigin('  http://127.0.0.1:3103  '), 'http://127.0.0.1:3103');
  assert.equal(normalizeHttpOrigin(null), null);
  assert.equal(normalizeHttpOrigin(undefined), null);
  assert.equal(normalizeHttpOrigin(''), null);
  assert.equal(normalizeHttpOrigin('null'), null);
  assert.equal(normalizeHttpOrigin('javascript:alert(1)'), null);
  assert.equal(normalizeHttpOrigin('file:///tmp/test.pdf'), null);
  assert.equal(normalizeHttpOrigin('not a url'), null);
});

test('parseToUnicodeCMap decodes bfchar, bfrange (sequential and array), and UTF-16BE punctuation', () => {
  const cmap = parseToUnicodeCMap(`
    beginbfchar
    <0001> <00B7>
    <0002> <2013>
    endbfchar
    beginbfrange
    <0010> <0012> <0041>
    <0020> <0021> [<00660069> <007A>]
    endbfrange
  `);
  assert.equal(cmap.entries.get('0001'), '·');
  assert.equal(cmap.entries.get('0002'), '–');
  assert.equal(cmap.entries.get('0010'), 'A');
  assert.equal(cmap.entries.get('0011'), 'B');
  assert.equal(cmap.entries.get('0012'), 'C');
  assert.equal(cmap.entries.get('0020'), 'fi');
  assert.equal(cmap.entries.get('0021'), 'z');
});

test('extractPdfText extracts FlateDecode + ToUnicode text across multiple pages in exact order and rejects non-PDF buffers', () => {
  const cmap = `
    beginbfchar
    <0001> <0054>
    <0002> <0068>
    <0003> <0065>
    <0004> <0020>
    <0005> <00B7>
    endbfchar
    beginbfrange
    <0010> <0013> <0031>
    endbfrange
  `;
  const pdf = buildSyntheticPdf([
    {
      contentStream: 'BT /F1 12 Tf 1 0 0 1 50 700 Tm [<000100020003> -200 <0005>] TJ ET',
      toUnicodeCMap: cmap,
    },
    {
      contentStream: 'BT /F1 12 Tf 1 0 0 1 50 700 Tm <0010001100120013> Tj ET',
      toUnicodeCMap: cmap,
    },
  ]);

  const extracted = extractPdfText(pdf);
  assert.equal(extracted.pageCount, 2);
  assert.equal(normalizePdfText(extracted.pages[0]), 'The ·');
  assert.equal(normalizePdfText(extracted.pages[1]), '1234');
  assert.equal(normalizePdfText(extracted.text), 'The · 1234');

  // Same-baseline Tm kerning repositioning must not split words with spurious spaces, and NFKC expands ligatures.
  const kernedPdf = buildSyntheticPdf([
    {
      contentStream: 'BT /F1 1 Tf 10.5 0 0 10.5 50 700 Tm <00010002> Tj 10.5 0 0 10.5 72 700 Tm <0003> Tj ET',
      toUnicodeCMap: cmap,
    },
  ]);
  assert.equal(normalizePdfText(extractPdfText(kernedPdf).text), 'The');
  assert.equal(normalizePdfText('independently veri\uFB01ed'), 'independently verified');

  assert.throws(() => extractPdfText(Buffer.from('not a pdf', 'utf8')), /missing %PDF-/);
});
