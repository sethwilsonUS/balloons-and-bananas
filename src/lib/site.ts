import type { SearchView } from './results-view';

export const ARCHIVE_NAME = 'The Seth Tapes';
export const ARCHIVE_SUBTITLE = 'A childhood-language archive from the Peters/Wilson corpus';
export const DEFAULT_SITE_URL = 'https://balloons-and-bananas.vercel.app';
export const DEFAULT_SITE_HOST = 'balloons-and-bananas.vercel.app';

const SAFE_BARE_HOST_RE = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;
const VALID_HOSTNAME_RE = /^(?:localhost|(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{2,59})|(?:\d{1,3}\.){3}\d{1,3}|\[[0-9a-fA-F:]+\])$/;

/**
 * Parse a site origin from an environment variable, normalizing to its origin
 * (scheme + host) and rejecting credentials, malformed URLs, or non-HTTP(S) schemes.
 * When `allowBareHost` is true, bare hostnames (as provided by Vercel's `VERCEL_URL`
 * and `VERCEL_PROJECT_PRODUCTION_URL`) are promoted to `https://`.
 */
export function parseSiteOrigin(
  raw?: string | null,
  options: { allowBareHost?: boolean } = {},
): URL | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  let candidate = trimmed;
  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(candidate)) {
    if (!options.allowBareHost || !SAFE_BARE_HOST_RE.test(candidate)) {
      return null;
    }
    candidate = `https://${candidate}`;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (parsed.username || parsed.password || !VALID_HOSTNAME_RE.test(parsed.hostname)) {
      return null;
    }
    return new URL(parsed.origin);
  } catch {
    return null;
  }
}

/**
 * Resolve Next.js `metadataBase` so `og:image` and `twitter:image` always emit
 * absolute URLs:
 * 1. Explicit `NEXT_PUBLIC_SITE_URL` if valid.
 * 2. Preview deployment `VERCEL_URL` when `VERCEL_ENV === 'preview'` so PR
 *    previews verify their own generated card.
 * 3. Canonical `VERCEL_PROJECT_PRODUCTION_URL` in production.
 * 4. `VERCEL_URL` fallback if set without `VERCEL_ENV`.
 * 5. Canonical production fallback (`https://balloons-and-bananas.vercel.app`).
 */
export function resolveMetadataBase(
  env: Readonly<Record<string, string | undefined>> = process.env,
): URL {
  const explicit = parseSiteOrigin(env.NEXT_PUBLIC_SITE_URL);
  if (explicit) return explicit;

  if (env.VERCEL_ENV === 'preview') {
    const preview = parseSiteOrigin(env.VERCEL_URL, { allowBareHost: true });
    if (preview) return preview;
  }

  const production = parseSiteOrigin(env.VERCEL_PROJECT_PRODUCTION_URL, { allowBareHost: true });
  if (production) return production;

  const deployment = parseSiteOrigin(env.VERCEL_URL, { allowBareHost: true });
  if (deployment) return deployment;

  return new URL(DEFAULT_SITE_URL);
}

/**
 * Resolve the clean, human-readable canonical host printed in the site-wide
 * Open Graph card footer (never an ephemeral preview deployment hash).
 */
export function resolveCanonicalSiteHost(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const explicit = parseSiteOrigin(env.NEXT_PUBLIC_SITE_URL);
  if (explicit) return explicit.host;

  const production = parseSiteOrigin(env.VERCEL_PROJECT_PRODUCTION_URL, { allowBareHost: true });
  if (production) return production.host;

  return DEFAULT_SITE_HOST;
}

/**
 * Format the document `<title>` for `/sessions/[id]`, keeping source ages and
 * filename-inferred ages explicitly distinguished.
 */
export function formatSessionPageTitle(session: {
  slug: string;
  ages: readonly string[];
  inferredAge: string | null;
}): string {
  const sourceAges = session.ages.map(age => age.trim()).filter(Boolean);
  if (sourceAges.length > 0) {
    return `Session ${session.slug} (age ${sourceAges.join(' / ')}) · ${ARCHIVE_NAME}`;
  }
  const inferred = session.inferredAge?.trim();
  if (inferred) {
    return `Session ${session.slug} (inferred age ${inferred}) · ${ARCHIVE_NAME}`;
  }
  return `Session ${session.slug} · ${ARCHIVE_NAME}`;
}

/** Format the document `<title>` for `/research/[doc]`. */
export function formatResearchDocumentPageTitle(title?: string | null): string {
  const trimmed = title?.trim();
  return `${trimmed || 'Document not found'} · Research · ${ARCHIVE_NAME}`;
}

export type DocumentTitleState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'overview' }
  | { kind: 'sessions'; hasFilters: boolean }
  | { kind: 'search'; hasFilters: boolean; view?: SearchView }
  | { kind: 'session'; title?: string | null; notFound?: boolean }
  | { kind: 'research' }
  | { kind: 'document'; title?: string | null }
  | { kind: 'about' };

export function formatDocumentTitle(state: DocumentTitleState): string {
  switch (state.kind) {
    case 'loading':
      return ARCHIVE_NAME;
    case 'error':
      return `Archive unavailable · ${ARCHIVE_NAME}`;
    case 'overview':
      return `Overview · ${ARCHIVE_NAME}`;
    case 'sessions':
      return `${state.hasFilters ? 'Search results' : 'Sessions'} · ${ARCHIVE_NAME}`;
    case 'search':
      if (state.view === 'concordance') return `Concordance · ${ARCHIVE_NAME}`;
      return `${state.hasFilters ? 'Search results' : 'Search'} · ${ARCHIVE_NAME}`;
    case 'session': {
      const trimmed = state.title?.trim();
      if (trimmed) return `${trimmed} · ${ARCHIVE_NAME}`;
      return `${state.notFound ? 'Session not found' : 'Session'} · ${ARCHIVE_NAME}`;
    }
    case 'research':
      return `Research & context · ${ARCHIVE_NAME}`;
    case 'document': {
      const trimmed = state.title?.trim();
      return `${trimmed || 'Document not found'} · ${ARCHIVE_NAME}`;
    }
    case 'about':
      return `About & methods · ${ARCHIVE_NAME}`;
  }
}
