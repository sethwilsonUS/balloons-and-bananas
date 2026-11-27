import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeArchiveEvent } from '../src/lib/analytics-policy';
import {
  clampSeekPosition,
  formatDurationWords,
  formatPositionValueText,
  formatVolumeValueText,
  nextSeekPositionFromKey,
  nextVolumeFromKey,
  seekSteps,
} from '../src/lib/audio-player';

test('formatDurationWords formats zero, singular/plural units, and hours/minutes/seconds cleanly', () => {
  assert.equal(formatDurationWords(0), '0 seconds');
  assert.equal(formatDurationWords(-4), '0 seconds');
  assert.equal(formatDurationWords(Number.NaN), '0 seconds');
  assert.equal(formatDurationWords(1), '1 second');
  assert.equal(formatDurationWords(1.9), '1 second');
  assert.equal(formatDurationWords(12), '12 seconds');
  assert.equal(formatDurationWords(60), '1 minute');
  assert.equal(formatDurationWords(61), '1 minute 1 second');
  assert.equal(formatDurationWords(120), '2 minutes');
  assert.equal(formatDurationWords(4 * 60 + 12), '4 minutes 12 seconds');
  assert.equal(formatDurationWords(31 * 60 + 41), '31 minutes 41 seconds');
  assert.equal(formatDurationWords(3600), '1 hour');
  assert.equal(formatDurationWords(3601), '1 hour 1 second');
  assert.equal(formatDurationWords(3660), '1 hour 1 minute');
  assert.equal(formatDurationWords(3661), '1 hour 1 minute 1 second');
  assert.equal(formatDurationWords(2 * 3600 + 2 * 60 + 5), '2 hours 2 minutes 5 seconds');
});

test('formatPositionValueText announces position and duration in words and clamps cleanly', () => {
  assert.equal(
    formatPositionValueText(4 * 60 + 12, 31 * 60 + 41),
    '4 minutes 12 seconds of 31 minutes 41 seconds',
  );
  assert.equal(formatPositionValueText(0, 36), '0 seconds of 36 seconds');
  assert.equal(formatPositionValueText(1, 1), '1 second of 1 second');
  assert.equal(formatPositionValueText(50, 36), '36 seconds of 36 seconds');
  assert.equal(formatPositionValueText(3661, 4500), '1 hour 1 minute 1 second of 1 hour 15 minutes');
  assert.equal(formatPositionValueText(12, 0), '12 seconds');
});

test('seek keyboard stepping handles Arrow, PageUp/PageDown, Home/End across clip lengths', () => {
  assert.deepEqual(seekSteps(12), { smallStep: 1, pageStep: 5 });
  assert.deepEqual(seekSteps(36), { smallStep: 5, pageStep: 10 });
  assert.deepEqual(seekSteps(1901), { smallStep: 5, pageStep: 60 });

  assert.equal(nextSeekPositionFromKey(0, 'ArrowRight', 36), 5);
  assert.equal(nextSeekPositionFromKey(5, 'ArrowUp', 36), 10);
  assert.equal(nextSeekPositionFromKey(10, 'ArrowLeft', 36), 5);
  assert.equal(nextSeekPositionFromKey(5, 'ArrowDown', 36), 0);
  assert.equal(nextSeekPositionFromKey(0, 'ArrowLeft', 36), 0);
  assert.equal(nextSeekPositionFromKey(0, 'PageUp', 36), 10);
  assert.equal(nextSeekPositionFromKey(20, 'PageDown', 36), 10);
  assert.equal(nextSeekPositionFromKey(12, 'Home', 36), 0);
  assert.equal(nextSeekPositionFromKey(12, 'End', 36), 36);
  assert.equal(nextSeekPositionFromKey(12, 'Tab', 36), null);
  assert.equal(nextSeekPositionFromKey(12, 'Enter', 36), null);

  // Longer archive recording uses 1-minute PageUp/PageDown jumps
  assert.equal(nextSeekPositionFromKey(252, 'PageUp', 1901), 312);
  assert.equal(nextSeekPositionFromKey(252, 'PageDown', 1901), 192);
  assert.equal(clampSeekPosition(9999, 1901), 1901);
  assert.equal(clampSeekPosition(-5, 1901), 0);
});

test('volume formatting and keyboard stepping handle mute, bounds, and page jumps', () => {
  assert.equal(formatVolumeValueText(100, false), '100 percent');
  assert.equal(formatVolumeValueText(65, false), '65 percent');
  assert.equal(formatVolumeValueText(65, true), 'Muted, 0 percent');
  assert.equal(formatVolumeValueText(0, false), 'Muted, 0 percent');

  assert.equal(nextVolumeFromKey(100, 'ArrowLeft'), 95);
  assert.equal(nextVolumeFromKey(95, 'ArrowDown'), 90);
  assert.equal(nextVolumeFromKey(90, 'ArrowRight'), 95);
  assert.equal(nextVolumeFromKey(95, 'ArrowUp'), 100);
  assert.equal(nextVolumeFromKey(100, 'PageDown'), 80);
  assert.equal(nextVolumeFromKey(80, 'PageUp'), 100);
  assert.equal(nextVolumeFromKey(80, 'Home'), 0);
  assert.equal(nextVolumeFromKey(0, 'End'), 100);
  assert.equal(nextVolumeFromKey(50, 'Tab'), null);
});

test('audio_seek telemetry contract remains unchanged for custom scrubber (seekSource: native)', () => {
  const sanitized = sanitizeArchiveEvent('audio_seek', {
    recordingId: 'archive-010815',
    origin: 'archived_research',
    audioId: 'a'.repeat(32),
    seekSource: 'native',
  });
  assert.deepEqual(sanitized, {
    name: 'audio_seek',
    properties: {
      recordingId: 'archive-010815',
      seekSource: 'native',
      origin: 'archived_research',
      audioId: 'a'.repeat(32),
    },
  });
});
