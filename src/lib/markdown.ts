export type BaseHeadingLevel = 2 | 3 | 4;
export type HtmlHeadingLevel = 2 | 3 | 4 | 5 | 6;

const LEADING_ATX_H1_RE = /^\uFEFF?(?:[ \t]*\r?\n)* {0,3}#[ \t]+([^\r\n]+?)(?:[ \t]+#+[ \t]*)?(?:\r?\n|$)/;
const LEADING_SETEXT_H1_RE = /^\uFEFF?(?:[ \t]*\r?\n)* {0,3}([^\r\n]+?)[ \t]*\r?\n {0,3}=+[ \t]*(?:\r?\n|$)/;

interface MdastNode {
  type: string;
  depth?: number;
  value?: string;
  children?: MdastNode[];
}

export interface NormalizeHeadingsOptions {
  baseHeadingLevel?: BaseHeadingLevel;
  documentTitle?: string;
}

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

function extractNodeText(node: MdastNode): string {
  if (typeof node.value === 'string') return node.value;
  if (!Array.isArray(node.children)) return '';
  return node.children.map(extractNodeText).join('');
}

function containsFootnoteReference(node: MdastNode): boolean {
  if (node.type === 'footnoteReference') return true;
  if (!Array.isArray(node.children)) return false;
  return node.children.some(containsFootnoteReference);
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
 * Normalize a sequence of parsed markdown heading depths (1–6) starting at
 * baseHeadingLevel (2–4) without skipping levels or exceeding h6.
 */
export function normalizeHeadingDepths(
  sourceDepths: readonly number[],
  baseHeadingLevel: BaseHeadingLevel = 2,
): HtmlHeadingLevel[] {
  const stack: Array<{ sourceDepth: number; normalizedDepth: HtmlHeadingLevel }> = [];
  const result: HtmlHeadingLevel[] = [];

  for (const rawDepth of sourceDepths) {
    const sourceDepth = Math.min(6, Math.max(1, Math.trunc(rawDepth)));
    while (stack.length > 0 && stack[stack.length - 1].sourceDepth >= sourceDepth) {
      stack.pop();
    }
    const nextDepth: HtmlHeadingLevel = stack.length === 0
      ? baseHeadingLevel
      : (Math.min(6, stack[stack.length - 1].normalizedDepth + 1) as HtmlHeadingLevel);
    stack.push({ sourceDepth, normalizedDepth: nextDepth });
    result.push(nextDepth);
  }

  return result;
}

function collectHeadingNodes(node: MdastNode, headings: MdastNode[]): void {
  if (node.type === 'heading' && typeof node.depth === 'number') {
    headings.push(node);
    return;
  }
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) {
    collectHeadingNodes(child, headings);
  }
}

/**
 * Remark plugin that strips a leading H1 duplicating documentTitle and
 * normalizes all parsed heading nodes (including inside block quotes and lists,
 * while naturally ignoring code blocks) so rendered heading levels never skip
 * levels, never emit h1, and never exceed h6.
 */
export function remarkNormalizeHeadings(options: NormalizeHeadingsOptions = {}) {
  const baseHeadingLevel = options.baseHeadingLevel ?? 2;
  const targetTitle = options.documentTitle?.trim() ? normalizeHeadingText(options.documentTitle) : '';

  return (tree: MdastNode) => {
    if (targetTitle && Array.isArray(tree.children) && tree.children.length > 0) {
      const first = tree.children[0];
      if (
        first.type === 'heading'
        && first.depth === 1
        && !containsFootnoteReference(first)
        && normalizeHeadingText(extractNodeText(first)) === targetTitle
      ) {
        tree.children.shift();
      }
    }

    const headings: MdastNode[] = [];
    collectHeadingNodes(tree, headings);
    const normalized = normalizeHeadingDepths(
      headings.map(heading => heading.depth ?? 1),
      baseHeadingLevel,
    );
    for (let i = 0; i < headings.length; i += 1) {
      headings[i].depth = normalized[i];
    }
  };
}
