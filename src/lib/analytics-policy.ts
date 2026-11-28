import { isLinguisticMarkerId } from './linguistic-markers';

export const ANALYTICS_ORIGIN = 'https://balloons-and-bananas.vercel.app';
export const ANALYTICS_PATHS = ['/overview', '/recordings', '/recording', '/research', '/document'] as const;
export type AnalyticsPath = typeof ANALYTICS_PATHS[number];
type Property = string | number | boolean;
type Validator = (value: unknown) => boolean;
const oneOf = (...values: readonly Property[]): Validator => value => values.includes(value as Property);
const integer = (max: number, min = 0): Validator => value => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const boolean: Validator = value => typeof value === 'boolean';
// Only the corpus's numeric source-code grammar is permitted, not arbitrary
// slugs after “local-”. This avoids loading the entire catalog for each event.
const recordingId: Validator = value => typeof value === 'string' && /^(archive-[0-9]{6}[a-z]?|local-(?:0extra-[0-9]{2}-(?:supp-)?[0-9]{6}[a-f]?|0wav-[0-9]{6}[a-f]?))$/.test(value);
const assetId: Validator = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const origin = oneOf('archived_research', 'talkbank_ai_draft', 'local_ai_draft');
const view = oneOf('details', 'list');
const themes = oneOf('Learning and questions', 'Humor and sound play', 'Play and imagination', 'Affection and comfort', 'Help and independence', 'Music and stories', 'Outings and nature', 'Vision and access');
const documentId = oneOf('research', 'methods-and-audit', 'transcript-coverage-explanation', 'research-sources', 'research-source-quality', 'annotation-provenance', 'transcript-associations');
const optional = (validate: Validator): Validator => value => value === '' || validate(value);
const recording = { recordingId, origin };
const audio = { ...recording, audioId: assetId };

// This is also enforced on the server: no arbitrary text field is accepted.
// Property order prioritizes the two dimensions available without Analytics Plus.
const schemas = {
  search_completed: { results: integer(1_000_000), queryLength: integer(300), wordCount: integer(300), page: integer(100_000, 1), view, origin: optional(origin), marker: optional(isLinguisticMarkerId), theme: optional(themes) },
  section_view: { section: oneOf('overview', 'recordings', 'research') },
  recording_view: recording,
  recording_open: { recordingId, action: oneOf('guide', 'passage'), origin, view, passage: integer(1_000_000, 1) },
  filter_changed: { filter: oneOf('theme', 'origin', 'marker', 'speaker', 'sort', 'clear'), value: (value: unknown) => value === '' || value === 'all' || themes(value) || origin(value) || isLinguisticMarkerId(value) || oneOf('child', 'any', 'relevance', 'age-asc', 'age-desc')(value) },
  view_changed: { view },
  share_link: { outcome: oneOf('copied', 'manual', 'error') },
  research_open: { documentId, action: oneOf('read', 'download'), assetId },
  appearance_changed: { theme: oneOf('light', 'dark', 'system') },
  audio_start: audio,
  audio_resume: audio,
  audio_pause: audio,
  audio_end: audio,
  audio_listen_milestone: { recordingId, milestoneSeconds: oneOf(30, 120, 600, 1800), origin, audioId: assetId },
  audio_seek: { recordingId, seekSource: oneOf('native', 'back', 'forward', 'passage'), origin, audioId: assetId },
  audio_rate: { recordingId, rateBucket: oneOf('slow', 'normal', 'fast'), origin, audioId: assetId },
  audio_file_change: { recordingId, audioId: assetId, origin },
  audio_error: { recordingId, errorCode: oneOf('load', 'play', 'aborted', 'network', 'decode', 'unsupported'), origin, audioId: assetId },
  audio_download: { recordingId, fileKind: oneOf('original', 'listening-copy'), origin, audioId: assetId, format: oneOf('mp3', 'wav') },
  notation_toggle: { recordingId, enabled: boolean, origin },
  notation_explore: { recordingId, marker: isLinguisticMarkerId, origin },
  transcript_find: { recordingId, results: integer(1_000_000), origin, queryLength: integer(300), notation: boolean },
  transcript_follow: { recordingId, enabled: boolean, origin },
  transcript_jump: { recordingId, action: oneOf('read', 'listen'), origin, source: oneOf('moment', 'current', 'cue') },
  transcript_more: recording,
  source_download: { recordingId, format: oneOf('cha', 'txt', 'json', 'vtt', 'md', 'html', 'other'), origin, category: oneOf('chat', 'transcript', 'guide', 'other') },
} satisfies Record<string, Record<string, Validator>>;

export type ArchiveEventName = keyof typeof schemas;
export type SafeAnalyticsEvent = { name: ArchiveEventName; properties: Record<string, Property> };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function sanitizeArchiveEvent(name: unknown, properties: unknown, propertyLimit: 2 | 8 = 8): SafeAnalyticsEvent | null {
  if (typeof name !== 'string' || !Object.hasOwn(schemas, name) || !record(properties)) return null;
  const schema = schemas[name as ArchiveEventName];
  const safe: Record<string, Property> = {};
  for (const [key, validate] of Object.entries(schema)) {
    if (!Object.hasOwn(properties, key)) continue;
    // Invalid allowed fields invalidate an event; unknown fields are discarded.
    if (!validate(properties[key])) return null;
    if (Object.keys(safe).length < propertyLimit) safe[key] = properties[key] as Property;
  }
  if (!Object.keys(safe).length) return null;
  if ('recordingId' in schema && !Object.hasOwn(safe, 'recordingId')) return null;
  return { name: name as ArchiveEventName, properties: safe };
}

/** Analytics URLs describe screens, never a search, access key or passage URL. */
export function sanitizeAnalyticsUrl(value: unknown): string {
  try {
    if (typeof value !== 'string') throw new Error();
    const url = new URL(value, ANALYTICS_ORIGIN);
    if (url.origin === ANALYTICS_ORIGIN && (ANALYTICS_PATHS as readonly string[]).includes(url.pathname)) return `${ANALYTICS_ORIGIN}${url.pathname}`;
  } catch { /* Fall back to a generic screen; never forward the original. */ }
  return `${ANALYTICS_ORIGIN}/overview`;
}

/** Reconstruct the collector body; never spread SDK data, referrers or traits. */
export function analyticsCollectorBody(kind: 'view' | 'event', input: unknown, propertyLimit: 2 | 8 = 2, now = Date.now()) {
  if (!record(input)) return null;
  const url = sanitizeAnalyticsUrl(input.o);
  const base = { o: url, ts: now, sdkn: '@vercel/analytics', sdkv: '2.0.1', r: '', dp: new URL(url).pathname };
  if (kind === 'view') return base;
  const event = sanitizeArchiveEvent(input.en, input.ed, propertyLimit);
  return event ? { ...base, en: event.name, ed: event.properties } : null;
}
