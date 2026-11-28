import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { connection } from 'next/server';
import { ArrowRight, Bookmark, BookOpen, CalendarRange, Search } from 'lucide-react';
import ArchiveAnalytics from '@/components/ArchiveAnalytics';
import RouteHeader from '@/components/RouteHeader';
import SiteFooter from '@/components/SiteFooter';
import { ThemeShortcutLinks } from '@/components/TopicThemes';
import { archive, catalog } from '@/lib/archive';
import {
  countAvailableCuratedThemes,
  formatBrowseByAgeDescription,
  formatCount,
  summarizeHomepageAgeSpan,
} from '@/lib/homepage';
import {
  classifyLegacyRootRequest,
  isSafeRootRelativeDestination,
  resolveLegacyDocumentTarget,
  resolveLegacyEntryTarget,
  type LegacyRedirectResolution,
} from '@/lib/legacy-redirects';
import {
  ARCHIVE_NAME,
  ARCHIVE_SUBTITLE,
  formatDocumentTitle,
  formatResearchDocumentPageTitle,
} from '@/lib/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const resolveArchiveLegacyLookup = cache(
  async (
    kind: 'entry' | 'document',
    rawId: string,
    passage: number | null,
    from: string | null,
  ): Promise<Exclude<LegacyRedirectResolution, { kind: 'none' }>> => {
    await connection();
    const data = await archive();
    if (kind === 'entry') {
      return resolveLegacyEntryTarget(data.sessions, rawId, passage, from);
    }
    return resolveLegacyDocumentTarget(data.documents, rawId);
  },
);

async function resolveLegacyRoot(
  params: Record<string, string | string[] | undefined>,
): Promise<LegacyRedirectResolution> {
  const intent = classifyLegacyRootRequest(params);
  if (intent.kind === 'none') {
    return { kind: 'none' };
  }
  if (intent.kind === 'marker' || intent.kind === 'section') {
    return { kind: 'redirect', destination: intent.destination };
  }
  if (intent.kind === 'entry') {
    return resolveArchiveLegacyLookup('entry', intent.rawId, intent.passage, intent.from);
  }
  return resolveArchiveLegacyLookup('document', intent.rawId, null, null);
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  await connection();
  const resolved = await resolveLegacyRoot(await searchParams);
  if (resolved.kind === 'not-found') {
    return resolved.entity === 'document'
      ? {
          title: formatResearchDocumentPageTitle(null),
          description: `Research document not found in ${ARCHIVE_NAME}.`,
        }
      : {
          title: formatDocumentTitle({ kind: 'session', notFound: true }),
          description: `Session not found in ${ARCHIVE_NAME}.`,
        };
  }
  return {
    title: ARCHIVE_NAME,
    description: `${ARCHIVE_SUBTITLE}.`,
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const params = await searchParams;
  const resolved = await resolveLegacyRoot(params);
  if (resolved.kind === 'redirect' && isSafeRootRelativeDestination(resolved.destination)) {
    permanentRedirect(resolved.destination);
  }
  if (resolved.kind === 'not-found') {
    notFound();
  }

  const data = await archive();
  const summary = catalog(data);
  const researchDocumentCount = summary.documents.filter(doc => doc.category !== 'overview').length;
  const ageSpan = summarizeHomepageAgeSpan(data.sessions);
  const browseByAgeDescription = formatBrowseByAgeDescription(ageSpan);
  const availableThemeCount = countAvailableCuratedThemes(summary.topics);

  return (
    <div className="archive-shell">
      <ArchiveAnalytics ready section="overview" sessionId={null} documentId={null} />
      <RouteHeader activeSection="overview" />
      <main id="main" tabIndex={-1} className="browsing-layout">
        <div className="home-front-door">
          <header className="masthead home-masthead">
            <h1>{ARCHIVE_NAME}</h1>
            <p>{ARCHIVE_SUBTITLE}</p>
          </header>

          <section className="home-search-section" aria-labelledby="home-search-heading">
            <form
              className="home-search-form"
              action="/search"
              method="get"
              role="search"
              aria-labelledby="home-search-heading"
            >
              <h2 id="home-search-heading">
                <label htmlFor="home-search">Search the archive</label>
              </h2>
              <div className="home-search-controls">
                <input
                  id="home-search"
                  name="q"
                  type="search"
                  maxLength={300}
                  placeholder="Name, place, or phrase"
                  aria-describedby="home-search-help"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="button primary" type="submit">
                  <Search size={19} aria-hidden="true" />
                  Search
                </button>
              </div>
              <div className="home-search-meta">
                <p id="home-search-help">Searches session guides and full transcripts.</p>
                <a className="text-link" href="/search">
                  Advanced &amp; linguistic search
                  <ArrowRight size={15} aria-hidden="true" />
                </a>
              </div>
            </form>
          </section>

          <section className="home-entry-section" aria-labelledby="home-entry-heading">
            <h2 id="home-entry-heading">Explore the collection</h2>
            <div className="home-entry-grid">
              <article className="home-entry-row" aria-labelledby="entry-browse-age">
                <div className="home-entry-lead">
                  <h3 id="entry-browse-age">
                    <a href="/sessions">
                      Browse by age
                      <ArrowRight size={19} aria-hidden="true" />
                    </a>
                  </h3>
                  <p className="home-entry-count">
                    <CalendarRange size={15} aria-hidden="true" />
                    {' '}
                    {formatCount(summary.counts.sessions, 'session', 'sessions')}
                  </p>
                </div>
                <p className="home-entry-description">{browseByAgeDescription}</p>
              </article>

              <article
                className="home-entry-row home-entry-row--themes theme-discovery"
                aria-labelledby="entry-themes"
              >
                <div className="home-entry-lead">
                  <h3 id="entry-themes">Themes</h3>
                  <p className="home-entry-count">
                    <Bookmark size={15} aria-hidden="true" />
                    {' '}
                    {availableThemeCount > 0
                      ? formatCount(availableThemeCount, 'curated theme', 'curated themes')
                      : 'Curated themes'}
                  </p>
                </div>
                <div className="home-entry-themes-body">
                  {availableThemeCount > 0 ? (
                    <>
                      <ThemeShortcutLinks topics={summary.topics} />
                      <p className="theme-help">
                        Curated from AI-written guides; each session links back to its source transcript.
                      </p>
                    </>
                  ) : (
                    <p className="theme-help">
                      Theme shortcuts appear as guide topics are indexed, or open{' '}
                      <a href="/search">Search</a> to browse all sessions.
                    </p>
                  )}
                </div>
              </article>

              <article className="home-entry-row" aria-labelledby="entry-research">
                <div className="home-entry-lead">
                  <h3 id="entry-research">
                    <a href="/research">
                      Research &amp; methods
                      <ArrowRight size={19} aria-hidden="true" />
                    </a>
                  </h3>
                  <p className="home-entry-count">
                    <BookOpen size={15} aria-hidden="true" />
                    {' '}
                    {researchDocumentCount > 0
                      ? formatCount(researchDocumentCount, 'research document', 'research documents')
                      : 'Corpus & methods'}
                  </p>
                </div>
                <p className="home-entry-description">
                  Read background on the Peters/Wilson corpus, annotation provenance, and downloadable research guides, or review{' '}
                  <a href="/about">sources, methods, and citation guidance</a>.
                </p>
              </article>
            </div>
          </section>

          <section className="home-provenance source-key" aria-labelledby="home-provenance-heading">
            <h2 id="home-provenance-heading">Provenance</h2>
            <p>
              This collection brings together{' '}
              <strong>{formatCount(summary.counts.sessions, 'session', 'sessions')}</strong> and{' '}
              <strong>{formatCount(summary.counts.recordings, 'original recording', 'original recordings')}</strong>{' '}
              from the Peters/Wilson corpus:{' '}
              <strong>{formatCount(summary.counts.original, 'archived research transcript', 'archived research transcripts')}</strong>{' '}
              alongside{' '}
              <strong>{formatCount(summary.counts.talkbankAi, 'TalkBank AI draft', 'TalkBank AI drafts')}</strong>{' '}
              and{' '}
              <strong>{formatCount(summary.counts.localAi, 'local AI draft', 'local AI drafts')}</strong>, with machine drafts marked unreviewed and AI-written guides kept separate from source speech. Original recordings are preserved alongside labelled MP3 listening copies, filename-inferred ages are always labelled, and calendar dates are never inferred. Read more in{' '}
              <a href="/about">About sources, methods, and privacy</a>.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
