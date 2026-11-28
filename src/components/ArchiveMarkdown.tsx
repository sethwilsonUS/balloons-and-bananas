import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  rehypeHeadingIds,
  remarkNormalizeHeadings,
  type BaseHeadingLevel,
  type HtmlHeadingLevel,
  type MarkdownHeading,
} from '../lib/markdown';
import { rewriteLegacyDocumentHref } from '../lib/research';

export interface ArchiveMarkdownProps {
  text: string;
  sessionSlugs?: Record<string, string>;
  documentTitle?: string;
  baseHeadingLevel?: BaseHeadingLevel;
  /** Assign stable, unique `id` attributes on rendered headings for in-page navigation. */
  generateHeadingIds?: boolean;
}

function getTocHeadingLevels(baseHeadingLevel: BaseHeadingLevel): HtmlHeadingLevel[] {
  if (baseHeadingLevel === 2) return [2, 3];
  if (baseHeadingLevel === 3) return [3, 4];
  return [4, 5];
}

/**
 * Extract the "On this page" section headings using the exact same CommonMark +
 * GFM + heading-normalization + rehype ID pipeline used by `<ArchiveMarkdown />`.
 */
export function extractMarkdownHeadings(
  text: string,
  options: {
    documentTitle?: string;
    baseHeadingLevel?: BaseHeadingLevel;
  } = {},
): MarkdownHeading[] {
  if (!text.trim()) return [];
  const baseHeadingLevel = options.baseHeadingLevel ?? 2;
  let headings: MarkdownHeading[] = [];
  ReactMarkdown({
    children: text,
    remarkPlugins: [
      remarkGfm,
      [remarkNormalizeHeadings, { baseHeadingLevel, documentTitle: options.documentTitle }],
    ],
    remarkRehypeOptions: { footnoteLabelTagName: `h${baseHeadingLevel}` },
    rehypePlugins: [
      [
        rehypeHeadingIds,
        {
          includeLevels: getTocHeadingLevels(baseHeadingLevel),
          onCollect: (collected: MarkdownHeading[]) => {
            headings = collected;
          },
        },
      ],
    ],
  });
  return headings;
}

export default function ArchiveMarkdown({
  text,
  sessionSlugs,
  documentTitle,
  baseHeadingLevel = 2,
  generateHeadingIds = false,
}: ArchiveMarkdownProps) {
  const tableLabel = documentTitle ? `${documentTitle} table` : 'Scrollable table';

  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkNormalizeHeadings, { baseHeadingLevel, documentTitle }]]}
        remarkRehypeOptions={{ footnoteLabelTagName: `h${baseHeadingLevel}` }}
        rehypePlugins={generateHeadingIds ? [[rehypeHeadingIds, {}]] : undefined}
        components={{
          a: ({ href, children }) => {
            // Legacy `?entry=` query links remain supported for session links inside archive documents.
            const sessionMatch = href?.match(/^(?:\/)?\?entry=([^&#]+)/);
            if (sessionMatch) {
              let decodedSessionId = sessionMatch[1];
              try {
                decodedSessionId = decodeURIComponent(sessionMatch[1]);
              } catch {
                decodedSessionId = sessionMatch[1];
              }
              const resolvedSlug = sessionSlugs && Object.hasOwn(sessionSlugs, decodedSessionId)
                ? sessionSlugs[decodedSessionId]
                : undefined;
              const fallbackHref = href && !href.startsWith('/') ? `/${href}` : href;
              return <a href={resolvedSlug ? `/sessions/${encodeURIComponent(resolvedSlug)}` : fallbackHref}>{children}</a>;
            }
            // Preserve backward compatibility with already-deployed v1 blobs whose markdown still contains `/?document=` links.
            const documentMatch = href?.match(/^(?:\/)?\?document=([^&#]+)/);
            if (documentMatch) {
              const rewritten = href ? rewriteLegacyDocumentHref(href) : null;
              return <a href={rewritten ?? href}>{children}</a>;
            }
            const external = /^https?:\/\//i.test(href || '');
            if (external) {
              return <a href={href} rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" target="_blank">{children}<span className="sr-only"> (opens in a new tab)</span></a>;
            }
            return <a href={href}>{children}</a>;
          },
          img: ({ alt }) => <span className="muted">{alt ? `[Image: ${alt}]` : '[Image omitted]'}</span>,
          table: ({ children }) => <div className="table-scroll" tabIndex={0} role="region" aria-label={tableLabel}><table>{children}</table></div>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
