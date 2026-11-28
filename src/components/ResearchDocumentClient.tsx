'use client';

import { useEffect } from 'react';
import { Download } from 'lucide-react';
import { trackArchiveEvent } from '../lib/analytics';
import type { ArchiveDocument } from '../lib/types';
import ArchiveAnalytics from './ArchiveAnalytics';
import ArchiveMarkdown from './ArchiveMarkdown';

export default function ResearchDocumentClient({
  document,
  sessionSlugs,
}: {
  document: ArchiveDocument;
  sessionSlugs?: Record<string, string>;
}) {
  useEffect(() => {
    trackArchiveEvent('research_open', { documentId: document.id, action: 'read' });
  }, [document.id]);

  return (
    <>
      <ArchiveAnalytics ready section="research" sessionId={null} documentId={document.id} />
      {document.markdown && (
        <ArchiveMarkdown
          text={document.markdown}
          documentTitle={document.title}
          baseHeadingLevel={2}
          sessionSlugs={sessionSlugs}
        />
      )}
      {document.assets.length > 0 && (
        <div className="document-downloads">
          {document.assets.map(asset => (
            <a
              key={asset.id}
              className="button secondary"
              href={`/api/assets/${encodeURIComponent(asset.id)}`}
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
    </>
  );
}
