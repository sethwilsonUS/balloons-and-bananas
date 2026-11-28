import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { ArrowLeft } from 'lucide-react';
import { archive } from '@/lib/archive';
import { findSessionBySlug } from '@/lib/sessions';
import { ARCHIVE_NAME, formatDocumentTitle, formatSessionPageTitle } from '@/lib/site';
import RouteHeader from '@/components/RouteHeader';
import SessionCatalogRecord from '@/components/SessionCatalogRecord';
import SessionPageClient from '@/components/SessionPageClient';
import { TopicLabels } from '@/components/TopicThemes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const loadSession = cache(async (rawId: string) => {
  await connection();
  const data = await archive();
  return findSessionBySlug(data.sessions, rawId);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const lookup = await loadSession(id);
  if (!lookup) {
    return {
      title: formatDocumentTitle({ kind: 'session', notFound: true }),
      description: `Session not found in ${ARCHIVE_NAME}.`,
    };
  }
  return {
    title: formatSessionPageTitle(lookup.session),
    description: `Session ${lookup.session.slug} in ${ARCHIVE_NAME}.`,
  };
}

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lookup = await loadSession(id);
  if (!lookup) {
    notFound();
  }
  if (!lookup.canonical) {
    redirect(`/sessions/${encodeURIComponent(lookup.session.slug)}`);
  }
  const { session } = lookup;

  return (
    <div className="archive-shell">
      <RouteHeader activeSection="sessions" showShare sharePath={`/sessions/${encodeURIComponent(session.slug)}`} />
      <main id="main" tabIndex={-1}>
        <article className="session-detail session-page">
          <a className="text-link back-button" href="/?section=sessions">
            <ArrowLeft size={17} aria-hidden="true" />
            Browse &amp; search sessions
          </a>
          <header className="detail-header">
            <p className="eyebrow">Session {session.slug}</p>
            <h1>{session.title}</h1>
            <SessionCatalogRecord session={session} />
          </header>
          <section className="guide-overview-section" aria-labelledby="guide-overview-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">AI-written companion</p>
                <h2 id="guide-overview-heading">Guide overview</h2>
              </div>
              <span className="ai-badge">AI-written guide</span>
            </div>
            <p className="detail-overview">{session.overview}</p>
            <TopicLabels topics={session.topics} />
            <div className="provenance-note">
              <p>
                <strong>About this guide.</strong> This overview, its themes, and its moments were written with AI from the transcript. They are a starting point for exploring the session; they are not part of the source transcript or an independently verified account of the recordings.
              </p>
            </div>
          </section>
          <SessionPageClient session={session} />
        </article>
      </main>
      <footer className="site-footer">
        <div>
          <span className="collection-mark" aria-hidden="true"><span /><span /></span>
          <p>
            {ARCHIVE_NAME}<br />
            <span>An unlisted public archive. Anyone with the link can visit.</span><br />
            <span>Usage analytics exclude search and transcript text.</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
