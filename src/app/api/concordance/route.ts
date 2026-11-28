import { requestOriginIsAllowed } from '@/lib/access';
import { archive } from '@/lib/archive';
import { checkBasicBot } from '@/lib/bot-protection';
import { makeConcordance, parseConcordanceBody } from '@/lib/concordance';
import { json, unavailable } from '@/lib/responses';

export const runtime = 'nodejs';
const MAX_REQUEST_BYTES = 4096;
let concordance: ReturnType<typeof makeConcordance> | undefined;

async function readBoundedText(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; tooLarge: true }> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      await request.body?.cancel().catch(() => undefined);
      return { ok: false, tooLarge: true };
    }
  }
  const body = request.body;
  if (!body) return { ok: true, text: '' };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(combined) };
}

export async function POST(request: Request) {
  if (!requestOriginIsAllowed(request)) return json({ error: 'Request not allowed.' }, 403);
  try {
    const rawRead = await readBoundedText(request, MAX_REQUEST_BYTES);
    if (!rawRead.ok) return json({ error: 'Concordance request is too long.' }, 400);
    let body: unknown;
    try {
      body = JSON.parse(rawRead.text);
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
