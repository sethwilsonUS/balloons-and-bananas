import { requestOriginIsAllowed } from '@/lib/access';
import { archive } from '@/lib/archive';
import { checkBasicBot } from '@/lib/bot-protection';
import { makeConcordance, parseConcordanceBody } from '@/lib/concordance';
import { json, unavailable } from '@/lib/responses';

export const runtime = 'nodejs';
let concordance: ReturnType<typeof makeConcordance> | undefined;

export async function POST(request: Request) {
  if (!requestOriginIsAllowed(request)) return json({ error: 'Request not allowed.' }, 403);
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json({ error: 'Concordance request is too long.' }, 400);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'Invalid concordance request.' }, 400);
    }
    const parsed = parseConcordanceBody(body);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const blocked = await checkBasicBot();
    if (blocked) return blocked;
    concordance ??= makeConcordance(await archive());
    return json(concordance(parsed.request));
  } catch {
    return unavailable();
  }
}
