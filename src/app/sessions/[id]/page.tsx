import { cache } from 'react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { archive } from '@/lib/archive';
import { formatAge } from '@/lib/age';
import { resolveServerRequestOrigin } from '@/lib/print';
import {
  type AdjacentSession,
  formatAdjacentAgeSummary,
  getAdjacentSessions,
  resolveBackToResultsUrl,
} from '@/lib/session-reading';
import { findSessionBySlug } from '@/lib/sessions';
import { ARCHIVE_NAME, formatDocumentTitle, formatSessionPageTitle } from '@/lib/site';
import { SessionCiteProvider } from '@/components/CiteControl';
import RecordingAudio from '@/components/RecordingAudio';
import RouteHeader from '@/components/RouteHeader';
import SessionCatalogRecord from '@/components/SessionCatalogRecord';
import SessionPageClient from '@/components/SessionPageClient';
import { SessionPrintCitation, SessionPrintHeader } from '@/components/SessionPrintMeta';
import SessionStickyNav from '@/components/SessionStickyNav';
import SiteFooter from '@/components/SiteFooter';
import { TopicLabels } from '@/components/TopicThemes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const loadSessionContext = cache(async (rawId: string) => {
  await connection();
  const data = await archive();
  const lookup = findSessionBySlug(data.sessions, rawId);
  if (!lookup) return null;
  const adjacent = getAdjacentSessions(data.sessions, lookup.session.slug);
  return { lookup, adjacent };
});

function AdjacentAgeText({ session }: { session: AdjacentSession }) {
  const summary = formatAdjacentAgeSummary(session);
  if (summary.inferred && session.inferredAge) {
    return (
      <>
        {formatAge(session.inferredAge)} ({session.inferredAge}, <em>inferred from filename</em>)
      </>
    );
  }
  return <>{summary.text}</>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await loadSessionContext(id);
  if (!result) {
    return {
      title: formatDocumentTitle({ kind: 'session', notFound: true }),
      description: `Session not found in ${ARCHIVE_NAME}.`,
    };
  }
  return {
    title: formatSessionPageTitle(result.lookup.session),
    description: `Session ${result.lookup.session.slug} in ${ARCHIVE_NAME}.`,
  };
}

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [{ id }, resolvedSearchParams, headerList] = await Promise.all([
    params,
    searchParams,
    headers(),
  ]);
  const result = await loadSessionContext(id);
  if (!result) {
    notFound();
  }
  const { lookup, adjacent } = result;
  const rawFrom = Array.isArray(resolvedSearchParams.from)
    ? resolvedSearchParams.from[0]
    : resolvedSearchParams.from;
  const requestOrigin = resolveServerRequestOrigin(headerList);
  const explicitFrom = resolveBackToResultsUrl(rawFrom, requestOrigin ?? 'http://localhost');
  if (!lookup.canonical) {
    const canonicalPath = `/sessions/${encodeURIComponent(lookup.session.slug)}`;
    redirect(explicitFrom ? `${canonicalPath}?from=${encodeURIComponent(explicitFrom)}` : canonicalPath);
  }
  const { session } = lookup;

  const resolvedBackHref = explicitFrom
    ?? (requestOrigin ? resolveBackToResultsUrl(headerList.get('referer'), requestOrigin) : null);
  const accessDate = new Date().toISOString().slice(0, 10);
  const citationSession = {
    slug: session.slug,
    ages: session.ages,
    inferredAge: session.inferredAge,
    dates: session.dates,
    origin: session.origin,
  };

  return (
    <div className="archive-shell">
      <RouteHeader activeSection="sessions" />
      <main id="main" tabIndex={-1} className="reading-layout session-page">
        <SessionCiteProvider session={citationSession} initialOrigin={requestOrigin}>
          <div className="session-lead">
            <header className="detail-header">
              <SessionPrintHeader slug={session.slug} initialOrigin={requestOrigin} />
              <p className="eyebrow">Session {session.slug}</p>
              <h1>{session.title}</h1>
            </header>
            <RecordingAudio
              key={session.id}
              sessionId={session.id}
              origin={session.origin}
              recordings={session.recordings}
              preferredRecordingId={session.preferredRecordingId}
              headingLevel={2}
            />
          </div>
          <section className="reading-sidebar session-catalog-sidebar" aria-label="Session catalog record">
            <SessionCatalogRecord session={session} />
          </section>
          <article className="session-detail reading-column">
            <SessionStickyNav initialBackHref={resolvedBackHref} adjacent={adjacent} />
            <section id="guide" className="guide-overview-section" aria-labelledby="guide-overview-heading">
              <div className="section-heading">
                <h2 id="guide-overview-heading">Guide overview</h2>
                <a className="ai-badge provenance-link" href="/about#ai-guides">AI-written guide</a>
              </div>
              <p className="detail-overview">{session.overview}</p>
              <TopicLabels topics={session.topics} />
              <p className="small muted guide-provenance-note">
                AI-written from the transcript; not source evidence of what was said.{' '}
                <a href="/about#ai-guides">Learn more</a>
              </p>
            </section>
            <SessionPageClient
              session={session}
              printCitation={
                <SessionPrintCitation
                  session={citationSession}
                  initialOrigin={requestOrigin}
                  initialAccessDate={accessDate}
                />
              }
            />
            {(adjacent.previous || adjacent.next) && (
              <nav className="session-adjacent-nav" aria-label="Adjacent sessions in age order">
                {adjacent.previous && (
                  <a
                    className="button secondary session-step-link session-step-prev"
                    href={`/sessions/${encodeURIComponent(adjacent.previous.slug)}`}
                  >
                    <span className="session-step-direction">
                      <ArrowLeft size={16} aria-hidden="true" />
                      Previous session
                    </span>
                    <span className="session-step-target">
                      <code className="session-step-slug">{adjacent.previous.slug}</code>
                      <span className="session-step-age">
                        <AdjacentAgeText session={adjacent.previous} />
                      </span>
                    </span>
                  </a>
                )}
                {adjacent.next && (
                  <a
                    className="button secondary session-step-link session-step-next"
                    href={`/sessions/${encodeURIComponent(adjacent.next.slug)}`}
                  >
                    <span className="session-step-direction">
                      Next session
                      <ArrowRight size={16} aria-hidden="true" />
                    </span>
                    <span className="session-step-target">
                      <code className="session-step-slug">{adjacent.next.slug}</code>
                      <span className="session-step-age">
                        <AdjacentAgeText session={adjacent.next} />
                      </span>
                    </span>
                  </a>
                )}
              </nav>
            )}
          </article>
        </SessionCiteProvider>
      </main>
      <SiteFooter />
    </div>
  );
}
