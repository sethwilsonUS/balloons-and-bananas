import MiniSearch, { type SearchResult as MiniSearchResult } from 'minisearch';
import { compareSessionsByAge, isValidAgeMonths, sessionMatchesAgeRange } from './age';
import { makeLinguisticSearch } from './linguistic-search';
import { isSearchSort, SEARCH_SORTS, shortOverview } from './results-view';
import type { ArchiveData, SearchPageSize, SearchRequest, SearchResponse, SearchSort, Session, SessionCard } from './types';

export { isSearchSort, SEARCH_SORTS };

const fold = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
const collapseWhitespace = (s: string) => s.replace(/\s+/g, ' ').trim();
const normalizeWords = (s: string) => fold(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function isSearchPageSize(value: unknown): value is SearchPageSize {
  return value === 18 || value === 36;
}
export function sessionCard(session: Session): SessionCard {
  const { transcript: _t, moments: _m, limits: _l, sourceSha256: _s, association: _a, sources: _f, ...value } = session;
  return value;
}
function excerpt(text: string, terms: string[]) {
  if (!text.trim()) return '';
  const normalized = fold(text);
  const hits = terms.filter(Boolean).map(t => normalized.indexOf(t)).filter(n => n >= 0);
  if (!hits.length) return '';
  const at = Math.min(...hits);
  const start = Math.max(0, at - 85);
  return (start ? '…' : '') + collapseWhitespace(text.slice(start, start + 270)) + (start + 270 < text.length ? '…' : '');
}

function matchedTermsForField(hit: MiniSearchResult | undefined, field: string): string[] {
  if (!hit?.match) return [];
  return Object.entries(hit.match)
    .filter(([, fields]) => fields.includes(field))
    .map(([term]) => term);
}

function duplicatesOverview(candidate: string, overview: string): boolean {
  const normalizedCandidate = normalizeWords(candidate);
  const normalizedOverview = normalizeWords(overview);
  return Boolean(normalizedCandidate && normalizedOverview && normalizedOverview.includes(normalizedCandidate));
}

function momentDuplicatesOverview(moment: { title: string; description: string }, formatted: string, overview: string): boolean {
  return duplicatesOverview(formatted, overview)
    || (duplicatesOverview(moment.description, overview) && (!moment.title.trim() || duplicatesOverview(moment.title, overview)));
}

function pickTruncatedOverviewExcerpt(session: Session, queryTerms: string[], hit: MiniSearchResult | undefined): string {
  const overview = session.overview.trim();
  if (!overview) return '';
  const shortened = shortOverview(overview);
  if (shortened === overview) return '';
  const foldedOverview = fold(overview);
  const foldedShort = fold(shortened);
  const overviewTerms = [
    ...new Set([
      ...queryTerms.filter(term => foldedOverview.includes(term)),
      ...matchedTermsForField(hit, 'overview'),
    ]),
  ];
  const hiddenInList = overviewTerms.filter(term => !foldedShort.includes(term));
  if (!hiddenInList.length) return '';
  return excerpt(overview, hiddenInList);
}

function pickGuideExcerpt(session: Session, queryTerms: string[], hit: MiniSearchResult | undefined): string {
  if (session.moments.length) {
    const cardFieldsText = fold([session.title, session.sourceName, ...session.recordings.map(r => r.name), session.topics.join(' '), session.overview].join('\n'));
    const missingFromCard = queryTerms.filter(term => !cardFieldsText.includes(term));
    const momentMatchTerms = matchedTermsForField(hit, 'moments');
    const highlightTerms = [...new Set([...queryTerms, ...momentMatchTerms])];

    const moments = session.moments.map(moment => {
      const text = `${moment.title}: ${moment.description}`;
      const folded = fold(text);
      const exactQueryHits = queryTerms.filter(term => folded.includes(term)).length;
      const missingHits = missingFromCard.filter(term => folded.includes(term)).length;
      const matchedFieldHits = momentMatchTerms.filter(term => folded.includes(term)).length;
      return { moment, text, exactQueryHits, missingHits, matchedFieldHits };
    });

    // Prefer a moment that satisfies all query terms (without repeating overview or concatenating title).
    const fullMoment = moments.find(item =>
      queryTerms.length > 0 && item.exactQueryHits === queryTerms.length && !momentDuplicatesOverview(item.moment, item.text, session.overview),
    );
    if (fullMoment) return excerpt(fullMoment.text, highlightTerms);

    // If the query required terms not already visible on the card (title/overview/metadata),
    // show the moment that contributes the most of those terms.
    if (missingFromCard.length > 0) {
      const best = moments
        .filter(item => (item.missingHits > 0 || item.matchedFieldHits > 0) && !momentDuplicatesOverview(item.moment, item.text, session.overview))
        .sort((a, b) => (b.missingHits - a.missingHits) || (b.exactQueryHits - a.exactQueryHits) || (b.matchedFieldHits - a.matchedFieldHits))[0];
      if (best) return excerpt(best.text, [...new Set([...missingFromCard, ...highlightTerms])]);
    }

    // Handle fuzzy matches that landed solely in moments (not already visible in card metadata/overview).
    if (momentMatchTerms.length > 0) {
      const matchedFields = new Set(Object.values(hit?.match ?? {}).flat());
      const onlyInMoments = !matchedFields.has('title') && !matchedFields.has('overview') && !matchedFields.has('sourceName') && !matchedFields.has('topics');
      if (onlyInMoments) {
        const best = moments
          .filter(item => item.matchedFieldHits > 0 && !momentDuplicatesOverview(item.moment, item.text, session.overview))
          .sort((a, b) => b.matchedFieldHits - a.matchedFieldHits)[0];
        if (best) return excerpt(best.text, highlightTerms);
      }
    }
  }

  // If no moment qualified, keep an overview-only excerpt strictly when List view truncates
  // the matching term past shortOverview(); Details view still suppresses it as already visible.
  return pickTruncatedOverviewExcerpt(session, queryTerms, hit);
}

function pickTranscriptMatch(
  session: Session,
  queryTerms: string[],
  foldedGuideText: string,
  hit: MiniSearchResult | undefined,
): { excerpt: string; matchedPassage?: number } {
  const transcriptFieldTerms = matchedTermsForField(hit, 'transcript');
  const transcriptTerms = [...new Set([...queryTerms, ...transcriptFieldTerms])];
  const missingFromGuide = queryTerms.filter(term => !foldedGuideText.includes(term));

  let bestIndex = -1;
  let bestMissingHits = 0;
  let bestExactHits = 0;
  let bestMatchedHits = 0;

  for (let index = 0; index < session.transcript.length; index += 1) {
    const text = session.transcript[index]?.text ?? '';
    if (!text.trim()) continue;
    const folded = fold(text);
    const missingHits = missingFromGuide.filter(term => folded.includes(term)).length;
    const exactHits = queryTerms.filter(term => folded.includes(term)).length;
    const matchedHits = transcriptTerms.filter(term => folded.includes(term)).length;
    if (missingHits === 0 && exactHits === 0 && matchedHits === 0) continue;
    const isBetter = bestIndex === -1
      || missingHits > bestMissingHits
      || (missingHits === bestMissingHits && exactHits > bestExactHits)
      || (missingHits === bestMissingHits && exactHits === bestExactHits && matchedHits > bestMatchedHits);
    if (isBetter) {
      bestIndex = index;
      bestMissingHits = missingHits;
      bestExactHits = exactHits;
      bestMatchedHits = matchedHits;
    }
  }

  if (bestIndex >= 0) {
    const focusTerms = bestMissingHits > 0 ? [...new Set([...missingFromGuide, ...transcriptTerms])] : transcriptTerms;
    return {
      excerpt: excerpt(session.transcript[bestIndex].text, focusTerms),
      matchedPassage: bestIndex + 1,
    };
  }

  const transcript = session.transcript.map(passage => passage.text).join('\n');
  return { excerpt: excerpt(transcript, transcriptTerms) };
}

export function makeSearch(data: ArchiveData) {
  const byId = new Map(data.sessions.map(session => [session.id, session]));
  const linguisticSearch = makeLinguisticSearch(data.sessions);
  const index = new MiniSearch({
    fields: ['title', 'sourceName', 'topics', 'overview', 'moments', 'transcript'],
    idField: 'id', processTerm: fold,
    searchOptions: { boost: { title: 6, sourceName: 5, topics: 4, overview: 3, moments: 2 }, prefix: true, fuzzy: 0.15, combineWith: 'AND' },
  });
  index.addAll(data.sessions.map(session => ({
    id: session.id, title: session.title, sourceName: [session.sourceName, ...session.recordings.map(r => r.name)].join(' '),
    topics: session.topics.join(' '), overview: session.overview,
    moments: session.moments.map(moment => `${moment.title} ${moment.description}`).join('\n'),
    transcript: session.transcript.map(passage => passage.text).join('\n'),
  })));

  return function search(request: SearchRequest): SearchResponse {
    // The route rejects invalid sizes and ages. Keep direct callers bounded as well.
    const pageSize: SearchPageSize = request.pageSize === 36 ? 36 : 18;
    const query = (request.query ?? '').trim().slice(0, 300);
    const terms = fold(query).split(/\s+/).filter(Boolean);
    const rawHits = query ? index.search(query) : [];
    const hitById = new Map(rawHits.map(r => [String(r.id), r]));
    let sessions = query ? rawHits.map(r => byId.get(r.id)!).filter(Boolean) : [...data.sessions];
    if (request.origin) sessions = sessions.filter(session => session.origin === request.origin);
    if (request.topic) sessions = sessions.filter(session => session.topics.includes(request.topic!));
    const ageMin = isValidAgeMonths(request.ageMin) ? request.ageMin : undefined;
    const ageMax = isValidAgeMonths(request.ageMax) ? request.ageMax : undefined;
    if (ageMin !== undefined || ageMax !== undefined) {
      sessions = sessions.filter(session => sessionMatchesAgeRange(session, ageMin, ageMax));
    }
    const linguisticMatches = request.marker ? linguisticSearch(request.marker, request.speaker ?? 'child') : undefined;
    if (linguisticMatches) sessions = sessions.filter(session => linguisticMatches.has(session.id));
    const sort: SearchSort = request.sort ?? (query ? 'relevance' : 'age-asc');
    if (sort !== 'relevance' || !query) {
      const direction = sort === 'age-desc' ? 'desc' : 'asc';
      sessions.sort((a, b) => compareSessionsByAge(a, b, direction));
    }
    const pages = Math.max(1, Math.ceil(sessions.length / pageSize));
    const page = Math.min(pages, Math.max(1, Math.floor(Number.isFinite(request.page) ? request.page! : 1)));
    return { total: sessions.length, page, pages, pageSize, results: sessions.slice((page - 1) * pageSize, page * pageSize).map(session => {
      const evidence = linguisticMatches?.get(session.id);
      const linguistic = evidence ? { linguisticEvidence: evidence } : {};
      if (!query) return { session: sessionCard(session), excerpt: '', matchedIn: 'browse', ...linguistic };
      const hit = hitById.get(session.id);
      const matchedFields = new Set(Object.values(hit?.match ?? {}).flat());
      const guideText = [
        session.title,
        session.sourceName,
        ...session.recordings.map(r => r.name),
        session.topics.join(' '),
        session.overview,
        ...session.moments.map(moment => `${moment.title}: ${moment.description}`),
      ].join('\n');
      const foldedGuideText = fold(guideText);
      const inGuide = terms.every(t => foldedGuideText.includes(t)) || !matchedFields.has('transcript');
      if (inGuide) {
        return {
          session: sessionCard(session),
          excerpt: pickGuideExcerpt(session, terms, hit),
          matchedIn: 'guide',
          ...linguistic,
        };
      }
      const transcriptMatch = pickTranscriptMatch(session, terms, foldedGuideText, hit);
      return {
        session: sessionCard(session),
        excerpt: transcriptMatch.excerpt,
        matchedIn: 'transcript',
        ...(transcriptMatch.matchedPassage !== undefined ? { matchedPassage: transcriptMatch.matchedPassage } : {}),
        ...linguistic,
      };
    }) };
  };
}
