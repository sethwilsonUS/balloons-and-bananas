import { archive } from '@/lib/archive';
import { json, unavailable } from '@/lib/responses';

export const runtime = 'nodejs';
// Legacy `/api/entries/[id]` path remains supported while serving the glossary Session model.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = (await archive()).sessions.find(item => item.id === id);
    return session ? json(session) : json({ error: 'Session not found.' }, 404);
  } catch { return unavailable(); }
}
