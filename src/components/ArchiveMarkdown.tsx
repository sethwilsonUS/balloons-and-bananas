'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkNormalizeHeadings, type BaseHeadingLevel } from '../lib/markdown';
import { rewriteLegacyDocumentHref } from '../lib/research';

export interface ArchiveMarkdownProps {
  text: string;
  onSession?: (id: string) => void;
  onDocument?: (id: string) => void;
  sessionSlugs?: Record<string, string>;
  documentTitle?: string;
  baseHeadingLevel?: BaseHeadingLevel;
}

export default function ArchiveMarkdown({
  text,
  onSession,
  onDocument,
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
        if (onSession) {
          return <a href={href} onClick={event => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onSession(decodedSessionId);
          }}>{children}</a>;
        }
        const resolvedSlug = sessionSlugs && Object.hasOwn(sessionSlugs, decodedSessionId)
          ? sessionSlugs[decodedSessionId]
          : undefined;
        return <a href={resolvedSlug ? `/sessions/${encodeURIComponent(resolvedSlug)}` : href}>{children}</a>;
      }
      // Preserve backward compatibility with already-deployed v1 blobs whose markdown still contains `/?document=` links.
      const documentMatch = href?.match(/^(?:\/)?\?document=([^&#]+)/);
      if (documentMatch) {
        let decodedDocId = documentMatch[1];
        try {
          decodedDocId = decodeURIComponent(documentMatch[1]);
        } catch {
          decodedDocId = documentMatch[1];
        }
        if (onDocument) {
          return <a href={href} onClick={event => {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onDocument(decodedDocId);
          }}>{children}</a>;
        }
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
