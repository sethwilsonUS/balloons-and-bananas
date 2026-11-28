import { deriveSessionSlug, isValidSessionSlug, normalizeSlugToken } from './sessions';
import { ARCHIVE_NAME } from './site';
import type {
  ArchiveAsset,
  ArchiveData,
  ArchiveDocument,
  Catalog,
  Moment,
  Passage,
  Recording,
  Session,
  SourceFile,
  TranscriptOrigin,
} from './types';

/**
 * Stored archive.json (schema v1) keeps its original storage keys (`entries`,
 * `audio`, `preferredAudioId`) and preserves the previous entry ID on `id`
 * (mirrored in `legacyId`) alongside the readable URL `slug`, so existing
 * imports, analytics IDs, listening-copy manifests, and legacy `/?entry=` links
 * stay compatible without breaking before a re-upload. Map storage keys to the
 * domain glossary terms at load time; see CONTEXT.md.
 */
export interface StoredSession {
  id: string;
  slug?: string;
  legacyId?: string;
  sourceName: string;
  title: string;
  overview: string;
  origin: TranscriptOrigin;
  topics: string[];
  dates: string[];
  ages: string[];
  inferredAge?: string | null;
  audio: Recording[];
  preferredAudioId: string | null;
  sources: SourceFile[];
  moments: Moment[];
  limits: string[];
  transcript: Passage[];
  sourceSha256: string;
  association: string;
}

export interface StoredArchiveData {
  version: 1;
  generatedAt: string;
  entries: StoredSession[];
  documents: ArchiveDocument[];
  assets: Record<string, ArchiveAsset>;
}

const VALID_ORIGINS = new Set<string>(['archived_research', 'talkbank_ai_draft', 'local_ai_draft']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isTranscriptOrigin(value: unknown): value is TranscriptOrigin {
  return typeof value === 'string' && VALID_ORIGINS.has(value);
}

function mapStoredSession(raw: unknown): { session: Session; explicitSlug: boolean } {
  if (!isRecord(raw)) {
    throw new Error('Archive format mismatch');
  }
  const stored = raw as Partial<StoredSession>;
  if (
    typeof stored.id !== 'string'
    || (stored.slug !== undefined && (typeof stored.slug !== 'string' || !isValidSessionSlug(stored.slug)))
    || (stored.legacyId !== undefined && (typeof stored.legacyId !== 'string' || !stored.legacyId.trim()))
    || typeof stored.sourceName !== 'string'
    || typeof stored.title !== 'string'
    || typeof stored.overview !== 'string'
    || !isTranscriptOrigin(stored.origin)
    || !isStringArray(stored.topics)
    || !isStringArray(stored.dates)
    || !isStringArray(stored.ages)
    || (stored.inferredAge !== undefined && stored.inferredAge !== null && (typeof stored.inferredAge !== 'string' || !stored.inferredAge.trim()))
    || !Array.isArray(stored.audio)
    || (stored.preferredAudioId !== null && stored.preferredAudioId !== undefined && typeof stored.preferredAudioId !== 'string')
    || !Array.isArray(stored.sources)
    || !Array.isArray(stored.moments)
    || !isStringArray(stored.limits)
    || !Array.isArray(stored.transcript)
    || typeof stored.sourceSha256 !== 'string'
    || typeof stored.association !== 'string'
  ) {
    throw new Error('Archive format mismatch');
  }
  const { audio, preferredAudioId, inferredAge, slug, legacyId, ...rest } = stored as StoredSession;
  const resolvedSlug = slug ?? deriveSessionSlug(rest.sourceName, rest.id);
  return {
    explicitSlug: slug !== undefined,
    session: {
      ...rest,
      slug: resolvedSlug,
      legacyId: legacyId?.trim() ?? rest.id,
      // Keep source ages (`ages`) and filename-inferred ages strictly separate;
      // older v1 blobs without `inferredAge` default cleanly to `null`.
      inferredAge: rest.ages.length > 0 ? null : (inferredAge?.trim() ?? null),
      recordings: audio,
      preferredRecordingId: preferredAudioId ?? null,
    },
  };
}

function disambiguateFallbackSlug(base: string, id: string, used: Set<string>): string {
  const idToken = normalizeSlugToken(id);
  if (idToken && !used.has(idToken)) return idToken;
  const combined = idToken ? `${base}-${idToken}` : base;
  if (!used.has(combined)) return combined;
  let suffix = 2;
  while (used.has(`${combined}-${suffix}`)) suffix += 1;
  return `${combined}-${suffix}`;
}

export function parseStoredArchiveData(raw: unknown): ArchiveData {
  if (!isRecord(raw)) {
    throw new Error('Archive format mismatch');
  }
  const data = raw as Partial<StoredArchiveData>;
  if (
    data.version !== 1
    || typeof data.generatedAt !== 'string'
    || !Array.isArray(data.entries)
    || !Array.isArray(data.documents)
    || !isRecord(data.assets)
  ) {
    throw new Error('Archive format mismatch');
  }
  const mapped = data.entries.map(mapStoredSession);
  // Reserve explicit slugs first so any fallback derivation never steals an explicit slug,
  // while rejecting duplicate explicit slugs as a format error.
  const explicitSlugs = new Set<string>();
  for (const item of mapped) {
    if (!item.explicitSlug) continue;
    if (explicitSlugs.has(item.session.slug)) {
      throw new Error('Archive format mismatch');
    }
    explicitSlugs.add(item.session.slug);
  }
  const usedSlugs = new Set<string>(explicitSlugs);
  const sessions = mapped.map(item => {
    if (item.explicitSlug) return item.session;
    const slug = usedSlugs.has(item.session.slug)
      ? disambiguateFallbackSlug(item.session.slug, item.session.id, usedSlugs)
      : item.session.slug;
    usedSlugs.add(slug);
    return slug === item.session.slug ? item.session : { ...item.session, slug };
  });
  return {
    version: 1,
    generatedAt: data.generatedAt,
    sessions,
    documents: data.documents,
    assets: data.assets as Record<string, ArchiveAsset>,
  };
}

export function buildCatalog(data: ArchiveData): Catalog {
  const topics = new Map<string, number>();
  for (const session of data.sessions) {
    for (const topic of session.topics) topics.set(topic, (topics.get(topic) ?? 0) + 1);
  }
  return {
    title: ARCHIVE_NAME,
    counts: {
      sessions: data.sessions.length,
      recordings: new Set(
        data.sessions.flatMap(session =>
          session.recordings.filter(recording => recording.kind !== 'listening-copy').map(recording => recording.id),
        ),
      ).size,
      moments: data.sessions.reduce((count, session) => count + session.moments.length, 0),
      original: data.sessions.filter(session => session.origin === 'archived_research').length,
      talkbankAi: data.sessions.filter(session => session.origin === 'talkbank_ai_draft').length,
      localAi: data.sessions.filter(session => session.origin === 'local_ai_draft').length,
    },
    topics: [...topics].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })),
    documents: data.documents,
  };
}
