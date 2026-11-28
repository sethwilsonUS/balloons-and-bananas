import { compareSessionsByAge, effectiveSessionAge, type ParsedChatAge } from './age';
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

export interface AgeBandDescriptor {
  /** Predictable linkable HTML anchor ID (e.g. `age-1-0`, `age-2-6`, `age-unknown`). */
  key: string;
  /** Canonical six-month band label (e.g. `1;0–1;5`, `1;6–1;11`, `Age unknown`). */
  label: string;
  /** Plain-English reading gloss for family and researchers (e.g. `2 years, 0 to 5 months`). */
  proseRange: string;
  /** Lower bound in total months (inclusive), or `null` for `Age unknown`. */
  startMonths: number | null;
  /** Upper bound in total months (inclusive), or `null` for `Age unknown`. */
  endMonths: number | null;
}

export interface AgeBandGroup<T> extends AgeBandDescriptor {
  sessions: T[];
  startIndex: number;
}

const AGE_BAND_HASH_RE = /^age-(?:unknown|\d+-[06])$/;

/**
 * Map a parsed CHAT age onto its fixed six-month longitudinal age band
 * (`0;0–0;5`, `0;6–0;11`, `1;0–1;5`, `1;6–1;11`, `2;0–2;5`, …) or `Age unknown`.
 *
 * Sessions with year-only CHAT precision (`months === undefined`) are placed in
 * the first six-month band of that year (`Y;0–Y;5`), matching `compareParsedAges`
 * order while keeping their rendered source age unpadded.
 */
export function ageBandForParsedAge(parsed: ParsedChatAge | null): AgeBandDescriptor {
  if (
    !parsed
    || !Number.isSafeInteger(parsed.years)
    || parsed.years < 0
    || (parsed.months !== undefined && (!Number.isSafeInteger(parsed.months) || parsed.months < 0 || parsed.months > 11))
  ) {
    return {
      key: 'age-unknown',
      label: 'Age unknown',
      proseRange: 'No source or filename-inferred age',
      startMonths: null,
      endMonths: null,
    };
  }

  const { years, months } = parsed;
  const isSecondHalf = months !== undefined && months >= 6;
  const startMonth = isSecondHalf ? 6 : 0;
  const endMonth = isSecondHalf ? 11 : 5;
  const startMonths = years * 12 + startMonth;
  const endMonths = years * 12 + endMonth;
  const monthWords = isSecondHalf ? '6 to 11 months' : '0 to 5 months';
  const proseRange = years === 0
    ? monthWords
    : `${years} ${years === 1 ? 'year' : 'years'}, ${monthWords}`;

  return {
    key: `age-${years}-${startMonth}`,
    label: `${years};${startMonth}\u2013${years};${endMonth}`,
    proseRange,
    startMonths,
    endMonths,
  };
}

/**
 * Parse a URL fragment (with or without leading `#`) into a valid age-band
 * anchor ID (`age-2-0`, `age-2-6`, `age-unknown`), or `''` for anything else.
 */
export function parseAgeBandHash(hash: string | null | undefined): string {
  if (typeof hash !== 'string') return '';
  const trimmed = hash.trim().replace(/^#/, '');
  return AGE_BAND_HASH_RE.test(trimmed) ? trimmed : '';
}

/**
 * Sort sessions youngest-first using canonical age order (source age, else
 * filename-inferred age; unaged last) and group them into fixed six-month
 * longitudinal age bands with an `Age unknown` band at the end.
 */
export function groupSessionsByAgeBand<
  T extends { id: string; sourceName: string; ages: string[]; inferredAge?: string | null },
>(sessions: readonly T[]): AgeBandGroup<T>[] {
  if (sessions.length === 0) return [];
  const sorted = [...sessions].sort((a, b) => compareSessionsByAge(a, b, 'asc'));
  const groups: AgeBandGroup<T>[] = [];
  let runningIndex = 1;

  for (const session of sorted) {
    const band = ageBandForParsedAge(effectiveSessionAge(session));
    const last = groups[groups.length - 1];
    if (last && last.key === band.key) {
      last.sessions.push(session);
    } else {
      groups.push({
        ...band,
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

export function buildSessionsUrl(origin: TranscriptOrigin | '', bandKey?: string): string {
  const base = origin ? `/sessions?origin=${encodeURIComponent(origin)}` : '/sessions';
  const validBand = parseAgeBandHash(bandKey);
  return validBand ? `${base}#${validBand}` : base;
}

/**
 * Compute a proportional width percentage (8..100, or 0 for empty bands) for
 * the decorative CSS hairline bar inside the age-band timeline navigator.
 */
export function computeBandBarPercent(count: number, maxCount: number): number {
  if (!Number.isFinite(count) || !Number.isFinite(maxCount) || count <= 0 || maxCount <= 0) {
    return 0;
  }
  return Math.max(8, Math.min(100, Math.round((count / maxCount) * 100)));
}

const ORIGIN_STATUS_LABELS: Record<TranscriptOrigin, string> = {
  archived_research: 'archived research',
  talkbank_ai_draft: 'TalkBank AI draft',
  local_ai_draft: 'local AI draft',
};

export function formatSessionsBrowseStatus(
  filteredCount: number,
  totalCount: number,
  bandCount: number,
  origin: TranscriptOrigin | '',
): string {
  if (filteredCount === 0) {
    return origin
      ? `0 ${ORIGIN_STATUS_LABELS[origin]} sessions`
      : '0 sessions in the collection';
  }
  const sessionWord = filteredCount === 1 ? 'session' : 'sessions';
  const bandWord = bandCount === 1 ? 'age band' : 'age bands';
  if (origin) {
    return `Showing ${filteredCount.toLocaleString()} of ${totalCount.toLocaleString()} sessions (${ORIGIN_STATUS_LABELS[origin]}) across ${bandCount} ${bandWord}, youngest first`;
  }
  return `Showing all ${filteredCount.toLocaleString()} ${sessionWord} across ${bandCount} ${bandWord}, youngest first`;
}
