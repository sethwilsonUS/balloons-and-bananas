import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { ArrowLeft } from 'lucide-react';
import { archive } from '@/lib/archive';
import {
  extractReferencedSessionSlugs,
  findDocumentById,
  formatDocumentCategory,
} from '@/lib/research';
import { ARCHIVE_NAME, formatResearchDocumentPageTitle } from '@/lib/site';
import ResearchDocumentClient from '@/components/ResearchDocumentClient';
import RouteHeader from '@/components/RouteHeader';
import SiteFooter from '@/components/SiteFooter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const loadResearchDocument = cache(async (rawDoc: string) => {
  await connection();
  const data = await archive();
  return {
    lookup: findDocumentById(data.documents, rawDoc),
    sessions: data.sessions,
  };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ doc: string }>;
}): Promise<Metadata> {
  const { doc } = await params;
  const { lookup } = await loadResearchDocument(doc);
  if (!lookup) {
    return {
      title: formatResearchDocumentPageTitle(null),
      description: `Research document not found in ${ARCHIVE_NAME}.`,
    };
  }
  return {
    title: formatResearchDocumentPageTitle(lookup.document.title),
    description: lookup.document.description,
  };
}

export default async function ResearchDocumentPage({
  params,
}: {
  params: Promise<{ doc: string }>;
}) {
  const { doc } = await params;
  const { lookup, sessions } = await loadResearchDocument(doc);
  if (!lookup) {
    notFound();
  }
  if (!lookup.canonical) {
    redirect(`/research/${encodeURIComponent(lookup.document.id)}`);
  }
  const { document } = lookup;
  const sessionSlugs = extractReferencedSessionSlugs(document.markdown, sessions);

  return (
    <div className="archive-shell">
      <RouteHeader
        activeSection="research"
        showShare
        sharePath={`/research/${encodeURIComponent(document.id)}`}
        shareTargetLabel="document"
      />
      <main id="main" tabIndex={-1} className="reading-layout">
        <article className="document-detail document-page reading-column">
          <a className="text-link back-button" href="/research">
            <ArrowLeft size={17} aria-hidden="true" />
            Back to research &amp; context
          </a>
          <header className="detail-header">
            <p className="eyebrow">{formatDocumentCategory(document.category)}</p>
            <h1>{document.title}</h1>
            <p className="section-intro">{document.description}</p>
          </header>
          <ResearchDocumentClient document={document} sessionSlugs={sessionSlugs} />
          <nav className="document-footer-nav" aria-label="Related archive pages">
            <a className="text-link" href="/research">
              <ArrowLeft size={16} aria-hidden="true" />
              All research &amp; context documents
            </a>
            <a className="text-link" href="/about">About &amp; methods</a>
          </nav>
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
