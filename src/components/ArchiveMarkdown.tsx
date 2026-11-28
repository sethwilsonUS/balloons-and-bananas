import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkNormalizeHeadings, type BaseHeadingLevel } from '../lib/markdown';
import { rewriteLegacyDocumentHref } from '../lib/research';

export interface ArchiveMarkdownProps {
  text: string;
  sessionSlugs?: Record<string, string>;
  documentTitle?: string;
  baseHeadingLevel?: BaseHeadingLevel;
}

export default function ArchiveMarkdown({
  text,
  sessionSlugs,
  documentTitle,
  baseHeadingLevel = 2,
}: ArchiveMarkdownProps) {
  const tableLabel = documentTitle ? `${documentTitle} table` : 'Scrollable table';

  return <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm, [remarkNormalizeHeadings, { baseHeadingLevel, documentTitle }]]} remarkRehypeOptions={{ footnoteLabelTagName: `h${baseHeadingLevel}` }} components={{
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
  }}>{text}</ReactMarkdown></div>;
}
