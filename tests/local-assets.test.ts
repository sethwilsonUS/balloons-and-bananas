import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  localAssetsRoot,
  localSignedAsset,
  resolveLocalAssetPath,
  serveLocalAsset,
} from '../src/lib/local-assets';
import type { ArchiveData } from '../src/lib/types';

function makeFixtureData(assetPath = 'archive/v1/files/sample.txt'): ArchiveData {
  return {
    version: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    entries: [],
    documents: [],
    assets: {
      'fixture-sample': {
        pathname: assetPath,
        name: 'sample.txt',
        contentType: 'text/plain; charset=utf-8',
        bytes: 16,
        sha256: '0'.repeat(64),
      },
      'fixture-escape': {
        pathname: 'archive/v1/files/../secret.txt',
        name: 'secret.txt',
        contentType: 'text/plain; charset=utf-8',
        bytes: 10,
        sha256: '0'.repeat(64),
      },
      'fixture-bad-prefix': {
        pathname: 'other/sample.txt',
        name: 'sample.txt',
        contentType: 'text/plain; charset=utf-8',
        bytes: 10,
        sha256: '0'.repeat(64),
      },
    },
  };
}

test('local asset serving refuses whenever any Vercel env flag is set or required local vars are missing', () => {
  const localEnv = {
    ARCHIVE_LOCAL_DATA: 'tests/fixtures/archive.json',
    ARCHIVE_LOCAL_ASSETS_DIR: 'tests/fixtures/files',
  };
  assert.equal(localAssetsRoot(localEnv), path.resolve('tests/fixtures/files'));
  assert.equal(localAssetsRoot({ ...localEnv, VERCEL: '1' }), null);
  assert.equal(localAssetsRoot({ ...localEnv, VERCEL_ENV: 'production' }), null);
  assert.equal(localAssetsRoot({ ...localEnv, VERCEL_ENV: 'preview' }), null);
  assert.equal(localAssetsRoot({ ...localEnv, VERCEL_URL: 'example.vercel.app' }), null);
  assert.equal(localAssetsRoot({ ARCHIVE_LOCAL_DATA: 'tests/fixtures/archive.json' }), null);
  assert.equal(localAssetsRoot({ ARCHIVE_LOCAL_ASSETS_DIR: 'tests/fixtures/files' }), null);
  assert.equal(localAssetsRoot({}), null);
});

test('local asset resolution blocks path traversal, bad prefixes, unknown IDs, symlinks outside root, and Vercel envs', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'bnb-local-assets-'));
  try {
    const assetsDir = path.join(tmp, 'files');
    const outsideFile = path.join(tmp, 'outside.txt');
    await mkdir(assetsDir, { recursive: true });
    await writeFile(path.join(assetsDir, 'sample.txt'), '0123456789abcdef', 'utf8');
    await writeFile(outsideFile, 'outside-secret', 'utf8');
    await symlink(outsideFile, path.join(assetsDir, 'escaped-link.txt'));

    const env = {
      ARCHIVE_LOCAL_DATA: path.join(tmp, 'archive.json'),
      ARCHIVE_LOCAL_ASSETS_DIR: assetsDir,
    };
    const data = makeFixtureData();
    data.assets['fixture-symlink'] = {
      pathname: 'archive/v1/files/escaped-link.txt',
      name: 'escaped-link.txt',
      contentType: 'text/plain; charset=utf-8',
      bytes: 14,
      sha256: '0'.repeat(64),
    };

    const ok = await resolveLocalAssetPath(data, 'fixture-sample', env);
    assert.ok(ok);
    assert.equal(await resolveLocalAssetPath(data, 'fixture-sample', { ...env, VERCEL: '1' }), null);
    assert.equal(await resolveLocalAssetPath(data, 'fixture-escape', env), null);
    assert.equal(await resolveLocalAssetPath(data, 'fixture-bad-prefix', env), null);
    assert.equal(await resolveLocalAssetPath(data, 'fixture-symlink', env), null);
    assert.equal(await resolveLocalAssetPath(data, 'toString', env), null);
    assert.equal(await resolveLocalAssetPath(data, 'nonexistent', env), null);

    const signed = await localSignedAsset(data, 'fixture-sample', env);
    assert.ok(signed);
    assert.equal(signed.url, '/api/assets/fixture-sample?local=1');
    assert.ok(signed.expiresAt > Date.now());
    assert.equal(await localSignedAsset(data, 'fixture-sample', { ...env, VERCEL: '1' }), null);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('serveLocalAsset preserves private headers, supports Range requests, and sets attachment disposition for download=1', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'bnb-local-serve-'));
  try {
    const assetsDir = path.join(tmp, 'files');
    await mkdir(assetsDir, { recursive: true });
    await writeFile(path.join(assetsDir, 'sample.txt'), '0123456789abcdef', 'utf8');
    const env = {
      ARCHIVE_LOCAL_DATA: path.join(tmp, 'archive.json'),
      ARCHIVE_LOCAL_ASSETS_DIR: assetsDir,
    };
    const data = makeFixtureData();

    const checkPrivateHeaders = (res: Response) => {
      assert.match(res.headers.get('cache-control') ?? '', /\bno-store\b/i);
      assert.match(res.headers.get('cdn-cache-control') ?? '', /\bno-store\b/i);
      assert.match(res.headers.get('x-robots-tag') ?? '', /\bnoindex\b/i);
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    };

    const full = await serveLocalAsset(
      new Request('http://127.0.0.1:3103/api/assets/fixture-sample?local=1'),
      data,
      'fixture-sample',
      env,
    );
    assert.ok(full);
    assert.equal(full.status, 200);
    checkPrivateHeaders(full);
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(full.headers.get('content-length'), '16');
    assert.equal(await full.text(), '0123456789abcdef');

    const partial = await serveLocalAsset(
      new Request('http://127.0.0.1:3103/api/assets/fixture-sample?local=1', {
        headers: { Range: 'bytes=4-9' },
      }),
      data,
      'fixture-sample',
      env,
    );
    assert.ok(partial);
    assert.equal(partial.status, 206);
    checkPrivateHeaders(partial);
    assert.equal(partial.headers.get('content-range'), 'bytes 4-9/16');
    assert.equal(partial.headers.get('content-length'), '6');
    assert.equal(await partial.text(), '456789');

    const invalidRange = await serveLocalAsset(
      new Request('http://127.0.0.1:3103/api/assets/fixture-sample?local=1', {
        headers: { Range: 'bytes=999-1200' },
      }),
      data,
      'fixture-sample',
      env,
    );
    assert.ok(invalidRange);
    assert.equal(invalidRange.status, 416);
    checkPrivateHeaders(invalidRange);
    assert.equal(invalidRange.headers.get('content-range'), 'bytes */16');

    const download = await serveLocalAsset(
      new Request('http://127.0.0.1:3103/api/assets/fixture-sample?download=1'),
      data,
      'fixture-sample',
      env,
    );
    assert.ok(download);
    assert.equal(download.status, 200);
    checkPrivateHeaders(download);
    assert.equal(download.headers.get('content-disposition'), 'attachment; filename="sample.txt"');

    const blockedOnVercel = await serveLocalAsset(
      new Request('http://127.0.0.1:3103/api/assets/fixture-sample?local=1'),
      data,
      'fixture-sample',
      { ...env, VERCEL: '1' },
    );
    assert.equal(blockedOnVercel, null);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
