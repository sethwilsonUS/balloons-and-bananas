import { compareSessionsByAge, effectiveSessionAge } from './age';
import type { SessionView } from './results-view';
import type { Recording, Session, TranscriptOrigin } from './types';

// Keep the existing localStorage key so returning readers preserve their saved Details/List preference.
export const VIEW_STORAGE_KEY = 'balloons-and-bananas:recordings-view';

export const VALID_TRANSCRIPT_ORIGINS: readonly TranscriptOrigin[] = [
  'archived_research',
  'talkbank_ai_draft',
  'local_ai_draft',
] as const;

const ORIGIN_SET = new Set<string>(VALID_TRANSCRIPT_ORIGINS);

export function isTranscriptOrigin(value: unknown): value is TranscriptOrigin {
  return typeof value === 'string' && ORIGIN_SET.has(value);
}

function firstParamValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

/**
 * Parse and validate an `?origin=` URL parameter for `/sessions`.
 * Invalid or missing values safely fall back to `''` (all origins).
 */
export function parseOriginParam(value: string | string[] | undefined): TranscriptOrigin | '' {
  const first = firstParamValue(value)?.trim();
  return first && isTranscriptOrigin(first) ? first : '';
}

/**
 * Validate a stored Details/List view preference read from localStorage.
 */
export function parseStoredView(value: unknown): SessionView | null {
  return value === 'details' || value === 'list' ? value : null;
}

export type SessionAudioStatus = 'mp3' | 'no-mp3' | 'none';

/**
 * Lightweight browse projection of a Session passed to `/sessions` client views.
 * Deliberately omits full transcript passages, moments, limits, and asset paths.
 */
export interface SessionBrowseItem {
  id: string;
  slug: string;
  sourceName: string;
  title: string;
  overview: string;
  origin: TranscriptOrigin;
  topics: string[];
  dates: string[];
  ages: string[];
  inferredAge: string | null;
  audioStatus: SessionAudioStatus;
}

export function getSessionAudioStatus(
  recordings: readonly Pick<Recording, 'available' | 'format'>[],
): SessionAudioStatus {
  const hasMp3 = recordings.some(
    recording => recording.available && recording.format.toLowerCase() === 'mp3',
  );
  if (hasMp3) return 'mp3';
  return recordings.length > 0 ? 'no-mp3' : 'none';
}

export function toSessionBrowseItem(session: Session): SessionBrowseItem {
  const audioStatus = getSessionAudioStatus(session.recordings);
  return {
    id: session.id,
    slug: session.slug,
    sourceName: session.sourceName,
    title: session.title,
    overview: session.overview,
    origin: session.origin,
    topics: session.topics,
    dates: session.dates,
    ages: session.ages,
    inferredAge: session.inferredAge,
    audioStatus,
  };
}

export interface AgeYearGroup<T> {
  key: string;
  year: number | null;
  label: string;
  sessions: T[];
  startIndex: number;
}

/**
 * Sort sessions youngest-first using canonical age order (source age, else
 * filename-inferred age; unaged last) and group them under year-of-age headings.
 */
export function groupSessionsByAgeYear<
  T extends { id: string; sourceName: string; ages: string[]; inferredAge?: string | null },
>(sessions: readonly T[]): AgeYearGroup<T>[] {
  if (sessions.length === 0) return [];
  const sorted = [...sessions].sort((a, b) => compareSessionsByAge(a, b, 'asc'));
  const groups: AgeYearGroup<T>[] = [];
  let runningIndex = 1;

  for (const session of sorted) {
    const parsed = effectiveSessionAge(session);
    const year = parsed ? parsed.years : null;
    const key = year === null ? 'age-unrecorded' : `age-${year}`;
    const label = year === null ? 'Age not recorded' : year === 0 ? 'Under age 1' : `Age ${year}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.sessions.push(session);
    } else {
      groups.push({
        key,
        year,
        label,
        sessions: [session],
        startIndex: runningIndex,
      });
    }
    runningIndex += 1;
  }

  return groups;
}

export function filterBrowseSessions(
  sessions: readonly SessionBrowseItem[],
  origin: TranscriptOrigin | '',
): SessionBrowseItem[] {
  if (!origin) return [...sessions];
  return sessions.filter(session => session.origin === origin);
}

export function countSessionsByOrigin(
  sessions: readonly Pick<SessionBrowseItem, 'origin'>[],
): Record<TranscriptOrigin, number> {
  const counts: Record<TranscriptOrigin, number> = {
    archived_research: 0,
    talkbank_ai_draft: 0,
    local_ai_draft: 0,
  };
  for (const session of sessions) {
    counts[session.origin] += 1;
  }
  return counts;
}

export function buildSessionsUrl(origin: TranscriptOrigin | ''): string {
  return origin ? `/sessions?origin=${encodeURIComponent(origin)}` : '/sessions';
}

const ORIGIN_STATUS_LABELS: Record<TranscriptOrigin, string> = {
  archived_research: 'archived research',
  talkbank_ai_draft: 'TalkBank AI draft',
  local_ai_draft: 'local AI draft',
};

export function formatSessionsBrowseStatus(
  filteredCount: number,
  totalCount: number,
  groupCount: number,
  origin: TranscriptOrigin | '',
): string {
  if (filteredCount === 0) {
    return origin
      ? `0 ${ORIGIN_STATUS_LABELS[origin]} sessions`
      : '0 sessions in the collection';
  }
  const sessionWord = filteredCount === 1 ? 'session' : 'sessions';
  const groupWord = groupCount === 1 ? 'age group' : 'age groups';
  if (origin) {
    return `Showing ${filteredCount.toLocaleString()} of ${totalCount.toLocaleString()} sessions (${ORIGIN_STATUS_LABELS[origin]}) across ${groupCount} ${groupWord}, youngest first`;
  }
  return `Showing all ${filteredCount.toLocaleString()} ${sessionWord} across ${groupCount} ${groupWord}, youngest first`;
}
