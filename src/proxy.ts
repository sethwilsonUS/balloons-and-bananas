import { NextResponse, type NextRequest } from 'next/server';
import {
  classifyLegacyRootRequest,
  isSafeRootRelativeDestination,
} from './lib/legacy-redirects';
import { privateHeaders } from './lib/responses';

/**
 * Next.js 16 Proxy (`src/proxy.ts`) intercepts legacy root query links that do
 * not require loading the archive catalog (`/?marker=X&speaker=Y` and `/?marker=X`)
 * and returns a permanent HTTP 308 redirect to `/search?...` with private headers
 * before page rendering begins.
 *
 * Archive-backed legacy links (`/?entry=<legacyId>[&passage=N]` and `/?document=<id>`)
 * require reading the private archive catalog at request time and are resolved in
 * `src/app/page.tsx` using `permanentRedirect` (HTTP 308) and `notFound` (HTTP 404).
 */
export function proxy(request: NextRequest) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return NextResponse.next();
  }

  const intent = classifyLegacyRootRequest(request.nextUrl.searchParams);
  if (intent.kind === 'marker' && isSafeRootRelativeDestination(intent.destination)) {
    const target = new URL(intent.destination, request.url);
    return NextResponse.redirect(target, {
      status: 308,
      headers: privateHeaders,
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/',
};
