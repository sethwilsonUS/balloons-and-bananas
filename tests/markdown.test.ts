import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ArchiveMarkdown from '../src/components/ArchiveMarkdown';
import { minMarkdownHeadingLevel, resolveMarkdownHeadingLevel, stripDuplicateLeadingHeading } from '../src/lib/markdown';

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

test('minMarkdownHeadingLevel ignores headings inside fenced code blocks and detects ATX/Setext levels', () => {
  const md = [
    'Intro text.',
    '```markdown',
    '# Not a real heading',
    '```',
    '## First real section',
    '### Subsection',
  ].join('\n');
  assert.equal(minMarkdownHeadingLevel(md), 2);

  assert.equal(minMarkdownHeadingLevel('Subtitle\n---\n\nText.'), 2);
  assert.equal(minMarkdownHeadingLevel('Title\n===\n\nText.'), 1);
  assert.equal(minMarkdownHeadingLevel('Plain text only.\n\n---\n\nAfter rule.'), 1);
});

test('resolveMarkdownHeadingLevel shifts heading depth without skipping levels or emitting h1', () => {
  // Stripped leading H1 -> minLevel=2; document detail uses baseHeadingLevel=3
  assert.equal(resolveMarkdownHeadingLevel(2, 3, 2), 3);
  assert.equal(resolveMarkdownHeadingLevel(3, 3, 2), 4);
  assert.equal(resolveMarkdownHeadingLevel(4, 3, 2), 5);
  assert.equal(resolveMarkdownHeadingLevel(6, 3, 2), 6);

  // Kept leading H1 -> minLevel=1; document detail uses baseHeadingLevel=3
  assert.equal(resolveMarkdownHeadingLevel(1, 3, 1), 3);
  assert.equal(resolveMarkdownHeadingLevel(2, 3, 1), 4);

  // Research reading card uses baseHeadingLevel=4
  assert.equal(resolveMarkdownHeadingLevel(2, 4, 2), 4);
  assert.equal(resolveMarkdownHeadingLevel(3, 4, 2), 5);
  assert.equal(resolveMarkdownHeadingLevel(5, 4, 2), 6);
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
      onEntry: () => {},
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
