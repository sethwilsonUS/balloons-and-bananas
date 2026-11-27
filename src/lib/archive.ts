import 'server-only';
import { get, issueSignedToken, presignUrl } from '@vercel/blob';
import { buildCatalog, parseStoredArchiveData } from './archive-format';
import type { ArchiveData, Catalog } from './types';

let pending: Promise<ArchiveData> | undefined;
async function loadData(): Promise<ArchiveData> {
  let raw: unknown;
  if (process.env.ARCHIVE_LOCAL_DATA && !process.env.VERCEL) {
    const { readFile } = await import('node:fs/promises');
    raw = JSON.parse(await readFile(process.env.ARCHIVE_LOCAL_DATA, 'utf8'));
  } else {
    const pathname = process.env.ARCHIVE_DATA_PATH;
    if (!pathname || !pathname.startsWith('archive/')) throw new Error('Archive is not configured');
    const result = await get(pathname, { access: 'private', useCache: true });
    if (!result || result.statusCode !== 200) throw new Error('Archive is unavailable');
    raw = await new Response(result.stream).json();
  }
  // Map stored archive.json v1 keys (`entries`, `audio`, `preferredAudioId`)
  // to the glossary domain model at load time; see CONTEXT.md.
  return parseStoredArchiveData(raw);
}
// Authorization must precede this call in every route. Contents remain server memory only.
export function archive() {
  return pending ??= loadData().catch((error) => { pending = undefined; throw error; });
}
export function catalog(data: ArchiveData): Catalog {
  return buildCatalog(data);
}
export async function signedAsset(data: ArchiveData, id: string) {
  const asset = Object.hasOwn(data.assets, id) ? data.assets[id] : undefined;
  if (!asset || !asset.pathname.startsWith('archive/v1/files/')) return null;
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const signed = await issueSignedToken({ pathname: asset.pathname, operations: ['get'], validUntil: expiresAt });
  const { presignedUrl } = await presignUrl(signed, { operation: 'get', pathname: asset.pathname, access: 'private', validUntil: expiresAt });
  return { url: presignedUrl, expiresAt };
}
