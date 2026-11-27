import type { LinguisticMarkerId, LinguisticSpeaker } from './linguistic-markers';

export type Origin = 'archived_research' | 'talkbank_ai_draft' | 'local_ai_draft';
export interface AudioFile {
  id: string;
  name: string;
  format: string;
  duration: number;
  bytes: number;
  available: boolean;
  kind?: 'original' | 'listening-copy';
  derivedFromId?: string;
  encoding?: string;
}
export interface SourceFile { id: string; name: string; format: string; label: string }
export interface Moment { title: string; description: string; start: number | null; end: number | null; locator: string }
export interface TranscriptSegment { text: string; start?: number | null; end?: number | null; speaker?: string }
export interface ArchiveEntry {
  id: string;
  sourceName: string;
  title: string;
  overview: string;
  origin: Origin;
  topics: string[];
  dates: string[];
  ages: string[];
  audio: AudioFile[];
  preferredAudioId: string | null;
  sources: SourceFile[];
  moments: Moment[];
  limits: string[];
  transcript: TranscriptSegment[];
  sourceSha256: string;
  association: string;
}
export type EntryCard = Omit<ArchiveEntry, 'transcript' | 'moments' | 'limits' | 'sourceSha256' | 'association' | 'sources'>;
export interface ArchiveDocument {
  id: string;
  title: string;
  description: string;
  category: 'overview' | 'research' | 'guide';
  markdown?: string;
  assets: SourceFile[];
}
// Only the server loads ArchiveData. Asset paths and full text never enter public build assets.
export interface ArchiveData {
  version: 1;
  generatedAt: string;
  entries: ArchiveEntry[];
  documents: ArchiveDocument[];
  assets: Record<string, { pathname: string; name: string; contentType: string; bytes: number; sha256: string }>;
}
export interface Catalog {
  title: string;
  counts: { entries: number; audio: number; moments: number; original: number; talkbankAi: number; localAi: number };
  topics: Array<{ name: string; count: number }>;
  documents: ArchiveDocument[];
}
export type SearchPageSize = 18 | 36;
export interface SearchRequest { query?: string; topic?: string; origin?: Origin | ''; page?: number; pageSize?: SearchPageSize; sort?: 'relevance' | 'oldest' | 'newest'; marker?: LinguisticMarkerId | ''; speaker?: LinguisticSpeaker }
export interface LinguisticEvidence {
  marker: LinguisticMarkerId;
  count: number;
  examples: Array<{ segmentIndex: number; text: string; speaker?: string; start?: number | null }>;
}
export interface SearchResult { entry: EntryCard; excerpt: string; matchedIn: 'transcript' | 'summary' | 'browse'; linguisticEvidence?: LinguisticEvidence }
export interface SearchResponse { results: SearchResult[]; total: number; page: number; pages: number; pageSize: SearchPageSize }
