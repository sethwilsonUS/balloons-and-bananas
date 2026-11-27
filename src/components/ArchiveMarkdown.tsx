'use client';

import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { minMarkdownHeadingLevel, resolveMarkdownHeadingLevel, stripDuplicateLeadingHeading } from '../lib/markdown';

export interface ArchiveMarkdownProps {
  text: string;
  onEntry: (id: string) => void;
  onDocument?: (id: string) => void;
  documentTitle?: string;
  baseHeadingLevel?: 2 | 3 | 4;
}

export default function ArchiveMarkdown({
  text,
  onEntry,
  onDocument,
  documentTitle,
  baseHeadingLevel = 2,
}: ArchiveMarkdownProps) {
  const preparedText = stripDuplicateLeadingHeading(text, documentTitle);
  const minLevel = minMarkdownHeadingLevel(preparedText);
  const tableLabel = documentTitle ? `${documentTitle} table` : 'Scrollable table';

  const renderHeading = (level: 1 | 2 | 3 | 4 | 5 | 6, children: ReactNode) => {
    const Tag = `h${resolveMarkdownHeadingLevel(level, baseHeadingLevel, minLevel)}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
    return <Tag>{children}</Tag>;
  };

  return <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
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
    h1: ({ children }) => renderHeading(1, children),
    h2: ({ children }) => renderHeading(2, children),
    h3: ({ children }) => renderHeading(3, children),
    h4: ({ children }) => renderHeading(4, children),
    h5: ({ children }) => renderHeading(5, children),
    h6: ({ children }) => renderHeading(6, children),
    table: ({ children }) => <div className="table-scroll" tabIndex={0} role="region" aria-label={tableLabel}><table>{children}</table></div>,
  }}>{preparedText}</ReactMarkdown></div>;
}
