import { cache } from 'react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { archive } from '@/lib/archive';
import { formatAge } from '@/lib/age';
import {
  type AdjacentSession,
  formatAdjacentAgeSummary,
  getAdjacentSessions,
  getBackToResultsHref,
} from '@/lib/session-reading';
import { findSessionBySlug } from '@/lib/sessions';
import { ARCHIVE_NAME, formatDocumentTitle, formatSessionPageTitle } from '@/lib/site';
import RouteHeader from '@/components/RouteHeader';
import SessionCatalogRecord from '@/components/SessionCatalogRecord';
import SessionPageClient from '@/components/SessionPageClient';
import SessionStickyNav from '@/components/SessionStickyNav';
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

function resolveRequestOrigin(headerList: Headers): string {
  const forwardedHost = headerList.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || headerList.get('host')?.trim() || 'localhost';
  const forwardedProto = headerList.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const proto = forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : 'http';
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return 'http://localhost';
  }
}

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
  if (!lookup.canonical) {
    redirect(`/sessions/${encodeURIComponent(lookup.session.slug)}`);
  }
  const { session } = lookup;

  const rawFrom = Array.isArray(resolvedSearchParams.from)
    ? resolvedSearchParams.from[0]
    : resolvedSearchParams.from;
  const requestOrigin = resolveRequestOrigin(headerList);
  const backToResultsHref = getBackToResultsHref(
    [rawFrom, headerList.get('referer')],
    requestOrigin,
  );

  return (
    <div className="archive-shell">
      <RouteHeader activeSection="sessions" showShare sharePath={`/sessions/${encodeURIComponent(session.slug)}`} />
      <main id="main" tabIndex={-1}>
        <article className="session-detail session-page">
          <header className="detail-header">
            <p className="eyebrow">Session {session.slug}</p>
            <h1>{session.title}</h1>
            <SessionCatalogRecord session={session} />
            {(adjacent.previous || adjacent.next) && (
              <nav className="session-adjacent-nav" aria-label="Adjacent sessions in age order">
                {adjacent.previous && (
                  <a
                    className="session-step-link session-step-prev"
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
                    className="session-step-link session-step-next"
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
          </header>
          <SessionStickyNav initialBackHref={backToResultsHref} />
          <section id="guide" className="guide-overview-section" aria-labelledby="guide-overview-heading">
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
