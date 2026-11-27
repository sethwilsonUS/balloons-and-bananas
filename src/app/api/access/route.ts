import { requestOriginIsAllowed } from '@/lib/access';
import { json } from '@/lib/responses';

// Compatibility for already-open clients from before the archive became public.
export async function POST(request: Request) {
  if (!requestOriginIsAllowed(request)) return json({ error: 'Request not allowed.' }, 403);
  return json({ authorized: true });
}
