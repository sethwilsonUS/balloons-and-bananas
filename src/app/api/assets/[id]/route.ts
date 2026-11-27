import { getDownloadUrl } from '@vercel/blob';
import { checkBasicBot } from '@/lib/bot-protection';
import { archive, signedAsset } from '@/lib/archive';
import { json, privateHeaders, unavailable } from '@/lib/responses';

export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const query = new URL(request.url).searchParams;
    // Player fetches carry BotID proof; native downloads cannot and stay public.
    if (query.get('json') === '1') {
      const blocked = await checkBasicBot();
      if (blocked) return blocked;
    }
    const { id } = await params;
    const asset = await signedAsset(await archive(), id);
    if (!asset) return json({ error: 'File not found.' }, 404);
    if (query.get('json') === '1') return json(asset);
    const location = query.get('download') === '1' ? getDownloadUrl(asset.url) : asset.url;
    return new Response(null, { status: 307, headers: { ...privateHeaders, Location: location } });
  } catch { return unavailable(); }
}
