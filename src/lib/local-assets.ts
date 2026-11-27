import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { privateHeaders } from './responses';
import type { ArchiveData } from './types';

const FILE_PREFIX = 'archive/v1/files/';

type EnvMap = Readonly<Record<string, string | undefined>>;

/**
 * Local fixture asset serving is strictly for local development/E2E testing
 * and is impossible to enable on Vercel. It requires both ARCHIVE_LOCAL_DATA
 * and ARCHIVE_LOCAL_ASSETS_DIR and refuses whenever any Vercel env var is set.
 */
export function localAssetsRoot(env: EnvMap = process.env): string | null {
  if (env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL) return null;
  if (!env.ARCHIVE_LOCAL_DATA || !env.ARCHIVE_LOCAL_ASSETS_DIR) return null;
  return path.resolve(env.ARCHIVE_LOCAL_ASSETS_DIR);
}

export async function resolveLocalAssetPath(
  data: ArchiveData,
  id: string,
  env: EnvMap = process.env,
): Promise<{ asset: ArchiveData['assets'][string]; filePath: string } | null> {
  const root = localAssetsRoot(env);
  if (!root) return null;
  const asset = Object.hasOwn(data.assets, id) ? data.assets[id] : undefined;
  if (!asset || !asset.pathname.startsWith(FILE_PREFIX)) return null;

  const relative = asset.pathname.slice(FILE_PREFIX.length);
  if (
    !relative ||
    relative.startsWith('/') ||
    relative.includes('\\') ||
    relative.includes('\0') ||
    relative.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    return null;
  }

  try {
    const canonicalRoot = await realpath(/*turbopackIgnore: true*/ root);
    const candidate = path.resolve(canonicalRoot, relative);
    if (!candidate.startsWith(canonicalRoot + path.sep)) return null;
    const canonicalFile = await realpath(/*turbopackIgnore: true*/ candidate);
    if (!canonicalFile.startsWith(canonicalRoot + path.sep)) return null;
    const info = await stat(/*turbopackIgnore: true*/ canonicalFile);
    if (!info.isFile()) return null;
    return { asset, filePath: canonicalFile };
  } catch {
    return null;
  }
}

export async function localSignedAsset(
  data: ArchiveData,
  id: string,
  env: EnvMap = process.env,
): Promise<{ url: string; expiresAt: number } | null> {
  const resolved = await resolveLocalAssetPath(data, id, env);
  if (!resolved) return null;
  return {
    url: `/api/assets/${encodeURIComponent(id)}?local=1`,
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

function sanitizeDownloadFilename(name: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]/g, '_');
  return base || 'download';
}

function parseSingleByteRange(header: string, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return 'unsatisfiable';
  if (size <= 0) return 'unsatisfiable';

  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'unsatisfiable';
    const start = Math.max(0, size - suffix);
    return { start, end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd ? Math.min(size - 1, Number(rawEnd)) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    return 'unsatisfiable';
  }
  return { start, end };
}

export async function serveLocalAsset(
  request: Request,
  data: ArchiveData,
  id: string,
  env: EnvMap = process.env,
): Promise<Response | null> {
  const resolved = await resolveLocalAssetPath(data, id, env);
  if (!resolved) return null;
  const { asset, filePath } = resolved;
  const info = await stat(/*turbopackIgnore: true*/ filePath);
  const size = info.size;
  const query = new URL(request.url).searchParams;
  const baseHeaders: Record<string, string> = {
    ...privateHeaders,
    'Content-Type': asset.contentType,
    'Accept-Ranges': 'bytes',
  };
  if (query.get('download') === '1') {
    baseHeaders['Content-Disposition'] = `attachment; filename="${sanitizeDownloadFilename(asset.name)}"`;
  }

  const rangeHeader = request.headers.get('range');
  if (rangeHeader) {
    const parsed = parseSingleByteRange(rangeHeader, size);
    if (parsed === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { ...privateHeaders, 'Content-Range': `bytes */${size}` },
      });
    }
    if (parsed) {
      const length = parsed.end - parsed.start + 1;
      const buffer = Buffer.alloc(length);
      const handle = await open(/*turbopackIgnore: true*/ filePath, 'r');
      try {
        const { bytesRead } = await handle.read(buffer, 0, length, parsed.start);
        return new Response(new Uint8Array(buffer.subarray(0, bytesRead)), {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Range': `bytes ${parsed.start}-${parsed.start + bytesRead - 1}/${size}`,
            'Content-Length': String(bytesRead),
          },
        });
      } finally {
        await handle.close();
      }
    }
  }

  const buffer = Buffer.alloc(size);
  const handle = await open(/*turbopackIgnore: true*/ filePath, 'r');
  try {
    const { bytesRead } = await handle.read(buffer, 0, size, 0);
    return new Response(new Uint8Array(buffer.subarray(0, bytesRead)), {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Length': String(bytesRead),
      },
    });
  } finally {
    await handle.close();
  }
}
