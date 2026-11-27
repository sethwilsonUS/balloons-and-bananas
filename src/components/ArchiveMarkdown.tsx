'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function ArchiveMarkdown({ text, onEntry, onDocument }: { text: string; onEntry: (id: string) => void; onDocument?: (id: string) => void }) {
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
    h1: ({ children }) => <h2>{children}</h2>,
    h2: ({ children }) => <h3>{children}</h3>,
    h3: ({ children }) => <h4>{children}</h4>,
    table: ({ children }) => <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable table"><table>{children}</table></div>,
  }}>{text}</ReactMarkdown></div>;
}
