import { json } from '@/lib/responses';

export async function GET() { return json({ url: '/' }); }
