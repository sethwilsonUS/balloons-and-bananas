import { NextResponse } from 'next/server';

export const privateHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
export function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: privateHeaders }); }
export function unavailable() { return json({ error: 'This item is temporarily unavailable. Please try again.' }, 503); }
