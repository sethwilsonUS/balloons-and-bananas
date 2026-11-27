import { readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { put, get, head, BlobNotFoundError } from '@vercel/blob';

process.loadEnvFile('.env.local');
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error('Private storage credential is not configured');
const plan = JSON.parse(await readFile('private-data/upload-plan.json', 'utf8'));
if (plan.assets.some(a => a.contentType === 'application/pdf' || /\.pdf$/i.test(a.name))) {
  throw new Error('Research PDFs are external links, not hosted assets');
}
if (plan.assets.some(a => !a.pathname.startsWith('archive/v1/files/'))) throw new Error('Asset path is outside the archive');
const statePath = 'private-data/upload-state.json';
let state;
try { state = JSON.parse(await readFile(statePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; state = { version: 1, files: {}, failures: [] }; }
async function digestStream(stream) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of stream) { bytes += chunk.byteLength; hash.update(chunk); }
  return { bytes, sha256: hash.digest('hex') };
}
let writes = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(state, null, 2) + '\n';
  writes = writes.then(async () => { await writeFile(statePath + '.tmp', snapshot, { mode: 0o600 }); await rename(statePath + '.tmp', statePath); });
  return writes;
}
async function invalidate(pathname) {
  delete state.files[pathname];
  await save();
}
let complete = 0;
let lastProgressAt = Date.now();
function progress() {
  if (Date.now() - lastProgressAt < 300_000) return;
  lastProgressAt = Date.now();
  console.log(JSON.stringify({ verifiedFiles: complete, plannedFiles: plan.assets.length + 1 }));
}
async function upload(file) {
  const existing = state.files[file.pathname];
  if (existing?.sha256 === file.sha256 && existing?.roundTripVerified) {
    let metadata;
    try { metadata = await head(file.pathname, { token, abortSignal: AbortSignal.timeout(60_000) }); }
    catch (error) { if (error instanceof BlobNotFoundError) await invalidate(file.pathname); throw error; }
    if (metadata.size !== file.bytes || !metadata.url.includes('.private.blob.vercel-storage.com/')) {
      await invalidate(file.pathname);
      throw new Error('Stored file no longer matches receipt');
    }
    complete++;
    return;
  }
  // Application code streams both directions; the SDK keeps bounded multipart buffers.
  const local = await digestStream(createReadStream(file.localPath));
  if (local.bytes !== file.bytes || local.sha256 !== file.sha256) throw new Error('Local source changed');
  let result = existing?.sha256 === file.sha256 && existing.uploaded ? existing : null;
  if (!result) {
    result = await put(file.pathname, createReadStream(file.localPath), {
      token, access: 'private', addRandomSuffix: false, allowOverwrite: true,
      contentType: file.contentType, cacheControlMaxAge: 60,
      multipart: file.bytes >= 8 * 1024 * 1024, maximumSizeInBytes: file.bytes,
      abortSignal: AbortSignal.timeout(30 * 60 * 1000),
    });
    if (!result.url.includes('.private.blob.vercel-storage.com/')) throw new Error('Storage access is not private');
    state.files[file.pathname] = { bytes: file.bytes, sha256: file.sha256, url: result.url, uploaded: true, roundTripVerified: false };
    await save();
  }
  let readback;
  try { readback = await get(result.url, { token, access: 'private', useCache: false, abortSignal: AbortSignal.timeout(30 * 60 * 1000) }); }
  catch (error) { if (error instanceof BlobNotFoundError) await invalidate(file.pathname); throw error; }
  if (!readback) { await invalidate(file.pathname); throw new Error('Stored file was not found'); }
  if (readback.statusCode !== 200) throw new Error('Cannot verify stored file');
  const returned = await digestStream(readback.stream);
  if (returned.bytes !== file.bytes || returned.sha256 !== file.sha256) {
    await invalidate(file.pathname);
    throw new Error('Stored bytes differ from source');
  }
  state.files[file.pathname] = { bytes: file.bytes, sha256: file.sha256, url: result.url, uploaded: true, roundTripVerified: true, checkedAt: new Date().toISOString() };
  complete++;
  await save();
  progress();
}
let cursor = 0;
const failures = [];
await Promise.all(Array.from({ length: 3 }, async () => {
  while (cursor < plan.assets.length) {
    const file = plan.assets[cursor++];
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await upload(file); lastError = undefined; break; }
      catch (error) { lastError = error; if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt)); }
    }
    if (lastError) failures.push({ pathname: file.pathname, errorType: lastError.constructor.name });
  }
}));
state.failures = failures;
await save();
if (failures.length) {
  console.error(JSON.stringify({ status: 'incomplete', failedFiles: failures.length, verifiedFiles: complete, details: statePath }));
  process.exitCode = 1;
} else {
  await upload(plan.catalog);
  state.completedAt = new Date().toISOString();
  state.audioFilesUploaded = plan.assets.filter(a => a.contentType.startsWith('audio/')).length;
  state.pdfFilesUploaded = 0;
  await save();
  await chmod(statePath, 0o600);
  console.log(JSON.stringify({ status: 'complete', verifiedFiles: complete, totalStoredBytes: [...plan.assets, plan.catalog].reduce((n, f) => n + f.bytes, 0), audioFilesUploaded: state.audioFilesUploaded, pdfFilesUploaded: 0 }));
}
