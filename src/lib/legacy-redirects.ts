import { isLinguisticMarkerId } from './linguistic-markers';
import { findDocumentById } from './research';
import {
  buildSearchHref,
  hasExplicitSortParam,
  parseSearchUrlParams,
  type RawSearchParams,
} from './search-params';
import { resolveBackToResultsUrl } from './session-reading';
import { positiveThemes } from './topics';
import type { ArchiveData, ArchiveDocument, Session } from './types';

const POSITIVE_INT_RE = /^[1-9]\d*$/;
const ACCESS_SEGMENT_RE = /^access=/i;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const VALID_THEME_TOPICS: ReadonlySet<string> = new Set(positiveThemes.map(theme => theme.topic));

/**
 * Legacy document IDs whose content now lives on `/about` if the standalone
 * document is ever retired from `archive.json`. When the document still exists
 * in `data.documents`, `/?document=<id>` redirects to `/research/<id>`.
 */
const ABOUT_FALLBACK_DOCUMENT_IDS = new Set(['methods-and-audit']);

export type LegacyRootIntent =
  | { kind: 'none' }
  | { kind: 'entry'; rawId: string; passage: number | null; from: string | null }
  | { kind: 'document'; rawId: string }
  | { kind: 'marker'; destination: string };

export type LegacyRedirectResolution =
  | { kind: 'none' }
  | { kind: 'redirect'; destination: string }
  | { kind: 'not-found'; entity: 'session' | 'document' };

function isSearchParamsLike(params: RawSearchParams): params is { get(name: string): string | null } {
  return typeof (params as { get?: unknown }).get === 'function';
}

function readParam(params: RawSearchParams, key: string): string | null {
  if (isSearchParamsLike(params)) {
    return params.get(key);
  }
  const value = Object.hasOwn(params, key) ? params[key] : undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : null;
  }
  return null;
}

/**
 * Parse a 1-based positive integer `?passage=N` parameter.
 * Rejects zero, negative numbers, leading zeros, decimals, and non-safe integers.
 */
export function parseLegacyPassageParam(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!POSITIVE_INT_RE.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

/**
 * Validate a root-relative `?from=` return path for legacy session links.
 * Accepts only same-origin root-relative search/browse paths (never external URLs
 * or protocol-relative paths).
 */
function parseLegacyFromParam(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) return null;
  return resolveBackToResultsUrl(trimmed, 'http://archive.invalid');
}

/** Verify that a redirect destination is a safe root-relative internal path. */
export function isSafeRootRelativeDestination(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return false;
  if (CONTROL_CHAR_RE.test(value)) return false;
  return true;
}

/**
 * Classify query parameters on `/` into a legacy redirect intent using the same
 * precedence order as the historical single-page reader (`entry` > `document` > `marker`).
 *
 * Returns `{ kind: 'marker', destination }` directly when a valid linguistic marker
 * link can be redirected without loading archive data (used in Next.js `proxy.ts`).
 */
export function classifyLegacyRootRequest(params: RawSearchParams): LegacyRootIntent {
  const rawEntry = readParam(params, 'entry')?.trim() ?? '';
  if (rawEntry) {
    return {
      kind: 'entry',
      rawId: rawEntry,
      passage: parseLegacyPassageParam(readParam(params, 'passage')),
      from: parseLegacyFromParam(readParam(params, 'from')),
    };
  }

  const rawDocument = readParam(params, 'document')?.trim() ?? '';
  if (rawDocument) {
    return {
      kind: 'document',
      rawId: rawDocument,
    };
  }

  const rawMarker = readParam(params, 'marker')?.trim() ?? '';
  if (rawMarker && isLinguisticMarkerId(rawMarker)) {
    const searchState = parseSearchUrlParams(params, { validTopics: VALID_THEME_TOPICS });
    const destination = buildSearchHref(searchState, {
      explicitSort: hasExplicitSortParam(params),
    });
    return {
      kind: 'marker',
      destination,
    };
  }

  return { kind: 'none' };
}

/**
 * Look up a session by legacy ID (`legacyId` / `id`, exact then case-insensitive)
 * or by readable session `slug` (case-insensitive).
 */
export function findSessionByLegacyIdOrSlug(
  sessions: readonly Session[],
  rawId: string,
): Session | null {
  const trimmed = rawId.trim();
  if (!trimmed) return null;

  const exact = sessions.find(session => session.legacyId === trimmed || session.id === trimmed);
  if (exact) return exact;

  const lowered = trimmed.toLowerCase();
  const caseInsensitiveLegacy = sessions.find(
    session => session.legacyId.toLowerCase() === lowered || session.id.toLowerCase() === lowered,
  );
  if (caseInsensitiveLegacy) return caseInsensitiveLegacy;

  return sessions.find(session => session.slug.toLowerCase() === lowered) ?? null;
}

/** Resolve a legacy `/?entry=<id>[&passage=<N>][&from=<path>]` link against archive sessions. */
export function resolveLegacyEntryTarget(
  sessions: readonly Session[],
  rawId: string,
  passage: number | null = null,
  from: string | null = null,
): Exclude<LegacyRedirectResolution, { kind: 'none' }> {
  const session = findSessionByLegacyIdOrSlug(sessions, rawId);
  if (!session) {
    return { kind: 'not-found', entity: 'session' };
  }
  const base = `/sessions/${encodeURIComponent(session.slug)}`;
  const validFrom = from ? parseLegacyFromParam(from) : null;
  const query = validFrom ? `?from=${encodeURIComponent(validFrom)}` : '';
  const validPassage = typeof passage === 'number' && Number.isSafeInteger(passage) && passage >= 1
    ? passage
    : null;
  const hash = validPassage !== null ? `#p${validPassage}` : '';
  return {
    kind: 'redirect',
    destination: `${base}${query}${hash}`,
  };
}

/**
 * Resolve a legacy `/?document=<id>` link to `/research/<canonicalId>`, falling
 * back to `/about` for retired methods documents whose content moved there, or
 * `not-found` for unknown IDs.
 */
export function resolveLegacyDocumentTarget(
  documents: readonly ArchiveDocument[],
  rawId: string,
): Exclude<LegacyRedirectResolution, { kind: 'none' }> {
  const trimmed = rawId.trim();
  if (!trimmed) {
    return { kind: 'not-found', entity: 'document' };
  }
  const lookup = findDocumentById(documents, trimmed);
  if (lookup) {
    return {
      kind: 'redirect',
      destination: `/research/${encodeURIComponent(lookup.document.id)}`,
    };
  }
  if (ABOUT_FALLBACK_DOCUMENT_IDS.has(trimmed.toLowerCase())) {
    return {
      kind: 'redirect',
      destination: '/about',
    };
  }
  return { kind: 'not-found', entity: 'document' };
}

/** Resolve a classified legacy root intent against the loaded archive dataset. */
export function resolveLegacyRootIntent(
  intent: LegacyRootIntent,
  data: Pick<ArchiveData, 'sessions' | 'documents'>,
): LegacyRedirectResolution {
  switch (intent.kind) {
    case 'none':
      return { kind: 'none' };
    case 'marker':
      return { kind: 'redirect', destination: intent.destination };
    case 'entry':
      return resolveLegacyEntryTarget(data.sessions, intent.rawId, intent.passage, intent.from);
    case 'document':
      return resolveLegacyDocumentTarget(data.documents, intent.rawId);
  }
}

/**
 * Remove obsolete `#access=...` segments from a URL fragment while preserving
 * all other fragments (`#p42`, `#t=12:34`, `#inferred-ages`, `#access-and-analytics`, etc.).
 *
 * Returns:
 * - `null` when the fragment contains no `access=` segment (caller should not modify the URL)
 * - `""` when stripping `access=` leaves no remaining fragment
 * - `"#<remaining>"` when non-access fragment segments remain
 */
export function stripAccessFromHash(rawHash: string): string | null {
  if (!rawHash || rawHash === '#') return null;
  const body = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
  if (!body) return null;

  const parts = body.split('&');
  const kept: string[] = [];
  let removed = false;
  for (const part of parts) {
    if (ACCESS_SEGMENT_RE.test(part)) {
      removed = true;
    } else if (part !== '') {
      kept.push(part);
    }
  }
  if (!removed) return null;
  return kept.length > 0 ? `#${kept.join('&')}` : '';
}

/**
 * Pre-paint inline script that runs in `<head>` alongside `ThemeBootstrap` to
 * strip obsolete `#access=...` fragments before React hydration, session hash
 * parsing, or analytics run, while preserving every other fragment intact.
 */
export const ACCESS_HASH_BOOTSTRAP_SCRIPT =
  `(function(){try{var h=location.hash;if(!h||h.length<2)return;var p=h.slice(1).split('&'),k=[],r=false;for(var i=0;i<p.length;i++){if(/^access=/i.test(p[i])){r=true;}else if(p[i]!==''){k.push(p[i]);}}if(!r)return;var u=new URL(location.href);u.hash=k.length?'#'+k.join('&'):'';history.replaceState(history.state,'',u.href);}catch(e){}})();`;
