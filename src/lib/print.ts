import { ARCHIVE_NAME } from './site';

const SAFE_HOST_RE = /^[A-Za-z0-9.\[\]:-]+$/;

/**
 * Normalize an HTTP(S) origin string (stripping path/query/hash) and reject
 * non-HTTP(S) schemes, opaque `"null"` origins, and malformed values.
 */
export function normalizeHttpOrigin(origin?: string | null): string | null {
  const trimmed = origin?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Derive the canonical server request origin from the validated `Host` header
 * only (never trusting spoofable `x-forwarded-host` / `x-forwarded-proto`,
 * matching `src/lib/access.ts`). Returns `null` when `Host` is missing or
 * invalid so SSR citations fall back cleanly to root-relative paths.
 */
export function resolveServerRequestOrigin(
  headerList: Pick<Headers, 'get'>,
  isVercel: boolean = process.env.VERCEL === '1',
): string | null {
  const host = headerList.get('host')?.trim();
  if (!host || !SAFE_HOST_RE.test(host)) return null;
  const proto = isVercel ? 'https' : 'http';
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return null;
  }
}

/**
 * Format the print-only document header line for a session page:
 * `"The Seth Tapes · Session <slug>"`.
 */
export function formatPrintSessionHeader(slug: string): string {
  const trimmed = slug.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    throw new RangeError('Print session header requires a valid non-empty session identifier.');
  }
  return `${ARCHIVE_NAME} · Session ${trimmed}`;
}
