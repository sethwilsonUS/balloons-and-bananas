import { compareParsedAges, formatAge, parseChatAge, type ParsedChatAge } from './age';
import { positiveThemes } from './topics';

export type HomepageAgeKind = 'source' | 'inferred' | 'mixed';

export interface HomepageAgeSpan {
  min: ParsedChatAge;
  max: ParsedChatAge;
  minLabel: string;
  maxLabel: string;
  isSingleAge: boolean;
  ageKind: HomepageAgeKind;
}

/** Format a count with proper English singular/plural wording. */
export function formatCount(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function formatParsedAgeFull(age: ParsedChatAge): string {
  const parts = [`${age.years} ${age.years === 1 ? 'year' : 'years'}`];
  if (age.months !== undefined) {
    parts.push(`${age.months} ${age.months === 1 ? 'month' : 'months'}`);
  }
  if (age.days !== undefined) {
    parts.push(`${age.days} ${age.days === 1 ? 'day' : 'days'}`);
  }
  return parts.join(', ');
}

function formatParsedAgeCoarse(age: ParsedChatAge): string {
  const parts = [`${age.years} ${age.years === 1 ? 'year' : 'years'}`];
  if (age.months !== undefined) {
    parts.push(`${age.months} ${age.months === 1 ? 'month' : 'months'}`);
  }
  return parts.join(', ');
}

function resolveSessionAgeWithKind(session: {
  ages: string[];
  inferredAge?: string | null;
}): { parsed: ParsedChatAge; kind: 'source' | 'inferred'; raw: string } | null {
  for (const rawAge of session.ages) {
    const parsed = parseChatAge(rawAge);
    if (parsed) {
      return { parsed, kind: 'source', raw: rawAge.trim() };
    }
  }
  if (session.inferredAge) {
    const parsed = parseChatAge(session.inferredAge);
    if (parsed) {
      return { parsed, kind: 'inferred', raw: session.inferredAge.trim() };
    }
  }
  return null;
}

/**
 * Summarise the observed age span across sessions without inventing precision,
 * while tracking whether source ages, filename-inferred ages, or both contribute.
 */
export function summarizeHomepageAgeSpan(
  sessions: ReadonlyArray<{ ages: string[]; inferredAge?: string | null }>,
): HomepageAgeSpan | null {
  let min: ParsedChatAge | null = null;
  let max: ParsedChatAge | null = null;
  let minRaw = '';
  let maxRaw = '';
  let hasSource = false;
  let hasInferred = false;

  for (const session of sessions) {
    const resolved = resolveSessionAgeWithKind(session);
    if (!resolved) continue;
    if (resolved.kind === 'source') hasSource = true;
    else hasInferred = true;

    if (!min || compareParsedAges(resolved.parsed, min) < 0) {
      min = resolved.parsed;
      minRaw = resolved.raw;
    }
    if (!max || compareParsedAges(resolved.parsed, max) > 0) {
      max = resolved.parsed;
      maxRaw = resolved.raw;
    }
  }

  if (!min || !max) return null;

  const isSingleAge = compareParsedAges(min, max) === 0;
  const sameYearAndMonth = min.years === max.years && min.months === max.months;
  const minLabel = isSingleAge
    ? formatAge(minRaw)
    : sameYearAndMonth
      ? formatParsedAgeFull(min)
      : formatParsedAgeCoarse(min);
  const maxLabel = isSingleAge
    ? formatAge(maxRaw)
    : sameYearAndMonth
      ? formatParsedAgeFull(max)
      : formatParsedAgeCoarse(max);

  const ageKind: HomepageAgeKind =
    hasSource && hasInferred ? 'mixed' : hasSource ? 'source' : 'inferred';

  return { min, max, minLabel, maxLabel, isSingleAge, ageKind };
}

/** Build the Browse by age card description while keeping source and inferred ages explicit. */
export function formatBrowseByAgeDescription(ageSpan: HomepageAgeSpan | null): string {
  if (!ageSpan) {
    return 'Walk through every session youngest-first, grouped by age and filterable by transcript origin.';
  }
  const kindLabel =
    ageSpan.ageKind === 'mixed'
      ? 'source and filename-inferred'
      : ageSpan.ageKind === 'source'
        ? 'recorded source'
        : 'filename-inferred';
  if (ageSpan.isSingleAge) {
    return `Walk through every session youngest-first (${kindLabel} age: ${ageSpan.minLabel}), filterable by transcript origin.`;
  }
  return `Walk through every session youngest-first across ${kindLabel} ages (${ageSpan.minLabel} to ${ageSpan.maxLabel}), filterable by transcript origin.`;
}

/** Count how many curated homepage themes are present in the live catalog topics. */
export function countAvailableCuratedThemes(
  topics: ReadonlyArray<{ name: string; count: number }>,
): number {
  const topicNames = new Set(topics.map(topic => topic.name));
  return positiveThemes.filter(theme => topicNames.has(theme.topic)).length;
}
