import { filenameStem } from './age';
import type { Session } from './types';

export const SESSION_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const APPROVED_SLUG_OVERRIDES: Record<string, string> = {
  'transcripts-ai/0wav::011119d': '011119d',
  'transcripts-ai/0extra/82-supp::011119d': '011119d-82-supp',
};

export function isValidSessionSlug(value: string): boolean {
  return SESSION_SLUG_RE.test(value);
}

export function normalizeSlugToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Derive a deterministic lower-case session slug from `sourceName` (falling back
 * to `fallbackId`) for older v1 archive.json blobs that predate stored `slug` fields.
 * Applies the same approved `011119d` collision resolution as `scripts/import-archive.py`.
 */
export function deriveSessionSlug(sourceName: string, fallbackId = ''): string {
  let normalized = sourceName.replace(/\\/g, '/');
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  normalized = normalized.replace(/^\/+/, '');
  const slash = normalized.lastIndexOf('/');
  const parent = slash >= 0 ? normalized.slice(0, slash) : '';
  const stem = filenameStem(normalized).toLowerCase();
  const override = APPROVED_SLUG_OVERRIDES[`${parent}::${stem}`];
  if (override) return override;
  const candidate = normalizeSlugToken(stem);
  if (candidate) return candidate;
  const fallback = normalizeSlugToken(fallbackId);
  return fallback || 'session';
}

export interface SessionLookupResult {
  session: Session;
  canonical: boolean;
}

/** Look up a session by its readable URL slug (case-insensitive, flagging non-canonical casing). */
export function findSessionBySlug(sessions: readonly Session[], rawSlug: string): SessionLookupResult | null {
  const trimmed = rawSlug.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  const match = sessions.find(session => session.slug.toLowerCase() === lowered);
  if (!match) return null;
  return { session: match, canonical: match.slug === rawSlug };
}
