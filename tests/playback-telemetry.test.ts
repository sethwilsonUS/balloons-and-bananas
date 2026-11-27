import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackTelemetry } from '../src/lib/playback-telemetry';

const sample = (now: number, position: number, rate = 1) => ({ now, position, rate });

test('actual playing starts once; user pause/resume and natural end are deduplicated', () => {
  const tracker = new PlaybackTelemetry();
  assert.deepEqual(tracker.sample(sample(0, 0)), []);
  assert.deepEqual(tracker.playing(sample(0, 0)), [{ type: 'start' }]);
  assert.deepEqual(tracker.playing(sample(1, 0)), []);
  assert.deepEqual(tracker.pause(sample(1001, 1)), [{ type: 'pause' }]);
  assert.deepEqual(tracker.pause(sample(1002, 1)), []);
  assert.deepEqual(tracker.playing(sample(5000, 1)), [{ type: 'resume' }]);
  assert.deepEqual(tracker.end(sample(6000, 2)), [{ type: 'end' }]);
  assert.deepEqual(tracker.pause(sample(6001, 2)), []);
  assert.deepEqual(tracker.end(sample(6002, 2)), []);
  assert.deepEqual(tracker.playing(sample(7000, 0)), [{ type: 'start' }]);
});

test('milestones measure elapsed listening, not seek position or faster playback content duration', () => {
  const tracker = new PlaybackTelemetry();
  tracker.playing(sample(0, 0, 2));
  assert.deepEqual(tracker.sample(sample(15000, 30, 2)), []);
  assert.deepEqual(tracker.sample(sample(30000, 60, 2)), [{ type: 'milestone', seconds: 30 }]);
  tracker.suspend();
  tracker.reanchor(sample(31000, 1800, 2));
  assert.deepEqual(tracker.sample(sample(32000, 1802, 2)), []);
  assert.deepEqual(tracker.sample(sample(121000, 1980, 2)), [{ type: 'milestone', seconds: 120 }]);
  assert.deepEqual(tracker.sample(sample(122000, 1982, 2)), []);
});

test('buffering, reloads, cleanup and stalled media do not count as listening or user resumes', () => {
  const tracker = new PlaybackTelemetry();
  tracker.playing(sample(0, 0));
  assert.deepEqual(tracker.sample(sample(20000, 10)), []);
  tracker.suspend();
  assert.deepEqual(tracker.sample(sample(90000, 10)), []);
  assert.deepEqual(tracker.playing(sample(100000, 10)), []);
  assert.deepEqual(tracker.sample(sample(119000, 29)), []);
  assert.deepEqual(tracker.sample(sample(120000, 30)), [{ type: 'milestone', seconds: 30 }]);
  tracker.suspend();
  assert.deepEqual(tracker.sample(sample(180000, 1800)), []);
});

test('unexpected jumps and invalid samples cannot inflate milestones', () => {
  const tracker = new PlaybackTelemetry();
  tracker.playing(sample(0, 0));
  assert.deepEqual(tracker.sample(sample(1000, 3000)), []);
  assert.deepEqual(tracker.sample(sample(2000, 1)), []);
  assert.deepEqual(tracker.sample(sample(NaN, 100)), []);
  assert.deepEqual(tracker.sample(sample(3000, 2, 0)), []);
  assert.deepEqual(tracker.sample(sample(31000, 30)), []);
  assert.deepEqual(tracker.sample(sample(32000, 31)), [{ type: 'milestone', seconds: 30 }]);
});
