import type { Session } from '../lib/types';
import CatalogRecord from './CatalogRecord';

export default function SessionCatalogRecord({ session }: { session: Session }) {
  return (
    <CatalogRecord
      variant="full"
      slug={session.slug}
      sourceName={session.sourceName}
      ages={session.ages}
      inferredAge={session.inferredAge}
      dates={session.dates}
      origin={session.origin}
      recordings={session.recordings}
      momentsCount={session.moments.length}
      citation={{
        slug: session.slug,
        ages: session.ages,
        inferredAge: session.inferredAge,
        dates: session.dates,
        origin: session.origin,
      }}
    />
  );
}
