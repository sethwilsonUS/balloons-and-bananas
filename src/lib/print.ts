import { ARCHIVE_NAME } from './site';

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
