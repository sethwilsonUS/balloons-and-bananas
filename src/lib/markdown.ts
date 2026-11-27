const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const ATX_HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;
const LEADING_ATX_H1_RE = /^\uFEFF?(?:[ \t]*\r?\n)* {0,3}#[ \t]+([^\r\n]+?)(?:[ \t]+#+[ \t]*)?(?:\r?\n|$)/;
const LEADING_SETEXT_H1_RE = /^\uFEFF?(?:[ \t]*\r?\n)* {0,3}([^\r\n]+?)[ \t]*\r?\n {0,3}=+[ \t]*(?:\r?\n|$)/;

function normalizeHeadingText(value: string): string {
  return value
    .replace(/[`*_~]/g, '')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Strip a leading markdown H1 heading when it duplicates the document title
 * already rendered by the surrounding reader UI.
 */
export function stripDuplicateLeadingHeading(markdown: string, documentTitle?: string): string {
  if (!documentTitle?.trim()) return markdown;
  const target = normalizeHeadingText(documentTitle);
  if (!target) return markdown;

  const atxMatch = LEADING_ATX_H1_RE.exec(markdown);
  if (atxMatch && normalizeHeadingText(atxMatch[1]) === target) {
    return markdown.slice(atxMatch[0].length).replace(/^(?:[ \t]*\r?\n)+/, '');
  }

  const setextMatch = LEADING_SETEXT_H1_RE.exec(markdown);
  if (setextMatch && !setextMatch[1].trimStart().startsWith('#') && normalizeHeadingText(setextMatch[1]) === target) {
    return markdown.slice(setextMatch[0].length).replace(/^(?:[ \t]*\r?\n)+/, '');
  }

  return markdown;
}

/**
 * Find the highest-level (smallest numeric depth, 1–6) markdown heading present
 * outside fenced code blocks so heading shifts never skip levels.
 */
export function minMarkdownHeadingLevel(markdown: string): 1 | 2 | 3 | 4 | 5 | 6 {
  const lines = markdown.split(/\r?\n/);
  let fenceChar = '';
  let fenceLength = 0;
  let minLevel = 7;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1];
      if (!fenceChar) {
        fenceChar = marker[0];
        fenceLength = marker.length;
        continue;
      }
      if (marker[0] === fenceChar && marker.length >= fenceLength && line.trim().length === marker.length) {
        fenceChar = '';
        fenceLength = 0;
        continue;
      }
    }
    if (fenceChar) continue;

    const atx = ATX_HEADING_RE.exec(line);
    if (atx) {
      minLevel = Math.min(minLevel, atx[1].length);
      if (minLevel === 1) return 1;
      continue;
    }

    if (
      i + 1 < lines.length
      && line.trim().length > 0
      && !/^ {0,3}(?:>|- |\* |\+ |\d+\. |\||```|~~~)/.test(line)
      && /^ {0,3}(=+|-+)[ \t]*$/.test(lines[i + 1])
    ) {
      const level = lines[i + 1].trimStart()[0] === '=' ? 1 : 2;
      minLevel = Math.min(minLevel, level);
      if (minLevel === 1) return 1;
      i += 1;
    }
  }

  return (minLevel >= 1 && minLevel <= 6 ? minLevel : 1) as 1 | 2 | 3 | 4 | 5 | 6;
}

export function resolveMarkdownHeadingLevel(
  markdownLevel: 1 | 2 | 3 | 4 | 5 | 6,
  baseHeadingLevel: 2 | 3 | 4 = 2,
  minLevel: 1 | 2 | 3 | 4 | 5 | 6 = 1,
): 2 | 3 | 4 | 5 | 6 {
  const offset = Math.max(0, markdownLevel - minLevel);
  const resolved = Math.min(6, Math.max(2, baseHeadingLevel + offset));
  return resolved as 2 | 3 | 4 | 5 | 6;
}
