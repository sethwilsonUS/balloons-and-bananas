import { compareParsedAges, compareSessionsByAge, effectiveSessionAge, isValidAgeMonths, sessionMatchesAgeRange } from './age';
import { isLinguisticMarkerId, isLinguisticSpeaker } from './linguistic-markers';
import { passageMatchesMarker, passageMatchesSpeakerScope, passageSpeechText } from './linguistic-search';
import { isTranscriptOrigin } from './results-view';
import type {
  ArchiveData,
  ConcordancePageSize,
  ConcordanceRequest,
  ConcordanceResponse,
  ConcordanceRow,
  Passage,
  Session,
} from './types';

export const CONCORDANCE_PAGE_SIZE: ConcordancePageSize = 50;
export const CONCORDANCE_CONTEXT_CHARS = 72;
export const MAX_CONCORDANCE_QUERY_LENGTH = 300;

const WORD_CHAR_RE = /[\p{L}\p{N}]/u;
const COMBINING_MARK_RE = /\p{Mn}/gu;
const NONSPACING_MARK_RE = /\p{Mn}/u;
const APOSTROPHE_RE = /[‘’ʼ]/g;

export function isConcordancePageSize(value: unknown): value is ConcordancePageSize {
  return value === CONCORDANCE_PAGE_SIZE;
}

/**
 * Runtime boundary validator for `/api/concordance` POST request JSON bodies.
 * Rejects malformed types, overlong queries, invalid enums, out-of-range/inverted ages, and unsupported page sizes.
 */
export function parseConcordanceBody(
  body: unknown,
): { ok: true; request: ConcordanceRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Invalid concordance request.' };
  }
  const input = body as Record<string, unknown>;
  const request: ConcordanceRequest = {};

  if (input.query !== undefined) {
    if (typeof input.query !== 'string') return { ok: false, error: 'Invalid concordance query.' };
    if (input.query.trim().length > MAX_CONCORDANCE_QUERY_LENGTH) {
      return { ok: false, error: 'Concordance query is too long.' };
    }
    request.query = input.query;
  }
  if (input.topic !== undefined) {
    if (typeof input.topic !== 'string') return { ok: false, error: 'Invalid theme filter.' };
    request.topic = input.topic;
  }
  if (input.origin !== undefined) {
    if (typeof input.origin !== 'string') return { ok: false, error: 'Invalid transcript origin filter.' };
    if (input.origin !== '' && !isTranscriptOrigin(input.origin)) {
      return { ok: false, error: 'Invalid transcript origin filter.' };
    }
    request.origin = input.origin;
  }
  if (input.ageMin !== undefined) {
    if (!isValidAgeMonths(input.ageMin)) return { ok: false, error: 'Invalid minimum age.' };
    request.ageMin = input.ageMin;
  }
  if (input.ageMax !== undefined) {
    if (!isValidAgeMonths(input.ageMax)) return { ok: false, error: 'Invalid maximum age.' };
    request.ageMax = input.ageMax;
  }
  if (request.ageMin !== undefined && request.ageMax !== undefined && request.ageMin > request.ageMax) {
    return { ok: false, error: 'Minimum age cannot be greater than maximum age.' };
  }
  if (input.page !== undefined) {
    if (typeof input.page !== 'number' || !Number.isFinite(input.page)) return { ok: false, error: 'Invalid page.' };
    request.page = input.page;
  }
  if (input.pageSize !== undefined) {
    if (!isConcordancePageSize(input.pageSize)) return { ok: false, error: 'Invalid page size.' };
    request.pageSize = input.pageSize;
  }
  if (input.marker !== undefined) {
    if (typeof input.marker !== 'string') return { ok: false, error: 'Invalid linguistic marker.' };
    if (input.marker !== '' && !isLinguisticMarkerId(input.marker)) {
      return { ok: false, error: 'Invalid linguistic marker.' };
    }
    request.marker = input.marker;
  }
  if (input.speaker !== undefined) {
    if (typeof input.speaker !== 'string') return { ok: false, error: 'Invalid speaker scope.' };
    if (!isLinguisticSpeaker(input.speaker)) return { ok: false, error: 'Invalid speaker scope.' };
    request.speaker = input.speaker;
  }

  return { ok: true, request };
}

interface FoldedTextMap {
  folded: string;
  srcStarts: number[];
  srcEnds: number[];
}

interface CompiledConcordanceQuery {
  folded: string;
  startsWord: boolean;
  endsWord: boolean;
}

interface MatchOffsets {
  origStart: number;
  origEnd: number;
}

/**
 * Normalize text for exact concordance matching (case-, accent-, apostrophe-,
 * and whitespace-normalized) while keeping exact UTF-16 source start/end spans
 * for every folded code unit so multi-byte characters, surrogate pairs, and
 * combining marks (`\p{Mn}`) are never split when slicing source text.
 */
function foldWithSourceMap(raw: string): FoldedTextMap {
  const foldedUnits: string[] = [];
  const srcStarts: number[] = [];
  const srcEnds: number[] = [];

  let offset = 0;
  let pendingWhitespaceStart = -1;
  let pendingWhitespaceEnd = -1;

  const flushWhitespace = () => {
    if (pendingWhitespaceStart === -1) return;
    foldedUnits.push(' ');
    srcStarts.push(pendingWhitespaceStart);
    srcEnds.push(pendingWhitespaceEnd);
    pendingWhitespaceStart = -1;
    pendingWhitespaceEnd = -1;
  };

  while (offset < raw.length) {
    const codePoint = raw.codePointAt(offset)!;
    const unitLength = codePoint > 0xffff ? 2 : 1;
    const nextOffset = offset + unitLength;
    const char = raw.slice(offset, nextOffset);

    if (/\s/.test(char)) {
      if (pendingWhitespaceStart === -1) pendingWhitespaceStart = offset;
      pendingWhitespaceEnd = nextOffset;
      offset = nextOffset;
      continue;
    }

    flushWhitespace();

    const normalized = char
      .normalize('NFKD')
      .replace(COMBINING_MARK_RE, '')
      .replace(APOSTROPHE_RE, "'")
      .toLocaleLowerCase();

    if (!normalized) {
      // Nonspacing combining mark following a base character: extend the
      // previous character's source span so slicing keeps the mark attached.
      if (srcEnds.length > 0) {
        const previousEnd = srcEnds[srcEnds.length - 1];
        let back = srcEnds.length - 1;
        while (back >= 0 && srcEnds[back] === previousEnd) {
          srcEnds[back] = nextOffset;
          back -= 1;
        }
      }
      offset = nextOffset;
      continue;
    }

    for (let i = 0; i < normalized.length; i += 1) {
      foldedUnits.push(normalized[i]);
      srcStarts.push(offset);
      srcEnds.push(nextOffset);
    }
    offset = nextOffset;
  }

  flushWhitespace();

  return {
    folded: foldedUnits.join(''),
    srcStarts,
    srcEnds,
  };
}

function codePointBefore(text: string, index: number): string {
  const prev = text.charCodeAt(index - 1);
  if (prev >= 0xdc00 && prev <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) {
      return text.slice(index - 2, index);
    }
  }
  return text.slice(index - 1, index);
}

function codePointAtSlice(text: string, index: number): string {
  const cp = text.codePointAt(index);
  return cp === undefined ? '' : String.fromCodePoint(cp);
}

function compileConcordanceQuery(rawQuery: string): CompiledConcordanceQuery | null {
  let trimmed = rawQuery.trim();
  if (!trimmed || trimmed.length > MAX_CONCORDANCE_QUERY_LENGTH) return null;
  if (
    trimmed.length >= 2
    && (
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith('“') && trimmed.endsWith('”'))
    )
  ) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner) trimmed = inner;
  }
  const folded = foldWithSourceMap(trimmed).folded.trim();
  if (!folded) return null;
  return {
    folded,
    startsWord: WORD_CHAR_RE.test(codePointAtSlice(folded, 0)),
    endsWord: WORD_CHAR_RE.test(codePointBefore(folded, folded.length)),
  };
}

function collapseInnerWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncateLeftContext(rawLeft: string, maxChars: number): string {
  const normalized = collapseInnerWhitespace(rawLeft);
  if (!normalized) return '';
  const codePoints = Array.from(normalized);
  if (codePoints.length <= maxChars) return normalized;

  let startIndex = codePoints.length - maxChars;
  // Never start a slice on a dangling combining mark from NFD text.
  while (startIndex < codePoints.length && NONSPACING_MARK_RE.test(codePoints[startIndex])) {
    startIndex += 1;
  }
  let slice = codePoints.slice(startIndex);
  const firstSpace = slice.indexOf(' ');
  // Snap forward to a word boundary when doing so keeps a readable window.
  if (firstSpace > 0 && firstSpace <= Math.min(18, Math.floor(maxChars / 3))) {
    slice = slice.slice(firstSpace + 1);
  }
  const text = slice.join('').trimStart();
  return text ? `…${text}` : '';
}

function truncateRightContext(rawRight: string, maxChars: number): string {
  const normalized = collapseInnerWhitespace(rawRight);
  if (!normalized) return '';
  const codePoints = Array.from(normalized);
  if (codePoints.length <= maxChars) return normalized;

  let endIndex = maxChars;
  // If the cut lands inside a base + combining-mark sequence, omit that final
  // combining sequence rather than splitting it or exceeding maxChars.
  if (endIndex < codePoints.length && NONSPACING_MARK_RE.test(codePoints[endIndex])) {
    let seqStart = endIndex - 1;
    while (seqStart > 0 && NONSPACING_MARK_RE.test(codePoints[seqStart])) {
      seqStart -= 1;
    }
    endIndex = seqStart;
  }
  if (endIndex === 0) return '…';
  let slice = codePoints.slice(0, endIndex);
  const lastSpace = slice.lastIndexOf(' ');
  const minKeep = Math.floor((maxChars * 2) / 3);
  if (lastSpace >= minKeep) {
    slice = slice.slice(0, lastSpace);
  }
  const text = slice.join('').trimEnd();
  return text ? `${text}…` : '';
}

export interface ConcordanceMatchSlice {
  leftContext: string;
  match: string;
  rightContext: string;
}

function findConcordanceMatchOffsets(
  speechText: string,
  compiled: CompiledConcordanceQuery,
): MatchOffsets | null {
  if (!speechText) return null;
  const { folded, srcStarts, srcEnds } = foldWithSourceMap(speechText);
  if (!folded || folded.length < compiled.folded.length) return null;

  let searchFrom = 0;
  while (searchFrom <= folded.length - compiled.folded.length) {
    const at = folded.indexOf(compiled.folded, searchFrom);
    if (at === -1) return null;
    const end = at + compiled.folded.length;

    // Require both endpoints to align with complete source characters so a match
    // never lands strictly inside a single character's NFKD expansion (e.g. `1` in `½`).
    const leftAligned = at === 0 || srcStarts[at] !== srcStarts[at - 1];
    const rightAligned = end === folded.length || srcEnds[end - 1] !== srcEnds[end];
    const leftOk = leftAligned && (!compiled.startsWord || at === 0 || !WORD_CHAR_RE.test(codePointBefore(folded, at)));
    const rightOk = rightAligned && (!compiled.endsWord || end === folded.length || !WORD_CHAR_RE.test(codePointAtSlice(folded, end)));

    if (leftOk && rightOk) {
      return {
        origStart: srcStarts[at],
        origEnd: srcEnds[end - 1],
      };
    }

    searchFrom = at + 1;
  }

  return null;
}

function formatConcordanceSlice(
  speechText: string,
  offsets: MatchOffsets,
  maxContextChars: number,
): ConcordanceMatchSlice {
  return {
    leftContext: truncateLeftContext(speechText.slice(0, offsets.origStart), maxContextChars),
    match: speechText.slice(offsets.origStart, offsets.origEnd),
    rightContext: truncateRightContext(speechText.slice(offsets.origEnd), maxContextChars),
  };
}

/**
 * Find the first exact occurrence of `rawQuery` in `speechText` and split the
 * passage into bounded left context, exact matched source text, and bounded
 * right context.
 *
 * Word-like edges enforce Unicode letter/number boundaries (so `"no"` never
 * matches `"not"` or `"piano"`), while punctuation/CHAT notation edges (such as
 * `"[/]"`, `"[//]"`, or `"(.)"`) match verbatim without requiring word boundaries.
 */
export function extractConcordanceMatch(
  speechText: string,
  rawQuery: string,
  maxContextChars = CONCORDANCE_CONTEXT_CHARS,
): ConcordanceMatchSlice | null {
  const compiled = compileConcordanceQuery(rawQuery);
  if (!compiled) return null;
  const offsets = findConcordanceMatchOffsets(speechText, compiled);
  if (!offsets) return null;
  return formatConcordanceSlice(speechText, offsets, maxContextChars);
}

/**
 * Order sessions strictly by child age youngest-first (source age, else
 * filename-inferred age; unaged sessions last), breaking ties by lowercase
 * session slug and then canonical session age tie-breakers.
 */
export function compareConcordanceSessions(
  a: Pick<Session, 'id' | 'slug' | 'sourceName' | 'ages' | 'inferredAge'>,
  b: Pick<Session, 'id' | 'slug' | 'sourceName' | 'ages' | 'inferredAge'>,
): number {
  const aAge = effectiveSessionAge(a);
  const bAge = effectiveSessionAge(b);
  const slugTieBreak = () => {
    const aSlug = (a.slug || a.id).toLowerCase();
    const bSlug = (b.slug || b.id).toLowerCase();
    return aSlug.localeCompare(bSlug, 'en') || compareSessionsByAge(a, b, 'asc');
  };

  if (!aAge && !bAge) return slugTieBreak();
  if (!aAge) return 1;
  if (!bAge) return -1;
  const ageCmp = compareParsedAges(aAge, bAge);
  if (ageCmp !== 0) return ageCmp;
  return slugTieBreak();
}

interface PendingConcordanceMatch {
  session: Session;
  passage: Passage;
  passageNumber: number;
  speech: string;
  offsets: MatchOffsets;
}

export function makeConcordance(data: ArchiveData) {
  const orderedSessions = [...data.sessions].sort(compareConcordanceSessions);

  return function concordance(request: ConcordanceRequest): ConcordanceResponse {
    const pageSize: ConcordancePageSize = CONCORDANCE_PAGE_SIZE;
    const compiled = compileConcordanceQuery(request.query ?? '');
    if (!compiled) {
      return { rows: [], total: 0, sessionCount: 0, page: 1, pages: 1, pageSize };
    }

    const origin = request.origin || '';
    const topic = request.topic || '';
    const ageMin = isValidAgeMonths(request.ageMin) ? request.ageMin : undefined;
    const ageMax = isValidAgeMonths(request.ageMax) ? request.ageMax : undefined;
    if (ageMin !== undefined && ageMax !== undefined && ageMin > ageMax) {
      return { rows: [], total: 0, sessionCount: 0, page: 1, pages: 1, pageSize };
    }

    const marker = request.marker || '';
    // Default speaker scope is 'child' when a linguistic marker is selected
    // (matching linguistic search provenance rules), else 'any' for open concordance queries.
    const speaker = request.speaker ?? (marker ? 'child' : 'any');

    const requestedPage = Math.max(1, Math.floor(Number.isFinite(request.page) ? request.page! : 1));
    const windowStart = (requestedPage - 1) * pageSize;
    const windowEnd = windowStart + pageSize;

    // Retain only the requested page window plus the trailing page (at most 50 entries each)
    // so large match sets never format or retain rows outside the returned page.
    const requestedPageMatches: PendingConcordanceMatch[] = [];
    let lastPageMatches: PendingConcordanceMatch[] = [];
    let total = 0;
    let sessionCount = 0;

    for (const session of orderedSessions) {
      if (origin && session.origin !== origin) continue;
      if (topic && !session.topics.includes(topic)) continue;
      if (ageMin !== undefined || ageMax !== undefined) {
        if (!sessionMatchesAgeRange(session, ageMin, ageMax)) continue;
      }
      if (speaker === 'child' && session.origin !== 'archived_research') continue;

      let sessionMatched = false;

      for (let index = 0; index < session.transcript.length; index += 1) {
        const passage = session.transcript[index];
        if (!passageMatchesSpeakerScope(passage, session.origin, speaker)) continue;

        const speech = passageSpeechText(passage, session.origin);
        if (!speech) continue;

        if (marker && !passageMatchesMarker(passage, session.origin, marker, speaker)) continue;

        const offsets = findConcordanceMatchOffsets(speech, compiled);
        if (!offsets) continue;

        sessionMatched = true;
        const matchIndex = total;
        total += 1;

        const inRequestedWindow = matchIndex >= windowStart && matchIndex < windowEnd;
        const trackLastPage = requestedPage > 1;
        if (trackLastPage && matchIndex % pageSize === 0) {
          lastPageMatches = [];
        }

        if (inRequestedWindow || trackLastPage) {
          const pending: PendingConcordanceMatch = {
            session,
            passage,
            passageNumber: index + 1,
            speech,
            offsets,
          };
          if (inRequestedWindow) {
            requestedPageMatches.push(pending);
          }
          if (trackLastPage) {
            lastPageMatches.push(pending);
          }
        }
      }

      if (sessionMatched) sessionCount += 1;
    }

    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(pages, requestedPage);
    const selected = requestedPage <= pages ? requestedPageMatches : lastPageMatches;

    const rows: ConcordanceRow[] = selected.map(({ session, passage, passageNumber, speech, offsets }) => {
      const slice = formatConcordanceSlice(speech, offsets, CONCORDANCE_CONTEXT_CHARS);
      return {
        sessionId: session.id,
        sessionSlug: session.slug || session.id,
        sessionTitle: session.title,
        sourceName: session.sourceName,
        origin: session.origin,
        ages: [...session.ages],
        inferredAge: session.inferredAge,
        passageNumber,
        speaker: passage.speaker?.trim() || null,
        start: typeof passage.start === 'number' && Number.isFinite(passage.start) && passage.start >= 0 ? passage.start : null,
        leftContext: slice.leftContext,
        match: slice.match,
        rightContext: slice.rightContext,
      };
    });

    return {
      rows,
      total,
      sessionCount,
      page,
      pages,
      pageSize,
    };
  };
}
