'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { remarkNormalizeHeadings, type BaseHeadingLevel } from '../lib/markdown';

export interface ArchiveMarkdownProps {
  text: string;
  onEntry: (id: string) => void;
  onDocument?: (id: string) => void;
  documentTitle?: string;
  baseHeadingLevel?: BaseHeadingLevel;
}

export default function ArchiveMarkdown({
  text,
  onEntry,
  onDocument,
  documentTitle,
  baseHeadingLevel = 2,
}: ArchiveMarkdownProps) {
  const tableLabel = documentTitle ? `${documentTitle} table` : 'Scrollable table';

  return <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm, [remarkNormalizeHeadings, { baseHeadingLevel, documentTitle }]]} components={{
    a: ({ href, children }) => {
      const entryMatch = href?.match(/^(?:\/)?\?entry=([^&#]+)/);
      if (entryMatch) {
        return <a href={href} onClick={event => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onEntry(decodeURIComponent(entryMatch[1]));
        }}>{children}</a>;
      }
      const documentMatch = href?.match(/^(?:\/)?\?document=([^&#]+)/);
      if (documentMatch && onDocument) {
        return <a href={href} onClick={event => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onDocument(decodeURIComponent(documentMatch[1]));
        }}>{children}</a>;
      }
      const external = /^https?:\/\//i.test(href || '');
      return <a href={href} rel="noopener noreferrer nofollow" referrerPolicy="no-referrer" target={external ? '_blank' : undefined}>{children}{external && <span className="sr-only"> (opens in a new tab)</span>}</a>;
    },
    img: ({ alt }) => <span className="muted">{alt ? `[Image: ${alt}]` : '[Image omitted]'}</span>,
    table: ({ children }) => <div className="table-scroll" tabIndex={0} role="region" aria-label={tableLabel}><table>{children}</table></div>,
  }}>{text}</ReactMarkdown></div>;
}
