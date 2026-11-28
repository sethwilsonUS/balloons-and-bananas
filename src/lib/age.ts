/** Document explaining source ages and filename-inferred ages (migrates to /about in ticket 11). */
export const INFERRED_AGE_EXPLANATION_DOC_ID = 'methods-and-audit';

export interface ParsedChatAge {
  years: number;
  months?: number;
  days?: number;
}

const CHAT_AGE_RE = /^(\d+);(?:(\d{1,2})(?:\.(\d{1,2})?)?)?$/;
const STEM_AGE_RE = /^([0-9]{2})([0-9]{2})([0-9]{2})[A-Za-z]?$/;

/**
 * Parse a CHAT age string (years;months.days) without inventing precision.
 * Returns null for unknown, malformed, or out-of-range values.
 */
export function parseChatAge(age: string): ParsedChatAge | null {
  const match = CHAT_AGE_RE.exec(age.trim());
  if (!match) return null;
  const years = Number(match[1]);
  const months = match[2] === undefined ? undefined : Number(match[2]);
  const days = match[3] === undefined ? undefined : Number(match[3]);
  if (!Number.isSafeInteger(years) || (months !== undefined && months > 11) || (days !== undefined && days > 31)) {
    return null;
  }
  return { years, months, days };
}

/**
 * Display a CHAT age without changing the stored value or inventing precision.
 * CHAT writes years;months.days. Explicit zero fields stay visible; omitted
 * fields stay omitted. Unrecognized values remain available verbatim.
 */
export function formatAge(age: string): string {
  const parsed = parseChatAge(age);
  if (!parsed) return age;
  const label = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'}`;
  return [
    label(parsed.years, 'year'),
    ...(parsed.months === undefined ? [] : [label(parsed.months, 'month')]),
    ...(parsed.days === undefined ? [] : [label(parsed.days, 'day')]),
  ].join(', ');
}

/**
 * Derive a CHAT age string (e.g. `2;03.19`) from a 6-digit filename stem with
 * an optional single ASCII letter suffix, rejecting months > 11 or days > 31.
 * Dates are never inferred.
 */
export function inferAgeFromStem(stem: string): string | null {
  const match = STEM_AGE_RE.exec(stem);
  if (!match) return null;
  const years = Number(match[1]);
  const months = Number(match[2]);
  const days = Number(match[3]);
  if (months > 11 || days > 31) return null;
  return `${years};${String(months).padStart(2, '0')}.${String(days).padStart(2, '0')}`;
}

/** Extract the filename stem (basename without its final extension). */
export function filenameStem(sourceName: string): string {
  const base = sourceName.split(/[\\/]/).pop() ?? sourceName;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Compare two parsed CHAT ages chronologically (younger first).
 * Missing sub-fields sort deterministically before explicit zero values.
 */
export function compareParsedAges(a: ParsedChatAge, b: ParsedChatAge): number {
  if (a.years !== b.years) return a.years - b.years;
  const am = a.months ?? -1;
  const bm = b.months ?? -1;
  if (am !== bm) return am - bm;
  const ad = a.days ?? -1;
  const bd = b.days ?? -1;
  return ad - bd;
}

/**
 * Resolve the effective age key for sorting: source age first, else inferred age.
 * Source and inferred ages stay stored and displayed separately.
 */
export function effectiveSessionAge(session: { ages: string[]; inferredAge?: string | null }): ParsedChatAge | null {
  for (const age of session.ages) {
    const parsed = parseChatAge(age);
    if (parsed) return parsed;
  }
  return session.inferredAge ? parseChatAge(session.inferredAge) : null;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base' }) || a.localeCompare(b, 'en');
}

/**
 * Compare sessions by effective age (source age, else inferred age), breaking
 * ties by filename stem (then sourceName and id). Sessions with no valid age
 * always sort last in both directions.
 */
export function compareSessionsByAge(
  a: { id: string; sourceName: string; ages: string[]; inferredAge?: string | null },
  b: { id: string; sourceName: string; ages: string[]; inferredAge?: string | null },
  direction: 'asc' | 'desc' = 'asc',
): number {
  const aAge = effectiveSessionAge(a);
  const bAge = effectiveSessionAge(b);
  const tieBreak = () =>
    compareText(filenameStem(a.sourceName), filenameStem(b.sourceName))
    || compareText(a.sourceName, b.sourceName)
    || compareText(a.id, b.id);

  if (!aAge && !bAge) return tieBreak();
  if (!aAge) return 1;
  if (!bAge) return -1;
  const ageCmp = compareParsedAges(aAge, bAge);
  if (ageCmp !== 0) return direction === 'desc' ? -ageCmp : ageCmp;
  return tieBreak();
}
