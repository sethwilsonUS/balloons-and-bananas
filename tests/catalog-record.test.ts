import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { formatAudioAvailability, formatRecordingEntry } from '../src/components/CatalogRecord';
import { getSessionAudioStatus } from '../src/lib/sessions-browse';

test('getSessionAudioStatus classifies playable MP3, non-MP3/unavailable, and transcript-only sessions', () => {
  assert.equal(getSessionAudioStatus([]), 'none');
  assert.equal(
    getSessionAudioStatus([{ available: true, format: 'wav' }]),
    'no-mp3',
  );
  assert.equal(
    getSessionAudioStatus([{ available: false, format: 'mp3' }]),
    'no-mp3',
  );
  assert.equal(
    getSessionAudioStatus([
      { available: true, format: 'wav' },
      { available: true, format: 'MP3' },
    ]),
    'mp3',
  );
});

test('formatAudioAvailability and formatRecordingEntry return canonical glossary labels', () => {
  assert.equal(formatAudioAvailability('mp3'), 'MP3 playback available');
  assert.equal(formatAudioAvailability('no-mp3'), 'MP3 playback not yet available');
  assert.equal(formatAudioAvailability('none'), 'Transcript only');

  assert.equal(
    formatRecordingEntry({
      id: 'rec-1',
      name: '010815.mp3',
      format: 'mp3',
      duration: 36,
      bytes: 1000,
      available: true,
      kind: 'original',
    }),
    'Original MP3 · 0:36',
  );
  assert.equal(
    formatRecordingEntry({
      id: 'rec-2',
      name: '020110-listening.mp3',
      format: 'mp3',
      duration: 18,
      bytes: 1000,
      available: true,
      kind: 'listening-copy',
    }),
    'MP3 listening copy · 0:18',
  );
  assert.equal(
    formatRecordingEntry({
      id: 'rec-3',
      name: '020110.wav',
      format: 'wav',
      duration: 0,
      bytes: 1000,
      available: true,
    }),
    'Original WAV · duration unrecorded',
  );
});

test('globals.css defines modular type scale tokens, zero remote fonts, and never comma-groups vendor pseudo-elements', async () => {
  const css = await readFile(path.resolve('src/app/globals.css'), 'utf8');
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  const requiredTokens = [
    '--text-xs',
    '--text-sm',
    '--text-base',
    '--text-lg',
    '--text-xl',
    '--text-2xl',
    '--text-3xl',
    '--text-display',
    '--leading-tight',
    '--leading-snug',
    '--leading-normal',
    '--leading-reading',
    '--measure-reading',
    '--serif',
    '--sans',
    '--mono',
  ];
  for (const token of requiredTokens) {
    assert.ok(stripped.includes(`${token}:`), `Expected custom property ${token} in globals.css`);
  }

  // Zero remote fonts or @font-face/@import remote stylesheets
  assert.equal(/@font-face/i.test(stripped), false, 'globals.css must not declare @font-face');
  assert.equal(/@import\s+url\(/i.test(stripped), false, 'globals.css must not @import remote stylesheets');
  assert.equal(/https?:\/\//i.test(stripped), false, 'globals.css must not reference remote URLs');

  // Guardrail: never comma-group browser vendor pseudo-elements in one CSS selector list.
  const selectorLists = stripped.match(/[^{}@;]+(?=\{)/g) ?? [];
  for (const selectorList of selectorLists) {
    if (!selectorList.includes(',')) continue;
    const hasWebkit = /::-webkit-/.test(selectorList);
    const hasMoz = /::-moz-/.test(selectorList);
    const hasMs = /::-ms-/.test(selectorList);
    const vendorCount = Number(hasWebkit) + Number(hasMoz) + Number(hasMs);
    assert.ok(
      vendorCount <= 1,
      `Comma-grouped vendor pseudo-elements found in selector: ${selectorList.trim()}`,
    );
  }
});
