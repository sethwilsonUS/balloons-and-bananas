export const ARCHIVE_NAME = 'The Seth Tapes';
export const ARCHIVE_SUBTITLE = 'A childhood-language archive from the Peters/Wilson corpus';

/**
 * Format the document `<title>` for `/sessions/[id]`, keeping source ages and
 * filename-inferred ages explicitly distinguished.
 */
export function formatSessionPageTitle(session: {
  slug: string;
  ages: readonly string[];
  inferredAge: string | null;
}): string {
  const sourceAges = session.ages.map(age => age.trim()).filter(Boolean);
  if (sourceAges.length > 0) {
    return `Session ${session.slug} (age ${sourceAges.join(' / ')}) · ${ARCHIVE_NAME}`;
  }
  const inferred = session.inferredAge?.trim();
  if (inferred) {
    return `Session ${session.slug} (inferred age ${inferred}) · ${ARCHIVE_NAME}`;
  }
  return `Session ${session.slug} · ${ARCHIVE_NAME}`;
}

/** Format the document `<title>` for `/research/[doc]`. */
export function formatResearchDocumentPageTitle(title?: string | null): string {
  const trimmed = title?.trim();
  return `${trimmed || 'Document not found'} · Research · ${ARCHIVE_NAME}`;
}

export type DocumentTitleState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'overview' }
  | { kind: 'sessions'; hasFilters: boolean }
  | { kind: 'search'; hasFilters: boolean }
  | { kind: 'session'; title?: string | null; notFound?: boolean }
  | { kind: 'research' }
  | { kind: 'document'; title?: string | null }
  | { kind: 'about' };

export function formatDocumentTitle(state: DocumentTitleState): string {
  switch (state.kind) {
    case 'loading':
      return ARCHIVE_NAME;
    case 'error':
      return `Archive unavailable · ${ARCHIVE_NAME}`;
    case 'overview':
      return `Overview · ${ARCHIVE_NAME}`;
    case 'sessions':
      return `${state.hasFilters ? 'Search results' : 'Sessions'} · ${ARCHIVE_NAME}`;
    case 'search':
      return `${state.hasFilters ? 'Search results' : 'Search'} · ${ARCHIVE_NAME}`;
    case 'session': {
      const trimmed = state.title?.trim();
      if (trimmed) return `${trimmed} · ${ARCHIVE_NAME}`;
      return `${state.notFound ? 'Session not found' : 'Session'} · ${ARCHIVE_NAME}`;
    }
    case 'research':
      return `Research & context · ${ARCHIVE_NAME}`;
    case 'document': {
      const trimmed = state.title?.trim();
      return `${trimmed || 'Document not found'} · ${ARCHIVE_NAME}`;
    }
    case 'about':
      return `About & methods · ${ARCHIVE_NAME}`;
  }
}
