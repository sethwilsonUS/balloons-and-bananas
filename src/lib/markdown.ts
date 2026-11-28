export type BaseHeadingLevel = 2 | 3 | 4;
export type HtmlHeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface MarkdownHeading {
  id: string;
  text: string;
  level: HtmlHeadingLevel;
}

const LEADING_ATX_H1_RE = /^\uFEFF?(?:[ \t]*\r?\n)* {0,3}#[ \t]+([^\r\n]+?)(?:[ \t]+#+[ \t]*)?(?:\r?\n|$)/;
const LEADING_SETEXT_H1_RE = /^\uFEFF?(?:[ \t]*\r?\n)* {0,3}([^\r\n]+?)[ \t]*\r?\n {0,3}=+[ \t]*(?:\r?\n|$)/;

interface MdastNode {
  type: string;
  depth?: number;
  value?: string;
  children?: MdastNode[];
}

interface HastProperties {
  id?: unknown;
  dataFootnoteRef?: unknown;
  [key: string]: unknown;
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: HastProperties;
  children?: HastNode[];
}

export interface NormalizeHeadingsOptions {
  baseHeadingLevel?: BaseHeadingLevel;
  documentTitle?: string;
}

export interface RehypeHeadingIdsOptions {
  reservedIds?: readonly string[];
  includeLevels?: readonly HtmlHeadingLevel[];
  onCollect?: (headings: MarkdownHeading[]) => void;
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
      : clampHtmlHeadingLevel(stack[stack.length - 1].normalizedDepth + 1);
    stack.push({ sourceDepth, normalizedDepth: nextDepth });
    result.push(nextDepth);
  }

  return result;
}

function clampHtmlHeadingLevel(depth: number): HtmlHeadingLevel {
  if (depth <= 2) return 2;
  if (depth === 3) return 3;
  if (depth === 4) return 4;
  if (depth === 5) return 5;
  return 6;
}

function headingLevelFromTagName(tagName: string | undefined): HtmlHeadingLevel | null {
  switch (tagName) {
    case 'h2':
      return 2;
    case 'h3':
      return 3;
    case 'h4':
      return 4;
    case 'h5':
      return 5;
    case 'h6':
      return 6;
    default:
      return null;
  }
}

/** Convert heading text into a deterministic, URL-safe anchor slug. */
export function slugifyHeading(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’‘]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isFootnoteReferenceElement(node: HastNode): boolean {
  if (node.type !== 'element') return false;
  if (node.properties && node.properties.dataFootnoteRef !== undefined) return true;
  if (node.tagName === 'sup' && Array.isArray(node.children)) {
    return node.children.some(child => isFootnoteReferenceElement(child));
  }
  return false;
}

function extractHastHeadingText(node: HastNode): string {
  if (isFootnoteReferenceElement(node)) return '';
  if (node.type === 'text' && typeof node.value === 'string') return node.value;
  if (!Array.isArray(node.children)) return '';
  return node.children.map(extractHastHeadingText).join('');
}

function collectExistingHastIds(node: HastNode, usedIds: Set<string>): void {
  if (node.type === 'element' && node.properties && typeof node.properties.id === 'string') {
    const existing = node.properties.id.trim();
    if (existing) usedIds.add(existing);
  }
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) {
    collectExistingHastIds(child, usedIds);
  }
}

function allocateUniqueId(baseSlug: string, usedIds: Set<string>): string {
  const stem = baseSlug || 'section';
  if (!usedIds.has(stem)) {
    usedIds.add(stem);
    return stem;
  }
  let suffix = 2;
  while (usedIds.has(`${stem}-${suffix}`)) {
    suffix += 1;
  }
  const unique = `${stem}-${suffix}`;
  usedIds.add(unique);
  return unique;
}

/**
 * Rehype plugin that assigns stable, unique anchor `id` attributes to every
 * rendered markdown heading (`h2`–`h6`), preserves downstream generated IDs
 * (such as GFM `footnote-label`), avoids colliding with page landmarks like
 * `#main`, and optionally reports top-level document headings for "On this page".
 */
export function rehypeHeadingIds(options: RehypeHeadingIdsOptions = {}) {
  const reservedIds = options.reservedIds ?? ['main'];
  const includeLevels = options.includeLevels;
  const onCollect = options.onCollect;

  return (tree: HastNode) => {
    const usedIds = new Set<string>(reservedIds);
    collectExistingHastIds(tree, usedIds);

    const collected: MarkdownHeading[] = [];

    const visitNode = (node: HastNode, inBlockquote: boolean) => {
      if (node.type === 'element') {
        const level = headingLevelFromTagName(node.tagName);
        if (level !== null) {
          const text = extractHastHeadingText(node).replace(/\s+/g, ' ').trim();
          const existingId = node.properties && typeof node.properties.id === 'string'
            ? node.properties.id.trim()
            : '';
          const id = existingId || allocateUniqueId(slugifyHeading(text), usedIds);
          if (!existingId) {
            node.properties = {
              ...(node.properties ?? {}),
              id,
            };
          }
          const levelIncluded = !includeLevels || includeLevels.includes(level);
          if (!inBlockquote && text && levelIncluded) {
            collected.push({ id, text, level });
          }
          return;
        }
      }

      if (!Array.isArray(node.children)) return;
      const nextInBlockquote = inBlockquote || (node.type === 'element' && node.tagName === 'blockquote');
      for (const child of node.children) {
        visitNode(child, nextInBlockquote);
      }
    };

    visitNode(tree, false);
    onCollect?.(collected);
  };
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
