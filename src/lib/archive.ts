import 'server-only';
import { get, issueSignedToken, presignUrl } from '@vercel/blob';
import { ARCHIVE_NAME } from './site';
import type { ArchiveData, Catalog } from './types';

let pending: Promise<ArchiveData> | undefined;
async function loadData(): Promise<ArchiveData> {
  let data: ArchiveData;
  if (process.env.ARCHIVE_LOCAL_DATA && !process.env.VERCEL) {
    const { readFile } = await import('node:fs/promises');
    data = JSON.parse(await readFile(process.env.ARCHIVE_LOCAL_DATA, 'utf8')) as ArchiveData;
  } else {
    const pathname = process.env.ARCHIVE_DATA_PATH;
    if (!pathname || !pathname.startsWith('archive/')) throw new Error('Archive is not configured');
    const result = await get(pathname, { access: 'private', useCache: true });
    if (!result || result.statusCode !== 200) throw new Error('Archive is unavailable');
    data = await new Response(result.stream).json() as ArchiveData;
  }
  if (data.version !== 1 || !Array.isArray(data.entries) || !Array.isArray(data.documents) || !data.assets) {
    throw new Error('Archive format mismatch');
  }
  return data;
}
// Authorization must precede this call in every route. Contents remain server memory only.
export function archive() {
  return pending ??= loadData().catch((error) => { pending = undefined; throw error; });
}
export function catalog(data: ArchiveData): Catalog {
  const topics = new Map<string, number>();
  for (const entry of data.entries) for (const topic of entry.topics) topics.set(topic, (topics.get(topic) ?? 0) + 1);
  return {
    title: ARCHIVE_NAME,
    counts: {
      entries: data.entries.length,
      audio: new Set(data.entries.flatMap(entry => entry.audio.filter(file => file.kind !== 'listening-copy').map(file => file.id))).size,
      moments: data.entries.reduce((n, e) => n + e.moments.length, 0),
      original: data.entries.filter(e => e.origin === 'archived_research').length,
      talkbankAi: data.entries.filter(e => e.origin === 'talkbank_ai_draft').length,
      localAi: data.entries.filter(e => e.origin === 'local_ai_draft').length,
    },
    topics: [...topics].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })),
    documents: data.documents,
  };
}
export async function signedAsset(data: ArchiveData, id: string) {
  const asset = Object.hasOwn(data.assets, id) ? data.assets[id] : undefined;
  if (!asset || !asset.pathname.startsWith('archive/v1/files/')) return null;
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const signed = await issueSignedToken({ pathname: asset.pathname, operations: ['get'], validUntil: expiresAt });
  const { presignedUrl } = await presignUrl(signed, { operation: 'get', pathname: asset.pathname, access: 'private', validUntil: expiresAt });
  return { url: presignedUrl, expiresAt };
}
