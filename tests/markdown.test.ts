import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ArchiveMarkdown from '../src/components/ArchiveMarkdown';
import { normalizeHeadingDepths, stripDuplicateLeadingHeading } from '../src/lib/markdown';

test('stripDuplicateLeadingHeading removes leading H1 matching document title across normalization variants', () => {
  assert.equal(
    stripDuplicateLeadingHeading('# Fixture guide\n\nBody paragraph.', 'Fixture guide'),
    'Body paragraph.',
  );
  assert.equal(
    stripDuplicateLeadingHeading('\uFEFF\n#  Fixture   Guide ##\n\n## Section\nText', 'fixture guide'),
    '## Section\nText',
  );
  assert.equal(
    stripDuplicateLeadingHeading('Bob’s “notes” — draft\n===\n\nParagraph.', 'Bob\'s "notes" - draft'),
    'Paragraph.',
  );
  // Preserves distinct leading headings and non-leading headings
  const distinct = '# Companion subtitle\n\nBody paragraph.';
  assert.equal(stripDuplicateLeadingHeading(distinct, 'Different document title'), distinct);

  const nonLeading = 'Intro line.\n\n# Fixture guide\n\nBody.';
  assert.equal(stripDuplicateLeadingHeading(nonLeading, 'Fixture guide'), nonLeading);

  const h2Leading = '## Fixture guide\n\nBody.';
  assert.equal(stripDuplicateLeadingHeading(h2Leading, 'Fixture guide'), h2Leading);
});

test('normalizeHeadingDepths preserves consecutive nesting, collapses source gaps, and clamps at h6', () => {
  // Ordinary consecutive headings at base 3: ## -> ### -> ### -> ## -> ###
  assert.deepEqual(normalizeHeadingDepths([2, 3, 3, 2, 3], 3), [3, 4, 4, 3, 4]);

  // Source gap (## followed by ####) normalizes to h3 -> h4 instead of skipping to h5
  assert.deepEqual(normalizeHeadingDepths([2, 4], 3), [3, 4]);
  assert.deepEqual(normalizeHeadingDepths([2, 4, 5, 3], 3), [3, 4, 5, 4]);

  // Research card (base 4) clamps cleanly at h6
  assert.deepEqual(normalizeHeadingDepths([1, 2, 3, 4, 5], 4), [4, 5, 6, 6, 6]);

  // Kept leading H1 followed by H2 at base 3 -> h3 -> h4
  assert.deepEqual(normalizeHeadingDepths([1, 2], 3), [3, 4]);
});

test('ArchiveMarkdown normalizes container headings (block quotes), closes source gaps, and ignores code-block hashes', () => {
  const quoted = [
    '```markdown',
    '# Hash inside fenced code block',
    '```',
    '',
    '> ## Quoted section',
    '',
    '#### Skipped depth subsection',
  ].join('\n');

  const html = renderToStaticMarkup(
    createElement(ArchiveMarkdown, {
      text: quoted,
      baseHeadingLevel: 3,
      onSession: () => {},
    }),
  );

  // Quoted H2 becomes h3 (no skip from document h2 to h4), and #### becomes h4 (no skip to h5)
  assert.match(html, /<blockquote>\s*<h3>Quoted section<\/h3>\s*<\/blockquote>/);
  assert.match(html, /<h4>Skipped depth subsection<\/h4>/);
  assert.doesNotMatch(html, /<h1\b|<h2\b|<h5\b/i);
  assert.match(html, /<code[^>]*># Hash inside fenced code block/);
});

test('ArchiveMarkdown sets footnote heading level to baseHeadingLevel and preserves leading titles with footnote references', () => {
  const withBodyFootnote = [
    '# Plain synthetic title',
    '',
    'A body note[^1].',
    '',
    '[^1]: Synthetic source attribution.',
  ].join('\n');

  const bodyHtml = renderToStaticMarkup(
    createElement(ArchiveMarkdown, {
      text: withBodyFootnote,
      documentTitle: 'Plain synthetic title',
      baseHeadingLevel: 3,
      onSession: () => {},
    }),
  );

  assert.doesNotMatch(bodyHtml, /Plain synthetic title<\/h/i);
  assert.doesNotMatch(bodyHtml, /<h2\b/i);
  assert.match(bodyHtml, /<h3\b[^>]*id="footnote-label"[^>]*>Footnotes<\/h3>/);
  assert.match(bodyHtml, /Synthetic source attribution\./);

  const withTitleFootnote = [
    '# Synthetic titled note[^1]',
    '',
    'Body text.',
    '',
    '[^1]: Attribution attached to title.',
  ].join('\n');

  const titleHtml = renderToStaticMarkup(
    createElement(ArchiveMarkdown, {
      text: withTitleFootnote,
      documentTitle: 'Synthetic titled note',
      baseHeadingLevel: 4,
      onSession: () => {},
    }),
  );

  // Leading heading with footnoteReference is kept (shifted to h4) so the footnote definition is not lost
  assert.match(titleHtml, /<h4>Synthetic titled note<sup\b/);
  assert.match(titleHtml, /<h4\b[^>]*id="footnote-label"[^>]*>Footnotes<\/h4>/);
  assert.match(titleHtml, /Attribution attached to title\./);
  assert.doesNotMatch(titleHtml, /<h1\b|<h2\b|<h3\b/i);
});

test('ArchiveMarkdown strips duplicate leading heading, keeps heading hierarchy intact, and renders escaped pipes in GFM table code spans as 3 intact columns', () => {
  const markdown = [
    '# Synthetic provenance table guide',
    '',
    '## Layer comparison',
    '',
    '| Layer | Delimiter example | Provenance note |',
    '| --- | --- | --- |',
    '| Research speech | `[/]` and `(.)` | Synthetic source utterance layer. |',
    '| Editorial note | A line starting `[[SYNTHETIC COMMENT \\|` and ending `\\| END SYNTHETIC COMMENT]]` | Separate editorial note, not source speech. |',
    '',
    '### Details',
    '',
    'Additional synthetic details.',
  ].join('\n');

  const html = renderToStaticMarkup(
    createElement(ArchiveMarkdown, {
      text: markdown,
      documentTitle: 'Synthetic provenance table guide',
      baseHeadingLevel: 3,
      onSession: () => {},
    }),
  );

  // Duplicate leading H1 is stripped; no <h1> or <h2> rendered inside document-detail markdown
  assert.doesNotMatch(html, /Synthetic provenance table guide<\/h/i);
  assert.doesNotMatch(html, /<h1\b/i);
  assert.doesNotMatch(html, /<h2\b/i);
  assert.match(html, /<h3>Layer comparison<\/h3>/);
  assert.match(html, /<h4>Details<\/h4>/);

  // Table region carries document-specific accessible label
  assert.match(html, /aria-label="Synthetic provenance table guide table"/);

  // Header has exactly 3 columns
  const thMatches = html.match(/<th>/g) ?? [];
  assert.equal(thMatches.length, 3);

  // Both rows have exactly 3 intact <td> cells, with literal pipes inside <code> spans
  const rowMatches = [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)];
  assert.equal(rowMatches.length, 1);
  const rows = [...rowMatches[0][1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => m[1]);
  assert.equal(rows.length, 2);

  for (const row of rows) {
    const cells = [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(m => m[1]);
    assert.equal(cells.length, 3, `Expected 3 intact table cells, got ${cells.length}: ${row}`);
  }

  const editorialCells = [...rows[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map(m => m[1]);
  assert.equal(editorialCells[0], 'Editorial note');
  assert.match(editorialCells[1], /<code>\[\[SYNTHETIC COMMENT \|<\/code> and ending <code>\| END SYNTHETIC COMMENT\]\]<\/code>/);
  assert.equal(editorialCells[2], 'Separate editorial note, not source speech.');
});
