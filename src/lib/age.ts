/** Section anchor on `/about` explaining source ages and filename-inferred ages. */
export const INFERRED_AGE_EXPLANATION_HREF = '/about#inferred-ages';

/** Legacy research document ID retained for compatibility references. */
export const INFERRED_AGE_EXPLANATION_DOC_ID = 'methods-and-audit';

/** Upper bound (in total months) accepted for child age-range filters (20 years). */
export const MAX_AGE_MONTHS = 240;

export interface ParsedChatAge {
  years: number;
  months?: number;
  days?: number;
}

export interface AgeMonthBounds {
  minMonths: number;
  maxMonths: number;
}

const CHAT_AGE_RE = /^(\d+);(?:(\d{1,2})(?:\.(\d{1,2})?)?)?$/;
const STEM_AGE_RE = /^([0-9]{2})([0-9]{2})([0-9]{2})[A-Za-z]?$/;
const AGE_MONTHS_PARAM_RE = /^\d{1,3}$/;

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

export function isValidAgeMonths(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_AGE_MONTHS;
}

/**
 * Parse a URL query parameter representing an age bound in total months
 * (strict ASCII non-negative integer within 0..MAX_AGE_MONTHS).
 */
export function parseAgeMonthsParam(value: string | null | undefined): number | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!AGE_MONTHS_PARAM_RE.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return isValidAgeMonths(parsed) ? parsed : undefined;
}

/** Format an integer month count into CHAT `years;months` notation (e.g. `20` -> `1;08`). */
export function formatAgeMonthsChat(totalMonths: number): string {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  return `${years};${String(months).padStart(2, '0')}`;
}

/** Format an integer month count as readable words with CHAT notation (e.g. `1 year, 8 months (1;08)`). */
export function formatAgeMonths(totalMonths: number): string {
  const chat = formatAgeMonthsChat(totalMonths);
  return `${formatAge(chat)} (${chat})`;
}

/**
 * Month interval covered by a parsed CHAT age without inventing precision:
 * exact month when `months` is present, or the full 12-month year when omitted.
 */
export function parsedAgeMonthBounds(age: ParsedChatAge): { min: number; max: number } {
  if (age.months !== undefined) {
    const exact = age.years * 12 + age.months;
    return { min: exact, max: exact };
  }
  return { min: age.years * 12, max: age.years * 12 + 11 };
}

/**
 * Check whether a session's effective age (source age, else filename-inferred age)
 * falls inclusively within `[ageMin, ageMax]` months. Sessions without a valid age
 * are excluded whenever either bound is active.
 */
export function sessionMatchesAgeRange(
  session: { ages: string[]; inferredAge?: string | null },
  ageMin?: number,
  ageMax?: number,
): boolean {
  const hasMin = ageMin !== undefined;
  const hasMax = ageMax !== undefined;
  if (!hasMin && !hasMax) return true;
  if (hasMin && hasMax && ageMin > ageMax) return false;
  const effective = effectiveSessionAge(session);
  if (!effective) return false;
  const { min, max } = parsedAgeMonthBounds(effective);
  if (hasMin && min < ageMin) return false;
  if (hasMax && max > ageMax) return false;
  return true;
}

/** Compute the minimum and maximum month values present across sessions with source or inferred ages. */
export function computeArchiveAgeBounds(
  sessions: ReadonlyArray<{ ages: string[]; inferredAge?: string | null }>,
): AgeMonthBounds | null {
  let minMonths = Infinity;
  let maxMonths = -Infinity;
  for (const session of sessions) {
    const effective = effectiveSessionAge(session);
    if (!effective) continue;
    const { min, max } = parsedAgeMonthBounds(effective);
    if (min < minMonths) minMonths = min;
    if (max > maxMonths) maxMonths = max;
  }
  if (!Number.isFinite(minMonths) || !Number.isFinite(maxMonths)) return null;
  return {
    minMonths: Math.max(0, Math.min(MAX_AGE_MONTHS, minMonths)),
    maxMonths: Math.max(0, Math.min(MAX_AGE_MONTHS, maxMonths)),
  };
}

/**
 * Build sorted integer month options aligned to six-month age-band boundaries
 * around the archive's observed age span, plus any extra valid URL bounds.
 */
export function buildAgeSelectOptions(
  bounds: AgeMonthBounds | null,
  extraMonths: ReadonlyArray<number | undefined> = [],
): number[] {
  const values = new Set<number>();
  if (bounds) {
    const start = Math.max(0, Math.floor(bounds.minMonths / 6) * 6);
    const end = Math.min(MAX_AGE_MONTHS, Math.floor(bounds.maxMonths / 6) * 6 + 5);
    for (let month = start; month <= end; month += 1) {
      values.add(month);
    }
  }
  for (const extra of extraMonths) {
    if (isValidAgeMonths(extra)) values.add(extra);
  }
  return [...values].sort((a, b) => a - b);
}

/** Privacy-safe categorical bucket for age-range filter analytics (zero exact ages or free text). */
export function ageFilterBucket(ageMin?: number, ageMax?: number): '' | 'min' | 'max' | 'range' {
  const hasMin = isValidAgeMonths(ageMin);
  const hasMax = isValidAgeMonths(ageMax);
  if (hasMin && hasMax) return 'range';
  if (hasMin) return 'min';
  if (hasMax) return 'max';
  return '';
}
