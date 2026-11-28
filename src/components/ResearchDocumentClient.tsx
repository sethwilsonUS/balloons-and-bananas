'use client';

import { useEffect, useId, useMemo } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { trackArchiveEvent } from '../lib/analytics';
import type { ArchiveDocument } from '../lib/types';
import ArchiveAnalytics from './ArchiveAnalytics';
import ArchiveMarkdown, { extractMarkdownHeadings } from './ArchiveMarkdown';
import DocumentShareButton from './DocumentShareButton';

export default function ResearchDocumentClient({
  document,
  categoryLabel,
  sessionSlugs,
}: {
  document: ArchiveDocument;
  categoryLabel: string;
  sessionSlugs?: Record<string, string>;
}) {
  const tocHeadingId = useId();
  const headings = useMemo(
    () => (document.markdown
      ? extractMarkdownHeadings(document.markdown, {
        baseHeadingLevel: 2,
        documentTitle: document.title,
      })
      : []),
    [document.markdown, document.title],
  );

  useEffect(() => {
    trackArchiveEvent('research_open', { documentId: document.id, action: 'read' });
  }, [document.id]);

  const sharePath = `/research/${encodeURIComponent(document.id)}`;

  return (
    <article className="document-detail document-page reading-layout">
      <ArchiveAnalytics ready section="research" sessionId={null} documentId={document.id} />

      <div className="reading-header">
        <a className="text-link back-button" href="/research">
          <ArrowLeft size={17} aria-hidden="true" />
          Back to research &amp; context
        </a>
        <header className="detail-header">
          <p className="eyebrow">{categoryLabel}</p>
          <h1>{document.title}</h1>
          <p className="section-intro">{document.description}</p>
        </header>
      </div>

      <div className="reading-sidebar">
        {headings.length > 0 && (
          <nav className="reading-toc" aria-labelledby={tocHeadingId}>
            <p id={tocHeadingId} className="reading-sidebar-heading">On this page</p>
            <ul className="reading-toc-list">
              {headings.map(heading => (
                <li
                  key={heading.id}
                  className={heading.level > 2 ? 'reading-toc-item reading-toc-item--sub' : 'reading-toc-item'}
                >
                  <a href={`#${heading.id}`}>{heading.text}</a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="reading-sidebar-actions">
          {document.assets.length > 0 && (
            <div className="reading-sidebar-group">
              <p className="reading-sidebar-heading">Downloads</p>
              <div className="document-downloads">
                {document.assets.map(asset => (
                  <a
                    key={asset.id}
                    className="text-link"
                    href={`/api/assets/${encodeURIComponent(asset.id)}`}
                    download={asset.name}
                    referrerPolicy="no-referrer"
                    onClick={() => trackArchiveEvent('research_open', { documentId: document.id, action: 'download', assetId: asset.id })}
                    onAuxClick={event => {
                      if (event.button === 1) trackArchiveEvent('research_open', { documentId: document.id, action: 'download', assetId: asset.id });
                    }}
                  >
                    <Download size={16} aria-hidden="true" />
                    <span>{asset.label}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="reading-sidebar-group">
            <DocumentShareButton documentId={document.id} sharePath={sharePath} />
          </div>
        </div>
      </div>

      <div className="reading-column">
        {document.markdown && (
          <ArchiveMarkdown
            text={document.markdown}
            documentTitle={document.title}
            baseHeadingLevel={2}
            sessionSlugs={sessionSlugs}
            generateHeadingIds
          />
        )}
        <nav className="document-footer-nav" aria-label="Related archive pages">
          <a className="text-link" href="/research">
            <ArrowLeft size={16} aria-hidden="true" />
            All research &amp; context documents
          </a>
          <a className="text-link" href="/about">About &amp; methods</a>
        </nav>
      </div>
    </article>
  );
}
