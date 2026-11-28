import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { connection } from 'next/server';
import { ArrowRight, BookOpen, CalendarRange, Headphones, Search } from 'lucide-react';
import ArchiveAnalytics from '@/components/ArchiveAnalytics';
import RouteHeader from '@/components/RouteHeader';
import SiteFooter from '@/components/SiteFooter';
import { ThemeShortcutLinks } from '@/components/TopicThemes';
import { archive, catalog } from '@/lib/archive';
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

  return (
    <div className="archive-shell">
      <ArchiveAnalytics ready section="overview" sessionId={null} documentId={null} />
      <RouteHeader activeSection="overview" />
      <main id="main" tabIndex={-1}>
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
            <p id="home-search-help">Searches session guides and full transcripts.</p>
          </form>
        </section>

        <section className="home-entry-section" aria-labelledby="home-entry-heading">
          <h2 id="home-entry-heading">Explore the collection</h2>
          <div className="home-entry-grid">
            <article className="entry-point-card" aria-labelledby="entry-browse-age">
              <p className="eyebrow">
                <CalendarRange size={14} aria-hidden="true" />
                {summary.counts.sessions.toLocaleString()}{' '}
                {summary.counts.sessions === 1 ? 'session' : 'sessions'}
              </p>
              <h3 id="entry-browse-age">
                <a href="/sessions">
                  Browse by age
                  <ArrowRight size={19} aria-hidden="true" />
                </a>
              </h3>
              <p>
                Walk through every session youngest-first, grouped by year of age and filterable by transcript origin.
              </p>
            </article>

            <article className="entry-point-card" aria-labelledby="entry-research">
              <p className="eyebrow">
                <BookOpen size={14} aria-hidden="true" />
                {researchDocumentCount.toLocaleString()}{' '}
                {researchDocumentCount === 1 ? 'document' : 'documents'}
              </p>
              <h3 id="entry-research">
                <a href="/research">
                  Research &amp; context
                  <ArrowRight size={19} aria-hidden="true" />
                </a>
              </h3>
              <p>
                Read background on the Peters/Wilson corpus, annotation provenance, and downloadable research guides.
              </p>
            </article>
          </div>
        </section>

        <section className="theme-discovery" aria-labelledby="theme-discovery-heading">
          <h2 id="theme-discovery-heading">Browse by theme</h2>
          <ThemeShortcutLinks topics={summary.topics} />
          <p className="theme-help">
            Themes come from the AI-written guides; each session links back to its source transcript.
          </p>
        </section>

        <div className="collection-note">
          <p>
            <strong>{summary.counts.sessions.toLocaleString()}</strong>{' '}
            {summary.counts.sessions === 1 ? 'session' : 'sessions'}{' '}
            <span aria-hidden="true">·</span>{' '}
            <strong>{summary.counts.recordings.toLocaleString()}</strong> original{' '}
            {summary.counts.recordings === 1 ? 'recording' : 'recordings'}, including alternate formats
          </p>
          <a className="text-link" href="/search">
            Advanced &amp; linguistic search
            <ArrowRight size={15} aria-hidden="true" />
          </a>
        </div>

        <section className="source-key" aria-labelledby="source-key-heading">
          <h2 id="source-key-heading">Transcripts and provenance</h2>
          <p>
            Archived research transcripts are kept separate from TalkBank AI drafts and local AI drafts, and machine drafts are marked unreviewed. Each session’s guide is AI-written and remains separate from its source transcript. Where CHAT source age metadata is absent, ages inferred from filenames are visibly labelled, and calendar dates are never inferred.
          </p>
          <div className="badge-row">
            <span className="origin-badge archived_research">
              {summary.counts.original.toLocaleString()} archived research
            </span>{' '}
            <span className="origin-badge talkbank_ai_draft">
              {summary.counts.talkbankAi.toLocaleString()}{' '}
              {summary.counts.talkbankAi === 1 ? 'TalkBank AI draft' : 'TalkBank AI drafts'}
            </span>{' '}
            <span className="origin-badge local_ai_draft">
              {summary.counts.localAi.toLocaleString()}{' '}
              {summary.counts.localAi === 1 ? 'local AI draft' : 'local AI drafts'}
            </span>
          </div>
          <p className="provenance-about-link">
            <a className="text-link" href="/about">
              About sources, methods, and privacy
              <ArrowRight size={15} aria-hidden="true" />
            </a>
          </p>
        </section>

        <p className="audio-edition-note small muted">
          <Headphones size={16} aria-hidden="true" />
          Open a session to listen to its recordings in MP3 and follow the transcript. Original recordings are preserved; converted listening copies are labelled separately.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
