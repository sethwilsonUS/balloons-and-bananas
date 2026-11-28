import { cache } from 'react';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { BookOpen } from 'lucide-react';
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
          <header className="detail-header page-header">
            <p className="eyebrow">Background &amp; provenance</p>
            <div className="page-title-row">
              <h1 id="research-heading">Research &amp; context</h1>
              <BookOpen size={30} strokeWidth={1.3} aria-hidden="true" />
            </div>
            <p className="section-intro">
              Background on the dissertation, the archive, and how to read the material. Document descriptions identify the source; new summaries remain distinct from the original research. For an overview of transcript origins, inferred ages, and site methods, see <a href="/about">About &amp; methods</a>.
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
