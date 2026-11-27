export interface PlaybackSample { now: number; position: number; rate: number }
export type PlaybackEvent = { type: 'start' | 'resume' | 'pause' | 'end' } | { type: 'milestone'; seconds: 30 | 120 | 600 | 1800 };
const MILESTONES = [30, 120, 600, 1800] as const;

/** Bounded playback-session observations; no DOM, network or source content. */
export class PlaybackTelemetry {
  private anchor: PlaybackSample | null = null;
  private started = false;
  private paused = false;
  private ended = false;
  private listened = 0;
  private milestones = new Set<number>();

  playing(sample: PlaybackSample): PlaybackEvent[] {
    if (!this.valid(sample)) return [];
    // Replaying a finished recording begins a new listening session.
    if (this.ended) {
      this.started = false;
      this.ended = false;
      this.listened = 0;
      this.milestones.clear();
    }
    const event: PlaybackEvent | undefined = !this.started ? { type: 'start' } : this.paused ? { type: 'resume' } : undefined;
    this.started = true;
    this.paused = false;
    this.anchor = this.valid(sample) ? sample : null;
    return event ? [event] : [];
  }

  sample(sample: PlaybackSample): PlaybackEvent[] {
    if (!this.anchor || !this.valid(sample)) return [];
    const previous = this.anchor;
    this.anchor = sample;
    const wall = sample.now - previous.now;
    const media = sample.position - previous.position;
    // An unexplained media jump is conservatively treated as a seek. Even a
    // plausible advance is capped by real elapsed time and the prior speed.
    if (wall <= 0 || media <= 0 || media > wall / 1000 * previous.rate * 1.5 + 0.5) return [];
    this.listened += Math.min(wall, media / previous.rate * 1000);
    const events: PlaybackEvent[] = [];
    for (const seconds of MILESTONES) {
      if (this.listened >= seconds * 1000 && !this.milestones.has(seconds)) {
        this.milestones.add(seconds);
        events.push({ type: 'milestone', seconds });
      }
    }
    return events;
  }

  pause(sample: PlaybackSample): PlaybackEvent[] {
    const events = this.sample(sample);
    this.anchor = null;
    if (this.started && !this.paused && !this.ended) {
      this.paused = true;
      events.push({ type: 'pause' });
    }
    return events;
  }

  end(sample: PlaybackSample): PlaybackEvent[] {
    const events = this.sample(sample);
    this.anchor = null;
    if (this.started && !this.ended) {
      this.ended = true;
      this.paused = false;
      events.push({ type: 'end' });
    }
    return events;
  }

  // Buffering, seeks, signed-URL replacement and unmount are not user pauses.
  suspend() { this.anchor = null; }
  reanchor(sample: PlaybackSample) {
    if (this.started && !this.paused && !this.ended && this.valid(sample)) this.anchor = sample;
  }

  private valid(sample: PlaybackSample) {
    return Number.isFinite(sample.now) && Number.isFinite(sample.position) && sample.position >= 0 && Number.isFinite(sample.rate) && sample.rate > 0;
  }
}
