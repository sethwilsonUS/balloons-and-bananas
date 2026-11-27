export const ARCHIVE_NAME = 'The Seth Tapes';
export const ARCHIVE_SUBTITLE = 'A childhood-language archive from the Peters/Wilson corpus';

export type DocumentTitleState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'overview' }
  | { kind: 'recordings'; hasFilters: boolean }
  | { kind: 'recording'; title?: string | null; notFound?: boolean }
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
    case 'recordings':
      return `${state.hasFilters ? 'Search results' : 'Recordings'} · ${ARCHIVE_NAME}`;
    case 'recording': {
      const trimmed = state.title?.trim();
      if (trimmed) return `${trimmed} · ${ARCHIVE_NAME}`;
      return `${state.notFound ? 'Recording not found' : 'Recording'} · ${ARCHIVE_NAME}`;
    }
    case 'research':
      return `Research & context · ${ARCHIVE_NAME}`;
    case 'document': {
      const trimmed = state.title?.trim();
      return `${trimmed || 'Document not found'} · ${ARCHIVE_NAME}`;
    }
  }
}
