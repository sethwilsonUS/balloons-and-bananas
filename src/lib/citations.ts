import { ARCHIVE_NAME } from './site';
import type { TranscriptOrigin } from './types';

export type CitationFormat = 'chicago' | 'apa' | 'bibtex';

export const CITATION_FORMATS: readonly CitationFormat[] = ['chicago', 'apa', 'bibtex'];

export const CITATION_FORMAT_LABELS: Record<CitationFormat, string> = {
  chicago: 'Chicago',
  apa: 'APA',
  bibtex: 'BibTeX',
};

export const CORPUS_TITLE = 'CHILDES English Peters/Wilson Corpus';
export const CORPUS_DOI_ID = '10.21415/T5NS4D';
export const CORPUS_DOI_URL = `https://doi.org/${CORPUS_DOI_ID}`;
export const CORPUS_TALKBANK_PAGE_URL = 'https://talkbank.org/childes/access/Eng-NA/Peters.html';
export const CORPUS_CREDIT_LINE = `Peters, Ann, and Bob Wilson. ${CORPUS_TITLE} (TalkBank, ${CORPUS_DOI_URL}), via ${ARCHIVE_NAME}`;
export const AI_DRAFT_QUALIFIER = '(machine transcription, unreviewed)';

export interface AccompanyingPublication {
  id: string;
  shortLabel: string;
  citation: string;
  doiUrl: string;
}

/** TalkBank's accompanying citations for research using Peters/Wilson corpus data. */
export const ACCOMPANYING_PUBLICATIONS: readonly AccompanyingPublication[] = [
  {
    id: 'peters-1987',
    shortLabel: 'Peters (1987)',
    citation: 'Peters, Ann M. (1987). The role of imitation in the developing syntax of a blind child. Text, 7(3), 289–311.',
    doiUrl: 'https://doi.org/10.1515/text.1.1987.7.3.289',
  },
  {
    id: 'wilson-peters-1988',
    shortLabel: 'Wilson & Peters (1988)',
    citation: 'Wilson, Bob, and Ann M. Peters (1988). What are you cookin’ on a hot?: Movement constraints in the speech of a three-year-old blind child. Language, 64(2), 249–273.',
    doiUrl: 'https://doi.org/10.2307/415434',
  },
];

/**
 * Only source-transcript metadata enters a citation; AI-written guide fields
 * (title, overview, topics, moments) are intentionally excluded so guide text
 * is never cited as speech.
 */
export interface CitationSessionInput {
  slug: string;
  ages: readonly string[];
  inferredAge: string | null;
  dates: readonly string[];
  origin: TranscriptOrigin;
}

export interface CitationOptions {
  /** 1-based transcript passage number; omit or pass null for a whole session. */
  passageNumber?: number | null;
  /** HTTP(S) origin (e.g. "https://example.org"); omitted or invalid values fall back to root-relative paths. */
  origin?: string | null;
  /** Access date as `YYYY-MM-DD` or `Date` (read in UTC). Defaults to today's UTC date. */
  accessDate?: Date | string;
}

export interface SessionCitations {
  chicago: string;
  apa: string;
  bibtex: string;
  bibtexKey: string;
  url: string;
  accessDateIso: string;
  accessDateReadable: string;
  targetLabel: string;
  originDescription: string;
  isAiDraft: boolean;
  ageLabel: string | null;
  ageIsInferred: boolean;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const BIBTEX_MONTH_MACROS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BARE_YEAR_RE = /^(\d{4})$/;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]+/g;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function parseIsoCalendarDate(raw: string): CalendarDate | null {
  const match = ISO_DATE_RE.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function formatCalendarDateIso(date: CalendarDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function formatCalendarDateReadable(date: CalendarDate): string {
  return `${MONTH_NAMES[date.month - 1]} ${date.day}, ${date.year}`;
}

/** Format a local browser calendar date as `YYYY-MM-DD` without UTC day drift. */
export function formatLocalCalendarDateIso(date: Date = new Date()): string {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Invalid date');
  }
  return formatCalendarDateIso({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
}

function resolveAccessDate(input?: Date | string): CalendarDate {
  if (input === undefined) {
    const now = new Date();
    return {
      year: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
      day: now.getUTCDate(),
    };
  }
  if (typeof input === 'string') {
    const parsed = parseIsoCalendarDate(input);
    if (!parsed) {
      throw new RangeError(`Invalid access date "${input}": expected YYYY-MM-DD.`);
    }
    return parsed;
  }
  if (!(input instanceof Date) || Number.isNaN(input.getTime())) {
    throw new RangeError('Invalid access date: expected a valid Date or YYYY-MM-DD string.');
  }
  return {
    year: input.getUTCFullYear(),
    month: input.getUTCMonth() + 1,
    day: input.getUTCDate(),
  };
}

function assertValidSlug(slug: string): string {
  const trimmed = slug.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    throw new RangeError('Citation session slug must be a valid non-empty session identifier.');
  }
  return trimmed;
}

function normalizePassageNumber(passageNumber?: number | null): number | null {
  if (passageNumber === undefined || passageNumber === null) return null;
  if (typeof passageNumber !== 'number' || !Number.isSafeInteger(passageNumber) || passageNumber < 1) {
    throw new RangeError(`Invalid passage number "${String(passageNumber)}": expected a positive integer.`);
  }
  return passageNumber;
}

/**
 * Format the canonical URL for a session (`/sessions/<slug>`) or passage
 * (`/sessions/<slug>#p<N>`), prepending a validated HTTP(S) origin when given.
 */
export function formatCanonicalCitationUrl(
  slug: string,
  passageNumber?: number | null,
  origin?: string | null,
): string {
  const cleanSlug = assertValidSlug(slug);
  const validPassage = normalizePassageNumber(passageNumber);
  const relative = `/sessions/${encodeURIComponent(cleanSlug)}${validPassage === null ? '' : `#p${validPassage}`}`;

  const trimmedOrigin = origin?.trim();
  if (!trimmedOrigin) return relative;

  try {
    const parsedOrigin = new URL(trimmedOrigin);
    if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
      return relative;
    }
    return new URL(relative, parsedOrigin.origin).toString();
  } catch {
    return relative;
  }
}

/**
 * Build a deterministic, BibTeX-safe citation key:
 * `sethtapes_<sanitizedSlug>` or `sethtapes_<sanitizedSlug>_p<N>` (e.g. `sethtapes_010626_p42`).
 * Slug punctuation maps to hyphens (`-`) while `_p<N>` is reserved for the passage
 * suffix so no session slug (such as `010626-p42`) can collide with a passage key.
 */
export function formatBibtexKey(slug: string, passageNumber?: number | null): string {
  const cleanSlug = assertValidSlug(slug);
  const validPassage = normalizePassageNumber(passageNumber);
  const sanitized = cleanSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'session';
  return validPassage === null
    ? `sethtapes_${sanitized}`
    : `sethtapes_${sanitized}_p${validPassage}`;
}

const BIBTEX_ESCAPE_MAP: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\textbraceleft{}',
  '}': '\\textbraceright{}',
  '&': '\\&',
  '%': '\\%',
  '$': '\\$',
  '#': '\\#',
  '_': '\\_',
  '^': '\\textasciicircum{}',
  '~': '\\textasciitilde{}',
};

/** Escape a plain text string for safe inclusion inside a BibTeX `{...}` field. */
export function escapeBibtexValue(value: string): string {
  const collapsed = value.replace(CONTROL_CHAR_RE, ' ').replace(/\s+/g, ' ').trim();
  return collapsed.replace(/[\\{}&%$#_^~]/g, ch => BIBTEX_ESCAPE_MAP[ch] ?? ch);
}

/** Guard a URL for inclusion in a BibTeX `url = {...}` field while keeping `#pN` intact. */
function escapeBibtexUrl(url: string): string {
  return url
    .replace(CONTROL_CHAR_RE, '')
    .replace(/\s+/g, '%20')
    .replace(/\\/g, '%5C')
    .replace(/\{/g, '%7B')
    .replace(/\}/g, '%7D');
}

/** Format the provenance phrase for a transcript origin, marking AI drafts as unreviewed. */
export function formatOriginCitationDescription(origin: TranscriptOrigin): {
  sentence: string;
  isAiDraft: boolean;
} {
  switch (origin) {
    case 'archived_research':
      return { sentence: 'Archived research transcript', isAiDraft: false };
    case 'talkbank_ai_draft':
      return { sentence: `TalkBank AI draft ${AI_DRAFT_QUALIFIER}`, isAiDraft: true };
    case 'local_ai_draft':
      return { sentence: `Local AI draft ${AI_DRAFT_QUALIFIER}`, isAiDraft: true };
  }
}

function resolveAgeMetadata(session: Pick<CitationSessionInput, 'ages' | 'inferredAge'>): {
  label: string | null;
  inferred: boolean;
} {
  const sourceAges = session.ages.map(age => age.trim()).filter(Boolean);
  if (sourceAges.length > 0) {
    return { label: `age ${sourceAges.join(' / ')}`, inferred: false };
  }
  const inferred = session.inferredAge?.trim();
  if (inferred) {
    return { label: `inferred age ${inferred}`, inferred: true };
  }
  return { label: null, inferred: false };
}

interface ResolvedRecordingDates {
  readableList: string | null;
  apaDateSlot: string;
  bibtexYear: string | null;
  bibtexMonth: string | null;
}

function resolveRecordingDates(rawDates: readonly string[]): ResolvedRecordingDates {
  const cleaned = rawDates.map(value => value.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return {
      readableList: null,
      apaDateSlot: 'n.d.',
      bibtexYear: null,
      bibtexMonth: null,
    };
  }

  const parsedEntries = cleaned.map(raw => {
    const iso = parseIsoCalendarDate(raw);
    if (iso) {
      return {
        raw,
        readable: formatCalendarDateReadable(iso),
        apa: `${iso.year}, ${MONTH_NAMES[iso.month - 1]} ${iso.day}`,
        year: String(iso.year),
        monthMacro: BIBTEX_MONTH_MACROS[iso.month - 1],
      };
    }
    const bareYear = BARE_YEAR_RE.exec(raw);
    if (bareYear) {
      return {
        raw,
        readable: bareYear[1],
        apa: bareYear[1],
        year: bareYear[1],
        monthMacro: null,
      };
    }
    return {
      raw,
      readable: raw,
      apa: raw,
      year: null,
      monthMacro: null,
    };
  });

  const years = new Set(parsedEntries.map(entry => entry.year));
  const bibtexYear = years.size === 1 ? (parsedEntries[0].year ?? null) : null;
  const bibtexMonth = parsedEntries.length === 1 ? parsedEntries[0].monthMacro : null;

  return {
    readableList: parsedEntries.map(entry => entry.readable).join(' / '),
    apaDateSlot: parsedEntries.map(entry => entry.apa).join(' / '),
    bibtexYear,
    bibtexMonth,
  };
}

/**
 * Generate Chicago, APA, and BibTeX citations for a whole session or a single
 * numbered transcript passage.
 */
export function buildSessionCitations(
  session: CitationSessionInput,
  options: CitationOptions = {},
): SessionCitations {
  const slug = assertValidSlug(session.slug);
  const passageNumber = normalizePassageNumber(options.passageNumber);
  const accessDate = resolveAccessDate(options.accessDate);
  const accessDateIso = formatCalendarDateIso(accessDate);
  const accessDateReadable = formatCalendarDateReadable(accessDate);
  const url = formatCanonicalCitationUrl(slug, passageNumber, options.origin);
  const bibtexKey = formatBibtexKey(slug, passageNumber);

  const targetLabel = passageNumber === null
    ? `Session ${slug}`
    : `Session ${slug}, passage ${passageNumber}`;

  const age = resolveAgeMetadata(session);
  const dates = resolveRecordingDates(session.dates);
  const originInfo = formatOriginCitationDescription(session.origin);

  const corpusPhrase = `${CORPUS_TITLE} (TalkBank, ${CORPUS_DOI_URL}), via ${ARCHIVE_NAME}`;

  // Chicago: Author. "Session <slug>[, passage <N>]" (age / recorded date). Origin. In Corpus. Accessed <Date>. <URL>
  const chicagoDetails: string[] = [];
  if (age.label) chicagoDetails.push(age.label);
  if (dates.readableList) chicagoDetails.push(`recorded ${dates.readableList}`);
  const chicagoTarget = chicagoDetails.length > 0
    ? `"${targetLabel}" (${chicagoDetails.join('; ')}).`
    : `"${targetLabel}."`;
  const chicago = [
    'Peters, Ann, and Bob Wilson.',
    chicagoTarget,
    `${originInfo.sentence}.`,
    `In ${corpusPhrase}.`,
    `Accessed ${accessDateReadable}.`,
    url,
  ].join(' ');

  // APA 7th: Peters, A., & Wilson, B. (<Date|n.d.>). Session <slug>[, passage <N>] [(age)]. [Origin]. Corpus. Retrieved <Date>, from <URL>
  const apaTarget = age.label ? `${targetLabel} (${age.label})` : targetLabel;
  const apa = [
    `Peters, A., & Wilson, B. (${dates.apaDateSlot}).`,
    `${apaTarget} [${originInfo.sentence}].`,
    `${corpusPhrase}.`,
    `Retrieved ${accessDateReadable}, from ${url}`,
  ].join(' ');

  // BibTeX (@misc)
  const noteParts = [originInfo.sentence];
  if (age.label) noteParts.push(age.label);
  if (dates.readableList) noteParts.push(`recorded ${dates.readableList}`);
  noteParts.push(`accessed ${accessDateReadable}`);

  const bibtexFields: Array<[string, string, boolean]> = [
    ['author', 'Peters, Ann and Wilson, Bob', true],
    ['title', `{${escapeBibtexValue(targetLabel)}}`, true],
  ];
  if (dates.bibtexYear) {
    bibtexFields.push(['year', dates.bibtexYear, true]);
  }
  if (dates.bibtexMonth) {
    bibtexFields.push(['month', dates.bibtexMonth, false]);
  }
  bibtexFields.push(
    ['howpublished', escapeBibtexValue(corpusPhrase), true],
    ['doi', CORPUS_DOI_ID, true],
    ['url', escapeBibtexUrl(url), true],
    ['urldate', accessDateIso, true],
    ['note', escapeBibtexValue(noteParts.join('; ')), true],
  );

  const bibtexLines = bibtexFields.map(([field, value, braced], idx) => {
    const padded = field.padEnd(12, ' ');
    const formattedValue = braced ? `{${value}}` : value;
    const suffix = idx < bibtexFields.length - 1 ? ',' : '';
    return `  ${padded} = ${formattedValue}${suffix}`;
  });
  const bibtex = `@misc{${bibtexKey},\n${bibtexLines.join('\n')}\n}`;

  return {
    chicago,
    apa,
    bibtex,
    bibtexKey,
    url,
    accessDateIso,
    accessDateReadable,
    targetLabel,
    originDescription: originInfo.sentence,
    isAiDraft: originInfo.isAiDraft,
    ageLabel: age.label,
    ageIsInferred: age.inferred,
  };
}
