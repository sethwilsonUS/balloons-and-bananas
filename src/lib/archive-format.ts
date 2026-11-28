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
 * `audio`, `preferredAudioId`) so existing imports remain compatible without
 * re-importing. Map them to the domain glossary terms at load time; see CONTEXT.md.
 */
export interface StoredSession {
  id: string;
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

function mapStoredSession(raw: unknown): Session {
  if (!isRecord(raw)) {
    throw new Error('Archive format mismatch');
  }
  const stored = raw as Partial<StoredSession>;
  if (
    typeof stored.id !== 'string'
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
  const { audio, preferredAudioId, inferredAge, ...rest } = stored as StoredSession;
  return {
    ...rest,
    // Keep source ages (`ages`) and filename-inferred ages strictly separate;
    // older v1 blobs without `inferredAge` default cleanly to `null`.
    inferredAge: rest.ages.length > 0 ? null : (inferredAge?.trim() ?? null),
    recordings: audio,
    preferredRecordingId: preferredAudioId ?? null,
  };
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
  return {
    version: 1,
    generatedAt: data.generatedAt,
    sessions: data.entries.map(mapStoredSession),
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
