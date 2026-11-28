import type { ArchiveData, ArchiveDocument, Session } from './types';

export interface DocumentLookupResult {
  document: ArchiveDocument;
  canonical: boolean;
}

/** Return the documents shown on the `/research` reading list (excluding overview notes). */
export function getResearchDocuments(documents: readonly ArchiveDocument[]): ArchiveDocument[] {
  return documents.filter(document => document.category !== 'overview');
}

/** Look up a document by ID (case-insensitive, flagging non-canonical casing). */
export function findDocumentById(
  documents: readonly ArchiveDocument[],
  rawId: string,
): DocumentLookupResult | null {
  const trimmed = rawId.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  const match = documents.find(document => document.id.toLowerCase() === lowered);
  if (!match) return null;
  return { document: match, canonical: match.id === rawId };
}

export function formatDocumentCategory(category: ArchiveDocument['category']): string {
  switch (category) {
    case 'research':
      return 'Research material';
    case 'overview':
      return 'Collection overview';
    case 'guide':
      return 'Archive guide';
  }
}

/**
 * Rewrite legacy `/?document=<id>` markdown links from older v1 blobs to the
 * canonical `/research/<id>` route while preserving any fragment anchor.
 */
export function rewriteLegacyDocumentHref(href: string): string | null {
  const match = href.match(/^(?:\/)?\?document=([^&#]+)(#.*)?$/);
  if (!match) return null;
  const rawId = match[1];
  const hash = match[2] ?? '';
  let decoded = rawId;
  try {
    decoded = decodeURIComponent(rawId);
  } catch {
    decoded = rawId;
  }
  const trimmed = decoded.trim();
  if (!trimmed) return null;
  return `/research/${encodeURIComponent(trimmed)}${hash}`;
}

const LEGACY_ENTRY_INLINE_RE = /(?:\]\(<?|\bhref=["'])(?:\/)?\?entry=([^&#)>\s"']+)/g;
const LEGACY_ENTRY_REF_DEF_RE = /^[ \t]{0,3}\[[^\]]+\]:[ \t]*(?:\r?\n[ \t]*)?<?(?:\/)?\?entry=([^&#>\s]+)/gm;

/**
 * Build a minimal `{ [legacyId]: slug }` lookup for only the legacy `/?entry=`
 * session links referenced inside a single markdown document (inline links,
 * HTML hrefs, and CommonMark reference-style definitions).
 */
export function extractReferencedSessionSlugs(
  markdown: string | undefined,
  sessions: readonly Session[],
): Record<string, string> {
  if (!markdown) return {};
  const referenced = new Set<string>();
  for (const regex of [LEGACY_ENTRY_INLINE_RE, LEGACY_ENTRY_REF_DEF_RE]) {
    for (const match of markdown.matchAll(regex)) {
      try {
        referenced.add(decodeURIComponent(match[1]));
      } catch {
        referenced.add(match[1]);
      }
    }
  }
  if (referenced.size === 0) return {};
  const result: Record<string, string> = {};
  for (const session of sessions) {
    if (referenced.has(session.id)) {
      result[session.id] = session.slug;
    }
    if (referenced.has(session.legacyId)) {
      result[session.legacyId] = session.slug;
    }
  }
  return result;
}

export interface AboutArchiveSummary {
  sessions: number;
  recordings: number;
  listeningCopies: number;
  moments: number;
  original: number;
  talkbankAi: number;
  localAi: number;
  sourceAgeSessions: number;
  inferredAgeSessions: number;
  unagedSessions: number;
  documents: number;
}

/** Compute live per-request collection counts for the `/about` methods page. */
export function summarizeArchiveForAbout(data: ArchiveData): AboutArchiveSummary {
  const originalRecordingIds = new Set<string>();
  const listeningCopyIds = new Set<string>();
  let moments = 0;
  let original = 0;
  let talkbankAi = 0;
  let localAi = 0;
  let sourceAgeSessions = 0;
  let inferredAgeSessions = 0;
  let unagedSessions = 0;

  for (const session of data.sessions) {
    moments += session.moments.length;
    if (session.origin === 'archived_research') original += 1;
    else if (session.origin === 'talkbank_ai_draft') talkbankAi += 1;
    else if (session.origin === 'local_ai_draft') localAi += 1;

    if (session.ages.length > 0) sourceAgeSessions += 1;
    else if (session.inferredAge) inferredAgeSessions += 1;
    else unagedSessions += 1;

    for (const recording of session.recordings) {
      if (recording.kind === 'listening-copy') listeningCopyIds.add(recording.id);
      else originalRecordingIds.add(recording.id);
    }
  }

  return {
    sessions: data.sessions.length,
    recordings: originalRecordingIds.size,
    listeningCopies: listeningCopyIds.size,
    moments,
    original,
    talkbankAi,
    localAi,
    sourceAgeSessions,
    inferredAgeSessions,
    unagedSessions,
    documents: getResearchDocuments(data.documents).length,
  };
}
