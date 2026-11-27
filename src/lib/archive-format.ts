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

function mapStoredSession(raw: unknown): Session {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Archive format mismatch');
  }
  const stored = raw as Partial<StoredSession>;
  if (typeof stored.id !== 'string' || !Array.isArray(stored.audio) || !Array.isArray(stored.transcript) || !Array.isArray(stored.moments)) {
    throw new Error('Archive format mismatch');
  }
  const { audio, preferredAudioId, ...rest } = stored as StoredSession;
  return {
    ...rest,
    recordings: audio,
    preferredRecordingId: preferredAudioId ?? null,
  };
}

export function parseStoredArchiveData(raw: unknown): ArchiveData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Archive format mismatch');
  }
  const data = raw as Partial<StoredArchiveData>;
  if (
    data.version !== 1
    || typeof data.generatedAt !== 'string'
    || !Array.isArray(data.entries)
    || !Array.isArray(data.documents)
    || !data.assets
    || typeof data.assets !== 'object'
    || Array.isArray(data.assets)
  ) {
    throw new Error('Archive format mismatch');
  }
  return {
    version: 1,
    generatedAt: data.generatedAt,
    sessions: data.entries.map(mapStoredSession),
    documents: data.documents,
    assets: data.assets,
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
