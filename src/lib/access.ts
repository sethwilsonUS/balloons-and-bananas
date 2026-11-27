/**
 * Require a browser's explicit same-origin Origin for state-changing routes.
 * Missing, opaque, malformed, and foreign origins fail in every environment.
 * Bind to Host because Next may normalize request.url to an internal hostname.
 * Browsers cannot override Host. Arbitrary forwarded headers are not trusted.
 */
export function requestOriginIsAllowed(request: Request): boolean {
  try {
    const target = new URL(request.url);
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return false;
    const origin = request.headers.get('origin');
    if (!origin) return false;

    const host = request.headers.get('host');
    if (host !== null && (!host || !/^[A-Za-z0-9.\[\]:-]+$/.test(host))) return false;
    // Vercel terminates TLS before the app. Its own environment flag supplies
    // that deployment fact without trusting a client-supplied forwarded scheme.
    const protocol = process.env.VERCEL === '1' ? 'https:' : target.protocol;
    const expected = new URL(`${protocol}//${host ?? target.host}`);
    return origin === expected.origin;
  } catch {
    return false;
  }
}
