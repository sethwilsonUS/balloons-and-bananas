import { archive } from '@/lib/archive';
import { json, unavailable } from '@/lib/responses';

export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const entry = (await archive()).entries.find(e => e.id === id);
    return entry ? json(entry) : json({ error: 'Entry not found.' }, 404);
  } catch { return unavailable(); }
}
