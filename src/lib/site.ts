export const ARCHIVE_NAME = 'The Seth Tapes';
export const ARCHIVE_SUBTITLE = 'A childhood-language archive from the Peters/Wilson corpus';

export type DocumentTitleState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'overview' }
  | { kind: 'sessions'; hasFilters: boolean }
  | { kind: 'session'; title?: string | null; notFound?: boolean }
  | { kind: 'research' }
  | { kind: 'document'; title?: string | null };

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
  }
}
