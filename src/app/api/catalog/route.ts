import { archive, catalog } from '@/lib/archive';
import { json, unavailable } from '@/lib/responses';

export const runtime = 'nodejs';
export async function GET(request: Request) {
  try { return json(catalog(await archive())); } catch { return unavailable(); }
}
