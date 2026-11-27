import { requestOriginIsAllowed } from '@/lib/access';
import { json } from '@/lib/responses';

// Public access does not require or issue a session cookie.
export async function GET() { return json({ authorized: true }); }
export async function DELETE(request: Request) {
  if (!requestOriginIsAllowed(request)) return json({ error: 'Request not allowed.' }, 403);
  return json({ authorized: true });
}
