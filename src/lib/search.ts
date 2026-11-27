import MiniSearch from 'minisearch';
import { makeLinguisticSearch } from './linguistic-search';
import type { ArchiveData, ArchiveEntry, EntryCard, SearchPageSize, SearchRequest, SearchResponse } from './types';

const fold = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
export function isSearchPageSize(value: unknown): value is SearchPageSize {
  return value === 18 || value === 36;
}
export function card(entry: ArchiveEntry): EntryCard {
  const { transcript: _t, moments: _m, limits: _l, sourceSha256: _s, association: _a, sources: _f, ...value } = entry;
  return value;
}
function excerpt(text: string, terms: string[]) {
  const normalized = fold(text);
  const hits = terms.map(t => normalized.indexOf(t)).filter(n => n >= 0);
  const at = hits.length ? Math.min(...hits) : 0;
  const start = Math.max(0, at - 85);
  return (start ? '…' : '') + text.slice(start, start + 270).replace(/\s+/g, ' ').trim() + (start + 270 < text.length ? '…' : '');
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
    let entries = query ? index.search(query).map(r => byId.get(r.id)!).filter(Boolean) : [...data.entries];
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
      const summary = [entry.title, entry.overview, ...entry.moments.map(m => `${m.title}: ${m.description}`)].join('\n');
      const inSummary = terms.every(t => fold(summary).includes(t));
      const transcript = entry.transcript.map(s => s.text).join('\n');
      return { entry: card(entry), excerpt: excerpt(inSummary ? summary : transcript, terms), matchedIn: inSummary ? 'summary' : 'transcript', ...linguistic };
    }) };
  };
}
