const SMALL_SEEK_SECONDS = 5;
const SHORT_CLIP_MAX_SECONDS = 15;
const SHORT_RECORDING_MAX_SECONDS = 120;
const SHORT_PAGE_SEEK_SECONDS = 10;
const LONG_PAGE_SEEK_SECONDS = 60;
const VOLUME_SMALL_STEP = 5;
const VOLUME_PAGE_STEP = 20;

function plural(value: number, singular: string): string {
  return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

/** Format a duration in seconds as spoken words for screen-reader valuetext. */
export function formatDurationWords(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  if (total === 0) return '0 seconds';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(plural(hours, 'hour'));
  if (minutes > 0) parts.push(plural(minutes, 'minute'));
  if (rest > 0) parts.push(plural(rest, 'second'));
  return parts.join(' ');
}

/** Format current playback position and total duration as words for aria-valuetext. */
export function formatPositionValueText(positionSeconds: number, durationSeconds: number): string {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.floor(durationSeconds) : 0;
  const safePosition = Number.isFinite(positionSeconds) && positionSeconds > 0 ? Math.floor(positionSeconds) : 0;
  if (safeDuration <= 0) return formatDurationWords(safePosition);
  return `${formatDurationWords(Math.min(safePosition, safeDuration))} of ${formatDurationWords(safeDuration)}`;
}

/** Predictable keyboard seek step sizes scaled to recording length. */
export function seekSteps(durationSeconds: number): { smallStep: number; pageStep: number } {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.floor(durationSeconds) : 0;
  if (safeDuration <= SHORT_CLIP_MAX_SECONDS) return { smallStep: 1, pageStep: SMALL_SEEK_SECONDS };
  if (safeDuration < SHORT_RECORDING_MAX_SECONDS) return { smallStep: SMALL_SEEK_SECONDS, pageStep: SHORT_PAGE_SEEK_SECONDS };
  return { smallStep: SMALL_SEEK_SECONDS, pageStep: LONG_PAGE_SEEK_SECONDS };
}

export function clampSeekPosition(seconds: number, maxSeconds: number): number {
  const safeMax = Number.isFinite(maxSeconds) && maxSeconds > 0 ? maxSeconds : 0;
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds, safeMax);
}

/** Compute next seek position for keyboard navigation on the seek slider, or null if unhandled. */
export function nextSeekPositionFromKey(currentSeconds: number, key: string, maxSeconds: number): number | null {
  const safeMax = Number.isFinite(maxSeconds) && maxSeconds > 0 ? Math.floor(maxSeconds) : 0;
  if (safeMax <= 0) return null;
  const base = clampSeekPosition(Math.floor(Number.isFinite(currentSeconds) ? currentSeconds : 0), safeMax);
  const { smallStep, pageStep } = seekSteps(safeMax);
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return clampSeekPosition(base + smallStep, safeMax);
    case 'ArrowLeft':
    case 'ArrowDown':
      return clampSeekPosition(base - smallStep, safeMax);
    case 'PageUp':
      return clampSeekPosition(base + pageStep, safeMax);
    case 'PageDown':
      return clampSeekPosition(base - pageStep, safeMax);
    case 'Home':
      return 0;
    case 'End':
      return safeMax;
    default:
      return null;
  }
}

export function clampVolumePercent(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

export function formatVolumeValueText(volumePercent: number, muted: boolean): string {
  const clamped = clampVolumePercent(volumePercent);
  if (muted || clamped === 0) return 'Muted, 0 percent';
  return `${clamped} percent`;
}

/** Compute next volume percentage (0-100) for keyboard navigation, or null if unhandled. */
export function nextVolumeFromKey(currentPercent: number, key: string): number | null {
  const base = clampVolumePercent(currentPercent);
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return clampVolumePercent(base + VOLUME_SMALL_STEP);
    case 'ArrowLeft':
    case 'ArrowDown':
      return clampVolumePercent(base - VOLUME_SMALL_STEP);
    case 'PageUp':
      return clampVolumePercent(base + VOLUME_PAGE_STEP);
    case 'PageDown':
      return clampVolumePercent(base - VOLUME_PAGE_STEP);
    case 'Home':
      return 0;
    case 'End':
      return 100;
    default:
      return null;
  }
}
