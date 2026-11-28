import { compareSessionsByAge, formatAge } from './age';
import { formatDurationWords } from './audio-player';
import { isLinguisticMarkerId } from './linguistic-markers';
import type { Passage, Session } from './types';

export type SessionHashTarget =
  | { kind: 'passage'; passage: number }
  | { kind: 'time'; seconds: number };

export interface AdjacentSession {
  slug: string;
  ages: string[];
  inferredAge: string | null;
}

export interface AdjacentSessions {
  previous: AdjacentSession | null;
  next: AdjacentSession | null;
}

export interface NearestPassageResult {
  index: number;
  timed: boolean;
}

const PASSAGE_HASH_RE = /^p([1-9]\d*)$/i;
const TIME_HASH_RE = /^t=(.+)$/i;
const PLAIN_SECONDS_RE = /^(\d+)$/;
const MINUTES_SECONDS_RE = /^(\d+):([0-5]\d)$/;
const HOURS_MINUTES_SECONDS_RE = /^(\d+):([0-5]\d):([0-5]\d)$/;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

/**
 * Parse a session URL fragment into a passage anchor (`#p42`) or audio time
 * target (`#t=12:34`, `#t=1:02:03`, `#t=754`). Returns null for other hashes
 * (such as section anchors `#guide`, `#moments`, `#transcript`) or invalid values.
 */
export function parseSessionHash(rawHash: string): SessionHashTarget | null {
  const trimmed = rawHash.trim();
  const fragment = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (!fragment) return null;

  const passageMatch = PASSAGE_HASH_RE.exec(fragment);
  if (passageMatch) {
    const passage = Number(passageMatch[1]);
    return Number.isSafeInteger(passage) && passage > 0
      ? { kind: 'passage', passage }
      : null;
  }

  const timeMatch = TIME_HASH_RE.exec(fragment);
  if (!timeMatch) return null;

  let value: string;
  try {
    value = decodeURIComponent(timeMatch[1].trim());
  } catch {
    return null;
  }
  if (!value) return null;

  const plain = PLAIN_SECONDS_RE.exec(value);
  if (plain) {
    const seconds = Number(plain[1]);
    return Number.isSafeInteger(seconds) && seconds >= 0
      ? { kind: 'time', seconds }
      : null;
  }

  const mmss = MINUTES_SECONDS_RE.exec(value);
  if (mmss) {
    const minutes = Number(mmss[1]);
    const secs = Number(mmss[2]);
    const seconds = minutes * 60 + secs;
    return Number.isSafeInteger(seconds) && seconds >= 0
      ? { kind: 'time', seconds }
      : null;
  }

  const hhmmss = HOURS_MINUTES_SECONDS_RE.exec(value);
  if (hhmmss) {
    const hours = Number(hhmmss[1]);
    const minutes = Number(hhmmss[2]);
    const secs = Number(hhmmss[3]);
    const seconds = hours * 3600 + minutes * 60 + secs;
    return Number.isSafeInteger(seconds) && seconds >= 0
      ? { kind: 'time', seconds }
      : null;
  }

  return null;
}

/**
 * Locate the transcript passage covering or nearest to `seconds`.
 * Falls back to passage index 0 (`timed: false`) when no passages carry timestamps.
 */
export function findNearestPassageIndex(
  transcript: readonly Passage[],
  seconds: number,
): NearestPassageResult | null {
  if (transcript.length === 0 || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }

  let bestIndex = -1;
  let bestDistance = Infinity;
  let bestStartDistance = Infinity;

  for (let index = 0; index < transcript.length; index += 1) {
    const passage = transcript[index];
    if (typeof passage.start !== 'number' || !Number.isFinite(passage.start)) {
      continue;
    }

    const hasEnd = typeof passage.end === 'number'
      && Number.isFinite(passage.end)
      && passage.end > passage.start;

    if (hasEnd && seconds >= passage.start && seconds < passage.end!) {
      return { index, timed: true };
    }

    const intervalDistance = hasEnd
      ? (seconds < passage.start ? passage.start - seconds : seconds - passage.end!)
      : Math.abs(passage.start - seconds);
    const startDistance = Math.abs(passage.start - seconds);

    if (
      intervalDistance < bestDistance
      || (intervalDistance === bestDistance && startDistance < bestStartDistance)
    ) {
      bestIndex = index;
      bestDistance = intervalDistance;
      bestStartDistance = startDistance;
    }
  }

  if (bestIndex !== -1) {
    return { index: bestIndex, timed: true };
  }
  return { index: 0, timed: false };
}

/**
 * Format the polite live-region announcement for `#t=` deep links. Timestamp
 * links are transcript-only orientation aids: they jump to the nearest
 * timestamped passage and never prepare or play the recording.
 */
export function formatTimeLinkAnnouncement(
  seconds: number,
  nearest: { passage: number; timed: boolean } | null,
): string {
  const spoken = formatDurationWords(seconds);
  if (!nearest) {
    return 'This session has no transcript passages to show.';
  }
  if (!nearest.timed) {
    return `This transcript has no timestamps, so ${spoken} cannot be matched to a passage. Showing the transcript from the beginning.`;
  }
  return `Showing passage ${nearest.passage}, the transcript passage nearest ${spoken}. Timestamps are approximate.`;
}

function toAdjacentSession(session: Pick<Session, 'slug' | 'ages' | 'inferredAge'>): AdjacentSession {
  return {
    slug: session.slug,
    ages: [...session.ages],
    inferredAge: session.inferredAge,
  };
}

/**
 * Resolve the previous and next sessions around `currentSlug` in canonical age
 * order (source age, else filename-inferred age; ties broken by filename stem;
 * unaged sessions last).
 */
export function getAdjacentSessions(
  sessions: readonly Pick<Session, 'id' | 'slug' | 'sourceName' | 'ages' | 'inferredAge'>[],
  currentSlug: string,
): AdjacentSessions {
  if (!sessions.length) return { previous: null, next: null };
  const ordered = [...sessions].sort((a, b) => compareSessionsByAge(a, b, 'asc'));
  const index = ordered.findIndex(session => session.slug === currentSlug);
  if (index === -1) return { previous: null, next: null };
  return {
    previous: index > 0 ? toAdjacentSession(ordered[index - 1]) : null,
    next: index < ordered.length - 1 ? toAdjacentSession(ordered[index + 1]) : null,
  };
}

/**
 * Format age text for prev/next session links while keeping source ages and
 * filename-inferred ages clearly distinguished.
 */
export function formatAdjacentAgeSummary(session: Pick<AdjacentSession, 'ages' | 'inferredAge'>): {
  text: string;
  inferred: boolean;
} {
  if (session.ages.length > 0) {
    const spoken = session.ages.map(formatAge).join(' / ');
    const code = session.ages.join(' / ');
    return { text: `${spoken} (${code})`, inferred: false };
  }
  if (session.inferredAge) {
    return {
      text: `${formatAge(session.inferredAge)} (${session.inferredAge}, inferred from filename)`,
      inferred: true,
    };
  }
  return { text: 'age not recorded', inferred: false };
}

/**
 * Validate a candidate "Back to results" URL so only safe, same-origin search
 * or browse paths are accepted (never external origins or arbitrary paths).
 * Returns a clean root-relative path + search string, or null if invalid.
 */
export function resolveBackToResultsUrl(
  candidate: string | null | undefined,
  currentOrigin: string,
): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (!trimmed || CONTROL_CHAR_RE.test(trimmed)) return null;
  if (trimmed.startsWith('//') || trimmed.startsWith('\\')) return null;

  let baseOrigin: string;
  try {
    const parsedBase = new URL(currentOrigin);
    if (parsedBase.protocol !== 'http:' && parsedBase.protocol !== 'https:') return null;
    baseOrigin = parsedBase.origin;
  } catch {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed, baseOrigin);
  } catch {
    return null;
  }

  if (parsed.origin !== baseOrigin) return null;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const hasRootDetailSelector = Boolean(
    parsed.searchParams.get('entry')?.trim()
    || parsed.searchParams.get('document')?.trim(),
  );
  const isAllowedRoute =
    parsed.pathname === '/search'
    || parsed.pathname === '/sessions'
    || (
      parsed.pathname === '/'
      && !hasRootDetailSelector
      && (
        parsed.searchParams.get('section') === 'sessions'
        || isLinguisticMarkerId(parsed.searchParams.get('marker')?.trim())
      )
    );

  if (!isAllowedRoute) return null;
  return `${parsed.pathname}${parsed.search}`;
}

export const DEFAULT_BACK_TO_RESULTS_HREF = '/sessions';

/** Pick the first safe referring search/browse URL, falling back to `/sessions`. */
export function getBackToResultsHref(
  candidates: readonly (string | null | undefined)[],
  currentOrigin: string,
): string {
  for (const candidate of candidates) {
    const resolved = resolveBackToResultsUrl(candidate, currentOrigin);
    if (resolved) return resolved;
  }
  return DEFAULT_BACK_TO_RESULTS_HREF;
}

/** Build the canonical absolute URL for a numbered transcript passage. */
export function formatCanonicalPassageUrl(slug: string, passageNumber: number, origin: string): string {
  return new URL(`/sessions/${encodeURIComponent(slug)}#p${passageNumber}`, origin).toString();
}
