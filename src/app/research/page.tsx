import { cache } from 'react';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { archive } from '@/lib/archive';
import { extractReferencedSessionSlugs, getResearchDocuments } from '@/lib/research';
import { ARCHIVE_NAME, formatDocumentTitle } from '@/lib/site';
import ArchiveAnalytics from '@/components/ArchiveAnalytics';
import ResearchDocumentCard from '@/components/ResearchDocumentCard';
import RouteHeader from '@/components/RouteHeader';
import SiteFooter from '@/components/SiteFooter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: formatDocumentTitle({ kind: 'research' }),
  description: `Research reading list, archive guides, and provenance documentation for ${ARCHIVE_NAME}.`,
};

const loadResearchIndex = cache(async () => {
  await connection();
  const data = await archive();
  return {
    documents: getResearchDocuments(data.documents),
    sessions: data.sessions,
  };
});

export default async function ResearchPage() {
  const { documents, sessions } = await loadResearchIndex();

  return (
    <div className="archive-shell">
      <ArchiveAnalytics ready section="research" sessionId={null} documentId={null} />
      <RouteHeader activeSection="research" />
      <main id="main" tabIndex={-1} className="browsing-layout">
        <section className="research-section research-page" aria-labelledby="research-heading">
          <header className="page-header">
            <p className="eyebrow">Background &amp; provenance</p>
            <h1 id="research-heading">Research &amp; context</h1>
            <p className="section-intro">
              Archival notes, provenance guides, and background scholarship for this collection; see <a href="/about">About &amp; methods</a> for transcript origins, inferred ages, and site methods.
            </p>
          </header>
          <div className="research-documents">
            {documents.map(document => (
              <ResearchDocumentCard
                key={document.id}
                document={document}
                sessionSlugs={extractReferencedSessionSlugs(document.markdown, sessions)}
              />
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
