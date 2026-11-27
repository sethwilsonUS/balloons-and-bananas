import { requestOriginIsAllowed } from '@/lib/access';
import { archive } from '@/lib/archive';
import { checkBasicBot } from '@/lib/bot-protection';
import { isSearchPageSize, makeSearch } from '@/lib/search';
import { isLinguisticMarkerId, isLinguisticSpeaker } from '@/lib/linguistic-markers';
import { json, unavailable } from '@/lib/responses';
import type { SearchRequest } from '@/lib/types';

export const runtime = 'nodejs';
let search: ReturnType<typeof makeSearch> | undefined;
export async function POST(request: Request) {
  if (!requestOriginIsAllowed(request)) return json({ error: 'Request not allowed.' }, 403);
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json({ error: 'Search is too long.' }, 400);
    let body: unknown;
    try { body = JSON.parse(raw); }
    catch { return json({ error: 'Invalid search.' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid search.' }, 400);
    const input = body as Record<string, unknown>;
    if (['query', 'topic', 'origin', 'sort', 'marker', 'speaker'].some(k => input[k] !== undefined && typeof input[k] !== 'string')) return json({ error: 'Invalid search.' }, 400);
    if (input.page !== undefined && (typeof input.page !== 'number' || !Number.isFinite(input.page))) return json({ error: 'Invalid page.' }, 400);
    if (input.pageSize !== undefined && !isSearchPageSize(input.pageSize)) return json({ error: 'Invalid page size.' }, 400);
    if (input.origin && !['archived_research', 'talkbank_ai_draft', 'local_ai_draft'].includes(input.origin as string)) return json({ error: 'Invalid source filter.' }, 400);
    if (input.sort && !['relevance', 'oldest', 'newest'].includes(input.sort as string)) return json({ error: 'Invalid sort.' }, 400);
    if (input.marker !== undefined && input.marker !== '' && !isLinguisticMarkerId(input.marker)) return json({ error: 'Invalid linguistic marker.' }, 400);
    if (input.speaker !== undefined && !isLinguisticSpeaker(input.speaker)) return json({ error: 'Invalid speaker scope.' }, 400);
    const blocked = await checkBasicBot();
    if (blocked) return blocked;
    search ??= makeSearch(await archive());
    return json(search(input as SearchRequest));
  } catch { return unavailable(); }
}
