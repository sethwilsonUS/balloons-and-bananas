import { requestOriginIsAllowed } from '@/lib/access';
import { isValidAgeMonths } from '@/lib/age';
import { archive } from '@/lib/archive';
import { checkBasicBot } from '@/lib/bot-protection';
import { isLinguisticMarkerId, isLinguisticSpeaker } from '@/lib/linguistic-markers';
import { json, unavailable } from '@/lib/responses';
import { isTranscriptOrigin } from '@/lib/results-view';
import { isSearchPageSize, isSearchSort, makeSearch } from '@/lib/search';
import type { SearchRequest } from '@/lib/types';

export const runtime = 'nodejs';
let search: ReturnType<typeof makeSearch> | undefined;

function parseSearchBody(body: unknown): { ok: true; request: SearchRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Invalid search.' };
  }
  const input = body as Record<string, unknown>;
  const request: SearchRequest = {};

  if (input.query !== undefined) {
    if (typeof input.query !== 'string') return { ok: false, error: 'Invalid search.' };
    request.query = input.query;
  }
  if (input.topic !== undefined) {
    if (typeof input.topic !== 'string') return { ok: false, error: 'Invalid search.' };
    request.topic = input.topic;
  }
  if (input.origin !== undefined) {
    if (typeof input.origin !== 'string') return { ok: false, error: 'Invalid search.' };
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
    if (!isSearchPageSize(input.pageSize)) return { ok: false, error: 'Invalid page size.' };
    request.pageSize = input.pageSize;
  }
  if (input.sort !== undefined) {
    if (typeof input.sort !== 'string') return { ok: false, error: 'Invalid search.' };
    if (input.sort !== '') {
      if (!isSearchSort(input.sort)) return { ok: false, error: 'Invalid sort.' };
      request.sort = input.sort;
    }
  }
  if (input.marker !== undefined) {
    if (typeof input.marker !== 'string') return { ok: false, error: 'Invalid search.' };
    if (input.marker !== '' && !isLinguisticMarkerId(input.marker)) {
      return { ok: false, error: 'Invalid linguistic marker.' };
    }
    request.marker = input.marker;
  }
  if (input.speaker !== undefined) {
    if (typeof input.speaker !== 'string') return { ok: false, error: 'Invalid search.' };
    if (!isLinguisticSpeaker(input.speaker)) return { ok: false, error: 'Invalid speaker scope.' };
    request.speaker = input.speaker;
  }

  return { ok: true, request };
}

export async function POST(request: Request) {
  if (!requestOriginIsAllowed(request)) return json({ error: 'Request not allowed.' }, 403);
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json({ error: 'Search is too long.' }, 400);
    let body: unknown;
    try { body = JSON.parse(raw); }
    catch { return json({ error: 'Invalid search.' }, 400); }
    const parsed = parseSearchBody(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const blocked = await checkBasicBot();
    if (blocked) return blocked;
    search ??= makeSearch(await archive());
    return json(search(parsed.request));
  } catch { return unavailable(); }
}
