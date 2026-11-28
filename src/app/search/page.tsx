import { cache } from 'react';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import SearchPageClient from '@/components/SearchPageClient';
import { computeArchiveAgeBounds } from '@/lib/age';
import { archive, catalog } from '@/lib/archive';
import { hasActiveSearchFilters, parseSearchUrlParams } from '@/lib/search-params';
import { ARCHIVE_NAME, formatDocumentTitle } from '@/lib/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const loadSearchCatalog = cache(async () => {
  await connection();
  const data = await archive();
  const summary = catalog(data);
  const ageBounds = computeArchiveAgeBounds(data.sessions);
  const validTopics = new Set(summary.topics.map(item => item.name));
  return {
    topics: summary.topics,
    totalSessions: summary.counts.sessions,
    ageBounds,
    validTopics,
  };
});

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  await connection();
  const resolved = await searchParams;
  let validTopics: ReadonlySet<string> | undefined;
  try {
    ({ validTopics } = await loadSearchCatalog());
  } catch {
    validTopics = undefined;
  }
  const parsed = parseSearchUrlParams(resolved, { validTopics });
  return {
    title: formatDocumentTitle({ kind: 'search', hasFilters: hasActiveSearchFilters(parsed) }),
    description: `Search sessions, guides, and transcripts in ${ARCHIVE_NAME}.`,
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  await searchParams;

  try {
    const { topics, totalSessions, ageBounds } = await loadSearchCatalog();
    return (
      <SearchPageClient
        topics={topics}
        totalSessions={totalSessions}
        ageBounds={ageBounds}
      />
    );
  } catch {
    return <SearchPageClient topics={[]} totalSessions={0} ageBounds={null} loadError />;
  }
}
