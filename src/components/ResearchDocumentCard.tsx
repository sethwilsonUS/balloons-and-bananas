'use client';

import { ArrowRight, Download } from 'lucide-react';
import { trackArchiveEvent } from '../lib/analytics';
import { formatDocumentCategory } from '../lib/research';
import type { ArchiveDocument } from '../lib/types';
import ArchiveMarkdown from './ArchiveMarkdown';

export default function ResearchDocumentCard({
  document,
  sessionSlugs,
}: {
  document: ArchiveDocument;
  sessionSlugs?: Record<string, string>;
}) {
  const headingId = `research-doc-${document.id}`;
  const summaryId = `research-read-${document.id}`;
  const docHref = `/research/${encodeURIComponent(document.id)}`;

  return (
    <article className="research-document" aria-labelledby={headingId}>
      <p className="research-document-category small muted">{formatDocumentCategory(document.category)}</p>
      <h2 id={headingId}>
        <a
          href={docHref}
          onClick={() => trackArchiveEvent('research_open', { documentId: document.id, action: 'read' })}
          onAuxClick={event => {
            if (event.button === 1) trackArchiveEvent('research_open', { documentId: document.id, action: 'read' });
          }}
        >
          {document.title}
          <ArrowRight size={19} aria-hidden="true" />
        </a>
      </h2>
      <p>{document.description}</p>
      {document.assets.length > 0 && (
        <div className="document-downloads">
          {document.assets.map(asset => (
            <a
              key={asset.id}
              aria-describedby={headingId}
              href={`/api/assets/${encodeURIComponent(asset.id)}`}
              className="text-link"
              download={asset.name}
              referrerPolicy="no-referrer"
              onClick={() => trackArchiveEvent('research_open', { documentId: document.id, action: 'download', assetId: asset.id })}
              onAuxClick={event => {
                if (event.button === 1) trackArchiveEvent('research_open', { documentId: document.id, action: 'download', assetId: asset.id });
              }}
            >
              <Download size={16} aria-hidden="true" />
              {asset.label}
            </a>
          ))}
        </div>
      )}
      {document.markdown && (
        <details
          className="document-reading"
          onToggle={event => {
            if (event.currentTarget.open) trackArchiveEvent('research_open', { documentId: document.id, action: 'read' });
          }}
        >
          <summary id={summaryId} aria-labelledby={`${summaryId} ${headingId}`}>Read document</summary>
          <ArchiveMarkdown
            text={document.markdown}
            documentTitle={document.title}
            baseHeadingLevel={3}
            sessionSlugs={sessionSlugs}
          />
        </details>
      )}
    </article>
  );
}
