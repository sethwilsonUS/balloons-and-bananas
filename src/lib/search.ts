import MiniSearch, { type SearchResult as MiniSearchResult } from 'minisearch';
import { makeLinguisticSearch } from './linguistic-search';
import type { ArchiveData, ArchiveEntry, EntryCard, SearchPageSize, SearchRequest, SearchResponse } from './types';

const fold = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
const collapseWhitespace = (s: string) => s.replace(/\s+/g, ' ').trim();
const normalizeWords = (s: string) => fold(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function isSearchPageSize(value: unknown): value is SearchPageSize {
  return value === 18 || value === 36;
}
export function card(entry: ArchiveEntry): EntryCard {
  const { transcript: _t, moments: _m, limits: _l, sourceSha256: _s, association: _a, sources: _f, ...value } = entry;
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

function pickMomentExcerpt(entry: ArchiveEntry, queryTerms: string[], hit: MiniSearchResult | undefined): string {
  if (!entry.moments.length) return '';
  const cardFieldsText = fold([entry.title, entry.sourceName, ...entry.audio.map(a => a.name), entry.topics.join(' '), entry.overview].join('\n'));
  const missingFromCard = queryTerms.filter(term => !cardFieldsText.includes(term));
  const momentMatchTerms = matchedTermsForField(hit, 'moments');
  const highlightTerms = [...new Set([...queryTerms, ...momentMatchTerms])];

  const moments = entry.moments.map(moment => {
    const text = `${moment.title}: ${moment.description}`;
    const folded = fold(text);
    const exactQueryHits = queryTerms.filter(term => folded.includes(term)).length;
    const missingHits = missingFromCard.filter(term => folded.includes(term)).length;
    const matchedFieldHits = momentMatchTerms.filter(term => folded.includes(term)).length;
    return { moment, text, exactQueryHits, missingHits, matchedFieldHits };
  });

  // Prefer a moment that satisfies all query terms (without repeating overview or concatenating title).
  const fullMoment = moments.find(item =>
    queryTerms.length > 0 && item.exactQueryHits === queryTerms.length && !momentDuplicatesOverview(item.moment, item.text, entry.overview),
  );
  if (fullMoment) return excerpt(fullMoment.text, highlightTerms);

  // If the query required terms not already visible on the card (title/overview/metadata),
  // show the moment that contributes the most of those terms.
  if (missingFromCard.length > 0) {
    const best = moments
      .filter(item => (item.missingHits > 0 || item.matchedFieldHits > 0) && !momentDuplicatesOverview(item.moment, item.text, entry.overview))
      .sort((a, b) => (b.missingHits - a.missingHits) || (b.exactQueryHits - a.exactQueryHits) || (b.matchedFieldHits - a.matchedFieldHits))[0];
    if (best) return excerpt(best.text, [...new Set([...missingFromCard, ...highlightTerms])]);
  }

  // Handle fuzzy matches that landed solely in moments (not already visible in card metadata/overview).
  if (momentMatchTerms.length > 0) {
    const matchedFields = new Set(Object.values(hit?.match ?? {}).flat());
    const onlyInMoments = !matchedFields.has('title') && !matchedFields.has('overview') && !matchedFields.has('sourceName') && !matchedFields.has('topics');
    if (onlyInMoments) {
      const best = moments
        .filter(item => item.matchedFieldHits > 0 && !momentDuplicatesOverview(item.moment, item.text, entry.overview))
        .sort((a, b) => b.matchedFieldHits - a.matchedFieldHits)[0];
      if (best) return excerpt(best.text, highlightTerms);
    }
  }

  return '';
}

export function makeSearch(data: ArchiveData) {
  const byId = new Map(data.entries.map(e => [e.id, e]));
  const linguisticSearch = makeLinguisticSearch(data.entries);
  const index = new MiniSearch({
    fields: ['title', 'sourceName', 'topics', 'overview', 'moments', 'transcript'],
    idField: 'id', processTerm: fold,
    searchOptions: { boost: { title: 6, sourceName: 5, topics: 4, overview: 3, moments: 2 }, prefix: true, fuzzy: 0.15, combineWith: 'AND' },
  });
  index.addAll(data.entries.map(e => ({
    id: e.id, title: e.title, sourceName: [e.sourceName, ...e.audio.map(a => a.name)].join(' '),
    topics: e.topics.join(' '), overview: e.overview,
    moments: e.moments.map(m => `${m.title} ${m.description}`).join('\n'),
    transcript: e.transcript.map(s => s.text).join('\n'),
  })));

  return function search(request: SearchRequest): SearchResponse {
    // The route rejects invalid sizes. Keep direct callers bounded as well.
    const pageSize: SearchPageSize = request.pageSize === 36 ? 36 : 18;
    const query = (request.query ?? '').trim().slice(0, 300);
    const terms = fold(query).split(/\s+/).filter(Boolean);
    const rawHits = query ? index.search(query) : [];
    const hitById = new Map(rawHits.map(r => [String(r.id), r]));
    let entries = query ? rawHits.map(r => byId.get(r.id)!).filter(Boolean) : [...data.entries];
    if (request.origin) entries = entries.filter(e => e.origin === request.origin);
    if (request.topic) entries = entries.filter(e => e.topics.includes(request.topic!));
    const linguisticMatches = request.marker ? linguisticSearch(request.marker, request.speaker ?? 'child') : undefined;
    if (linguisticMatches) entries = entries.filter(entry => linguisticMatches.has(entry.id));
    const sort = request.sort ?? (query ? 'relevance' : 'oldest');
    if (sort !== 'relevance' || !query) entries.sort((a, b) => {
      const ad = a.dates[0], bd = b.dates[0];
      if (!ad && !bd) return a.sourceName.localeCompare(b.sourceName);
      if (!ad) return 1;
      if (!bd) return -1;
      return (ad.localeCompare(bd) || a.sourceName.localeCompare(b.sourceName)) * (sort === 'newest' ? -1 : 1);
    });
    const pages = Math.max(1, Math.ceil(entries.length / pageSize));
    const page = Math.min(pages, Math.max(1, Math.floor(Number.isFinite(request.page) ? request.page! : 1)));
    return { total: entries.length, page, pages, pageSize, results: entries.slice((page - 1) * pageSize, page * pageSize).map(entry => {
      const evidence = linguisticMatches?.get(entry.id);
      const linguistic = evidence ? { linguisticEvidence: evidence } : {};
      if (!query) return { entry: card(entry), excerpt: '', matchedIn: 'browse', ...linguistic };
      const hit = hitById.get(entry.id);
      const matchedFields = new Set(Object.values(hit?.match ?? {}).flat());
      const guideText = [
        entry.title,
        entry.sourceName,
        ...entry.audio.map(a => a.name),
        entry.topics.join(' '),
        entry.overview,
        ...entry.moments.map(m => `${m.title}: ${m.description}`),
      ].join('\n');
      const inSummary = terms.every(t => fold(guideText).includes(t)) || !matchedFields.has('transcript');
      if (inSummary) {
        return {
          entry: card(entry),
          excerpt: pickMomentExcerpt(entry, terms, hit),
          matchedIn: 'summary',
          ...linguistic,
        };
      }
      const transcript = entry.transcript.map(s => s.text).join('\n');
      const transcriptTerms = [...new Set([...terms, ...matchedTermsForField(hit, 'transcript')])];
      return {
        entry: card(entry),
        excerpt: excerpt(transcript, transcriptTerms),
        matchedIn: 'transcript',
        ...linguistic,
      };
    }) };
  };
}
