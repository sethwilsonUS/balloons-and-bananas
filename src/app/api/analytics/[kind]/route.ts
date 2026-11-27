import { requestOriginIsAllowed } from '@/lib/access';
import { ANALYTICS_ORIGIN, analyticsCollectorBody } from '@/lib/analytics-policy';
import { checkBasicBot } from '@/lib/bot-protection';
import { json, privateHeaders } from '@/lib/responses';

export const runtime = 'nodejs';
const MAX_BYTES = 4096;

async function readBoundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return null; }
      parts.push(value);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch { return null; }
  finally { reader.releaseLock(); }
}

export async function POST(request: Request, context: { params: Promise<{ kind: string }> }) {
  if (!requestOriginIsAllowed(request)) return json({ error: 'Request not allowed.' }, 403);
  const { kind } = await context.params;
  if (kind !== 'view' && kind !== 'event') return json({ error: 'Unknown analytics action.' }, 404);
  // Development and preview requests must never enter production reports.
  if (process.env.VERCEL_ENV !== 'production' || request.headers.get('origin') !== ANALYTICS_ORIGIN) return new Response(null, { status: 204, headers: privateHeaders });
  const blocked = await checkBasicBot();
  if (blocked) return blocked;
  const body = analyticsCollectorBody(kind, await readBoundedJson(request), process.env.ARCHIVE_ANALYTICS_PLUS === '1' ? 8 : 2);
  if (!body) return json({ error: 'Invalid analytics event.' }, 400);
  const headers = new Headers({ 'Content-Type': 'application/json', 'x-va-server': '1' });
  // Match Vercel's server SDK visitor context, without forwarding the archive
  // session cookie, referrer, attribution, raw URL or arbitrary request headers.
  const userAgent = request.headers.get('user-agent');
  const clientIp = request.headers.get('x-forwarded-for');
  if (userAgent) headers.set('user-agent', userAgent);
  if (clientIp) headers.set('x-vercel-ip', clientIp);
  try {
    const response = await fetch(`${ANALYTICS_ORIGIN}/_vercel/insights/${kind}`, {
      method: 'POST', headers, body: JSON.stringify(body),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(4000),
    });
    await response.body?.cancel();
    return new Response(null, { status: response.ok ? 204 : 502, headers: privateHeaders });
  } catch { return new Response(null, { status: 502, headers: privateHeaders }); }
}
