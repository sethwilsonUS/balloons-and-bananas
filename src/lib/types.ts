import type { LinguisticMarkerId, LinguisticSpeaker } from './linguistic-markers';

export type TranscriptOrigin = 'archived_research' | 'talkbank_ai_draft' | 'local_ai_draft';
export interface Recording {
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
export interface Passage { text: string; start?: number | null; end?: number | null; speaker?: string }
export type SearchSort = 'age-asc' | 'age-desc' | 'relevance';
export interface Session {
  id: string;
  sourceName: string;
  title: string;
  overview: string;
  origin: TranscriptOrigin;
  topics: string[];
  dates: string[];
  ages: string[];
  inferredAge: string | null;
  recordings: Recording[];
  preferredRecordingId: string | null;
  sources: SourceFile[];
  moments: Moment[];
  limits: string[];
  transcript: Passage[];
  sourceSha256: string;
  association: string;
}
export type SessionCard = Omit<Session, 'transcript' | 'moments' | 'limits' | 'sourceSha256' | 'association' | 'sources'>;
export interface ArchiveDocument {
  id: string;
  title: string;
  description: string;
  category: 'overview' | 'research' | 'guide';
  markdown?: string;
  assets: SourceFile[];
}
export interface ArchiveAsset {
  pathname: string;
  name: string;
  contentType: string;
  bytes: number;
  sha256: string;
}
// Only the server loads ArchiveData. Asset paths and full text never enter public build assets.
export interface ArchiveData {
  version: 1;
  generatedAt: string;
  sessions: Session[];
  documents: ArchiveDocument[];
  assets: Record<string, ArchiveAsset>;
}
export interface Catalog {
  title: string;
  counts: { sessions: number; recordings: number; moments: number; original: number; talkbankAi: number; localAi: number };
  topics: Array<{ name: string; count: number }>;
  documents: ArchiveDocument[];
}
export type SearchPageSize = 18 | 36;
export interface SearchRequest {
  query?: string;
  topic?: string;
  origin?: TranscriptOrigin | '';
  page?: number;
  pageSize?: SearchPageSize;
  sort?: SearchSort;
  marker?: LinguisticMarkerId | '';
  speaker?: LinguisticSpeaker;
}
export interface LinguisticEvidence {
  marker: LinguisticMarkerId;
  count: number;
  examples: Array<{ passageIndex: number; text: string; speaker?: string; start?: number | null }>;
}
export interface SearchResult {
  session: SessionCard;
  excerpt: string;
  matchedIn: 'transcript' | 'guide' | 'browse';
  linguisticEvidence?: LinguisticEvidence;
}
export interface SearchResponse { results: SearchResult[]; total: number; page: number; pages: number; pageSize: SearchPageSize }
