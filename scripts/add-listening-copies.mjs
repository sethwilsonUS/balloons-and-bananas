#!/usr/bin/env node
// Run only after the original upload has finished, then rerun upload-archive.mjs.
// This adds verified derivatives; canonical audio and transcripts are never edited.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('private-data');
const checkOnly = process.argv.includes('--check-only');
const read = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const data = await read('archive.json');
const plan = await read('upload-plan.json');
const manifest = await read('listening-copies-manifest.json');
assert.equal(manifest.version, 1);
assert.equal(manifest.complete, true, 'Conversion and timing checks must finish first');
assert.equal(manifest.bitRate, 128000);
assert.equal(manifest.copies.length, 128);

const copyIds = new Set(data.entries.flatMap(e => e.audio.filter(a => a.kind === 'listening-copy').map(a => a.id)));
const oldHostingNote = 'Original audio is available for playback. Transcript timestamps are navigation aids; audio associations, speech recognition and alignment have not been independently verified by listening.';
const newHostingNote = 'MP3 audio is available for playback; original files remain available for download. Converted listening copies are labelled separately. Transcript timestamps are navigation aids; audio associations, speech recognition and alignment have not been independently verified by listening.';
function sourceView(entry) {
  const selected = entry.audio.find(a => a.id === entry.preferredAudioId);
  return { ...entry, audio: entry.audio.filter(a => a.kind !== 'listening-copy'),
    preferredAudioId: selected?.kind === 'listening-copy' ? selected.derivedFromId : entry.preferredAudioId,
    limits: entry.limits.filter(note => note !== oldHostingNote && note !== newHostingNote) };
}
const originalView = JSON.stringify(data.entries.map(sourceView));
const originals = data.entries.flatMap(e => sourceView(e).audio);
assert.equal(originals.length, 477);
assert.equal(new Set(originals.map(a => a.id)).size, 477);
const eligible = new Map(data.entries.filter(e => {
  const files = sourceView(e).audio;
  return files.length > 0 && files.every(a => a.format === 'wav');
}).map(e => [e.id, e]));
assert.equal(eligible.size, 128);
assert.equal(new Set(manifest.copies.map(c => c.entryId)).size, 128);

const byId = new Map(plan.assets.map(a => [a.id, a]));
const nextAssets = Object.fromEntries(Object.entries(data.assets).filter(([id]) => !copyIds.has(id)));
const nextPlanAssets = plan.assets.filter(a => !copyIds.has(a.id));
const additions = [];
async function digest(file) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); bytes += chunk.byteLength; }
  return { sha256: hash.digest('hex'), bytes };
}
for (const copy of manifest.copies) {
  const entry = eligible.get(copy.entryId);
  assert.ok(entry, 'Derivative must belong to a WAV-only source entry');
  const source = sourceView(entry).audio.find(a => a.id === copy.sourceAudioId);
  assert.ok(source && source.format === 'wav');
  assert.equal(data.assets[source.id].sha256, copy.sourceSha256);
  assert.equal(await realpath(copy.sourcePath), await realpath(byId.get(source.id).localPath));
  assert.equal(copy.verification.passed, true);
  assert.equal(copy.encoding.bitRate, 128000);
  assert.ok(Number.isFinite(copy.duration) && copy.duration > 0);
  assert.ok(Math.abs(copy.originalDuration - source.duration) < .01);
  assert.ok(Math.abs(copy.duration - source.duration) < .5, 'Derivative duration changed materially');
  const file = await realpath(copy.localPath);
  assert.ok(file.startsWith(path.join(root, 'listening-copies') + path.sep));
  assert.equal(path.basename(copy.name), copy.name);
  assert.match(copy.name, /\.listening-copy\.mp3$/);
  assert.deepEqual(await digest(file), { sha256: copy.sha256, bytes: copy.bytes });
  const id = createHash('sha256').update('sethlang-asset-v1\0listening-copy:' + source.id + ':mp3-128k-v1').digest('hex').slice(0, 32);
  assert.ok(!nextAssets[id], 'Derivative asset ID collision');
  const asset = { pathname: `archive/v1/files/${id}/${copy.name}`, name: copy.name,
    contentType: 'audio/mpeg', bytes: copy.bytes, sha256: copy.sha256 };
  nextAssets[id] = asset;
  nextPlanAssets.push({ id, localPath: file, ...asset });
  additions.push({ entry, audio: { id, name: copy.name, format: 'mp3', duration: copy.duration,
    bytes: copy.bytes, available: true, kind: 'listening-copy', derivedFromId: source.id,
    encoding: 'MP3, 128 kbps; converted from the original WAV without trimming, noise reduction or changes to playback speed' } });
}
for (const entry of data.entries) {
  const original = sourceView(entry);
  entry.audio = original.audio;
  entry.preferredAudioId = original.preferredAudioId;
  entry.limits = entry.limits.map(note => note === oldHostingNote ? newHostingNote : note);
}
for (const { entry, audio } of additions) { entry.audio.push(audio); entry.preferredAudioId = audio.id; }
assert.equal(JSON.stringify(data.entries.map(sourceView)), originalView, 'Original source, guide, transcript or association changed');
assert.ok(data.entries.every(e => !e.audio.length || e.audio.some(a => a.id === e.preferredAudioId && a.format === 'mp3')));

const methods = data.documents.find(d => d.id === 'methods-and-audit');
assert.ok(methods && methods.assets.length === 1);
methods.markdown = methods.markdown.replace(
  'Associated audio is available for playback and download in its original file format. MP3 is the preferred playback format where the entry has one;',
  'All website playback uses MP3. Original MP3s are used where available; 128 entries with only WAV originals have additional 128 kbps MP3 listening copies. Every original WAV and MP3 remains downloadable without modification;');
methods.markdown = methods.markdown.replace(
  'Audio files are provided without transcoding or editing.',
  'Original audio files are preserved byte-for-byte. The additional MP3 listening copies are lossy format conversions, clearly labelled and linked to their original WAVs; they are not AI-generated speech. Conversion preserves the full timeline without trimming, noise reduction or changes to playback speed. Decoded sample counts and waveform alignment near the beginning, middle and end are checked against each WAV. These checks concern the conversion, not the accuracy of transcript timing.');
assert.ok(methods.markdown.includes('128 kbps MP3 listening copies'));
assert.ok(!methods.markdown.includes('Audio files are provided without transcoding or editing.'));
const documentId = methods.assets[0].id;
const documentPlan = nextPlanAssets.find(a => a.id === documentId);
const documentText = methods.markdown.endsWith('\n') ? methods.markdown : methods.markdown + '\n';
const documentDigest = { bytes: Buffer.byteLength(documentText), sha256: createHash('sha256').update(documentText).digest('hex') };
Object.assign(documentPlan, documentDigest);
Object.assign(nextAssets[documentId], documentDigest);

data.assets = nextAssets;
data.generatedAt = new Date().toISOString();
assert.equal(Object.keys(data.assets).length, 1694);
assert.equal(nextPlanAssets.length, 1694);
assert.equal(data.entries.flatMap(e => e.audio).length, 605);
assert.equal(data.entries.flatMap(e => e.transcript).length, 199950);
assert.equal(data.entries.flatMap(e => e.moments).length, 2855);
for (const original of originals) assert.deepEqual(data.assets[original.id], byId.get(original.id) && Object.fromEntries(
  ['pathname', 'name', 'contentType', 'bytes', 'sha256'].map(k => [k, byId.get(original.id)[k]])));
const catalogText = JSON.stringify(data) + '\n';
assert.ok(!catalogText.includes('/Users/') && !catalogText.includes('file://'));
plan.generatedAt = data.generatedAt;
plan.assets = nextPlanAssets;
plan.catalog = { ...plan.catalog, bytes: Buffer.byteLength(catalogText), sha256: createHash('sha256').update(catalogText).digest('hex') };
async function atomic(file, text) {
  await writeFile(file + '.tmp', text, { mode: 0o600 });
  await rename(file + '.tmp', file);
}
const report = { generatedAt: data.generatedAt, originalAudioFiles: originals.length,
  listeningCopies: additions.length, bitRate: 128000, allPlaybackMp3: true,
  originalSourceGuideTranscriptAndAssociationContentPreserved: true, originalAudioAndTranscriptAssetsUnchanged: true,
  sourceEntries: data.entries.length, transcriptSegments: 199950, moments: 2855,
  totalAssets: nextPlanAssets.length, totalObjects: nextPlanAssets.length + 1,
  derivedBytes: additions.reduce((n, a) => n + a.audio.bytes, 0),
  totalStoredBytes: nextPlanAssets.reduce((n, a) => n + a.bytes, plan.catalog.bytes), catalogSha256: plan.catalog.sha256 };
if (!checkOnly) {
  await atomic(documentPlan.localPath, documentText);
  await atomic(plan.catalog.localPath, catalogText);
  await atomic(path.join(root, 'upload-plan.json'), JSON.stringify(plan) + '\n');
  await atomic(path.join(root, 'listening-copy-integration-report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ checkOnly, ...report }));
