import type { Metadata } from 'next';
import { connection } from 'next/server';
import RouteHeader from '@/components/RouteHeader';
import SessionsBrowseClient from '@/components/SessionsBrowseClient';
import SiteFooter from '@/components/SiteFooter';
import { compareSessionsByAge } from '@/lib/age';
import { archive } from '@/lib/archive';
import { parseOriginParam, toSessionBrowseItem } from '@/lib/sessions-browse';
import { ARCHIVE_NAME, formatDocumentTitle } from '@/lib/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: formatDocumentTitle({ kind: 'sessions', hasFilters: false }),
  description: `Browse all sessions in ${ARCHIVE_NAME} across six-month age bands in chronological order by age.`,
};

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const params = await searchParams;
  const initialOrigin = parseOriginParam(params.origin);
  const data = await archive();
  const items = [...data.sessions]
    .sort((a, b) => compareSessionsByAge(a, b, 'asc'))
    .map(toSessionBrowseItem);

  return (
    <div className="archive-shell">
      <RouteHeader activeSection="sessions" />
      <main id="main" tabIndex={-1}>
        <section className="sessions-browse-section" aria-labelledby="sessions-page-heading">
          <header className="page-header">
            <p className="eyebrow">Browse by age</p>
            <h1 id="sessions-page-heading">Sessions</h1>
            <p className="section-intro">
              Every session in {ARCHIVE_NAME}, organized from youngest to oldest in six-month age bands by source or filename-inferred age. For full-text, theme, or linguistic search, open <a href="/search">Search</a>.
            </p>
          </header>
          <SessionsBrowseClient sessions={items} initialOrigin={initialOrigin} />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
