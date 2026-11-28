'use client';

import { type CSSProperties, type KeyboardEvent, forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Download, Headphones, Pause, Play, RotateCcw, RotateCw, Volume1, Volume2, VolumeX } from 'lucide-react';
import type { Recording, TranscriptOrigin } from '../lib/types';
import { trackArchiveEvent } from '../lib/analytics';
import {
  clampSeekPosition,
  clampVolumePercent,
  formatDurationWords,
  formatPositionValueText,
  formatVolumeValueText,
  nextSeekPositionFromKey,
  nextVolumeFromKey,
  seekSteps,
} from '../lib/audio-player';
import { PlaybackTelemetry, type PlaybackEvent } from '../lib/playback-telemetry';
import { request, timeLabel } from './api';

export type PrepareAudioResult =
  | { status: 'ready'; seconds: number }
  | { status: 'no-audio' }
  | { status: 'out-of-range'; duration: number };

export interface RecordingAudioHandle {
  playAt: (seconds: number) => void;
  prepareAt: (seconds: number) => PrepareAudioResult;
  toggle: () => void;
}
interface Props {
  sessionId: string;
  origin: TranscriptOrigin;
  recordings: Recording[];
  preferredRecordingId: string | null;
  onTime: (seconds: number) => void;
  onPlaying: (playing: boolean) => void;
  headingLevel?: 2 | 3;
}
type SignedRecording = { url: string; expiresAt: number; recordingId: string; generation: number };
type ScrubIntent = { fromScrub: true; toEnd: boolean; target: number; reportSeek: boolean };
type SeekSource = 'native' | 'back' | 'forward' | 'passage';
type AudioEvent = 'audio_start' | 'audio_resume' | 'audio_pause' | 'audio_end' | 'audio_listen_milestone' | 'audio_seek' | 'audio_rate' | 'audio_file_change' | 'audio_error' | 'audio_download';
const rateBucket = (rate: number) => rate < 1 ? 'slow' : rate > 1 ? 'fast' : 'normal';
const playbackSample = (player: HTMLAudioElement) => ({ now: performance.now(), position: player.currentTime, rate: player.playbackRate });

function releaseMedia(player: HTMLAudioElement | null) {
  if (!player) return;
  player.pause();
  player.removeAttribute('src');
  player.load();
}

const RecordingAudio = forwardRef<RecordingAudioHandle, Props>(function RecordingAudio({ sessionId, origin, recordings, preferredRecordingId, onTime, onPlaying, headingLevel = 3 }, ref) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const playableRecordings = recordings.filter(recording => recording.format.toLowerCase() === 'mp3');
  const originalWavs = recordings.filter(recording => recording.format.toLowerCase() === 'wav' && recording.kind !== 'listening-copy');
  const initial = playableRecordings.find(recording => recording.id === preferredRecordingId && recording.available)
    || playableRecordings.find(recording => recording.available && recording.kind !== 'listening-copy')
    || playableRecordings.find(recording => recording.available) || playableRecordings[0];
  const [selectedId, setSelectedId] = useState(initial?.id || '');
  const [source, setSource] = useState<SignedRecording | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<{ recordingId: string; seconds: number } | null>(null);
  const [speed, setSpeed] = useState(1);
  const [volumeLevel, setVolumeLevel] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [volumeSupported, setVolumeSupported] = useState(true);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const generation = useRef(0);
  const pending = useRef<{ at: number; play: boolean; generation: number; fromScrub?: boolean; toEnd?: boolean; reportSeek?: boolean } | null>(null);
  const retryScrubIntent = useRef<ScrubIntent | null>(null);
  const controller = useRef<AbortController | null>(null);
  const loading = useRef(false);
  const recoveryTried = useRef(false);
  const lastPosition = useRef(0);
  const volume = useRef(1);
  const lastNonZeroVolume = useRef(1);
  const muted = useRef(false);
  const preferredSpeed = useRef(1);
  const telemetry = useRef({ recordingId: initial?.id || '', tracker: new PlaybackTelemetry() });
  const reportedErrors = useRef(new Set<string>());
  const programmedSeek = useRef<{ generation: number; target: number; when: number } | null>(null);
  const nativeSeek = useRef(false);
  const seekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected = playableRecordings.find(recording => recording.id === selectedId);
  const available = playableRecordings.filter(recording => recording.available);
  const originalRecording = recordings.find(recording => recording.id === selected?.derivedFromId && recording.kind !== 'listening-copy');

  const selectedMediaDuration = mediaDuration && selected && mediaDuration.recordingId === selected.id
    ? mediaDuration.seconds
    : null;
  const effectiveDuration = selectedMediaDuration !== null && Number.isFinite(selectedMediaDuration) && selectedMediaDuration > 0
    ? selectedMediaDuration
    : (selected?.duration || 0);
  const sliderMax = Math.max(0, Math.floor(effectiveDuration));
  const sliderValue = sliderMax > 0 ? Math.min(sliderMax, Math.max(0, Math.floor(position))) : 0;
  const seekPercent = sliderMax > 0 ? Math.min(100, Math.max(0, (sliderValue / sliderMax) * 100)) : 0;
  const seekValueText = formatPositionValueText(sliderValue, sliderMax);
  const { smallStep, pageStep } = seekSteps(sliderMax);
  const effectiveMuted = isMuted || volumeLevel <= 0;
  const effectiveVolumePercent = effectiveMuted ? 0 : clampVolumePercent(volumeLevel * 100);
  const volumeValueText = formatVolumeValueText(effectiveVolumePercent, effectiveMuted);

  const report = useCallback((name: AudioEvent, audioRecordingId: string, properties: Record<string, string | number | boolean> = {}) => {
    if (!recordings.some(recording => recording.id === audioRecordingId)) return;
    // Analytics wire properties stay `recordingId` (the session ID) and `audioId` (the recording ID).
    trackArchiveEvent(name, { recordingId: sessionId, origin, audioId: audioRecordingId, ...properties });
  }, [origin, recordings, sessionId]);
  const observe = useCallback((events: PlaybackEvent[], audioRecordingId: string) => {
    for (const event of events) {
      if (event.type === 'milestone') report('audio_listen_milestone', audioRecordingId, { milestoneSeconds: event.seconds });
      else report(`audio_${event.type}`, audioRecordingId);
    }
  }, [report]);
  const reportError = useCallback((audioRecordingId: string, errorCode: 'load' | 'play' | 'aborted' | 'network' | 'decode' | 'unsupported') => {
    const key = `${audioRecordingId}:${generation.current}:${errorCode}`;
    if (reportedErrors.current.has(key)) return;
    reportedErrors.current.add(key);
    report('audio_error', audioRecordingId, { errorCode });
  }, [report]);
  const selectTelemetry = useCallback((audioRecordingId: string) => {
    if (telemetry.current.recordingId === audioRecordingId) return;
    if (telemetry.current.recordingId) report('audio_file_change', audioRecordingId);
    telemetry.current = { recordingId: audioRecordingId, tracker: new PlaybackTelemetry() };
  }, [report]);
  const scheduleScrubSeek = useCallback((audioRecordingId: string) => {
    if (seekTimer.current) clearTimeout(seekTimer.current);
    const seekGeneration = generation.current;
    seekTimer.current = setTimeout(() => {
      seekTimer.current = null;
      if (generation.current === seekGeneration) report('audio_seek', audioRecordingId, { seekSource: 'native' });
    }, 350);
  }, [report]);

  useEffect(() => () => {
    generation.current += 1;
    controller.current?.abort();
    telemetry.current.tracker.suspend();
    if (seekTimer.current) clearTimeout(seekTimer.current);
  }, []);

  // Probe whether this platform permits programmatic volume changes (iOS keeps volume read-only at 1).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const probe = document.createElement('audio');
    try {
      probe.volume = 0.5;
      setVolumeSupported(Math.abs(probe.volume - 0.5) < 0.05);
    } catch {
      setVolumeSupported(false);
    }
  }, []);

  // Capture each keyed element: React may clear the ref before unmount cleanup.
  useEffect(() => {
    const player = audio.current;
    return () => releaseMedia(player);
  }, [source]);

  const playLoaded = useCallback(async () => {
    const player = audio.current;
    const activeGeneration = generation.current;
    try { await player?.play(); }
    catch {
      if (activeGeneration === generation.current && player === audio.current) {
        reportError(telemetry.current.recordingId, 'play');
        setMessage('The audio is ready. Press play in the audio controls to listen.');
      }
    }
  }, [reportError]);

  const load = useCallback(async (recording: Recording, at: number, shouldPlay: boolean, options?: ScrubIntent) => {
    if (!recording.available || recording.format.toLowerCase() !== 'mp3') return;
    telemetry.current.tracker.suspend();
    selectTelemetry(recording.id);
    if (seekTimer.current) {
      clearTimeout(seekTimer.current);
      seekTimer.current = null;
    }
    const nextGeneration = ++generation.current;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    loading.current = true;
    const scrubIntent: ScrubIntent | null = options?.fromScrub
      ? { fromScrub: true, toEnd: Boolean(options.toEnd), target: at, reportSeek: Boolean(options.reportSeek) }
      : null;
    retryScrubIntent.current = scrubIntent;
    pending.current = {
      at,
      play: shouldPlay,
      generation: nextGeneration,
      fromScrub: scrubIntent?.fromScrub,
      toEnd: scrubIntent?.toEnd,
      reportSeek: scrubIntent?.reportSeek,
    };
    releaseMedia(audio.current);
    setSource(null);
    setPlaying(false);
    onPlaying(false);
    setBusy(true);
    setFailed(false);
    setMessage('');
    setSelectedId(recording.id);
    try {
      const signed = await request<{ url: string; expiresAt: number }>(`/api/assets/${encodeURIComponent(recording.id)}?json=1`, { signal: next.signal });
      if (next.signal.aborted || generation.current !== nextGeneration) return;
      setSource({ ...signed, recordingId: recording.id, generation: nextGeneration });
    } catch (error) {
      if (next.signal.aborted || generation.current !== nextGeneration) return;
      pending.current = null;
      loading.current = false;
      setBusy(false);
      setFailed(true);
      reportError(recording.id, 'load');
      setMessage(error instanceof Error ? error.message : 'The recording could not be loaded. Please try again.');
    }
  }, [onPlaying, reportError, selectTelemetry]);

  useEffect(() => { if (source) audio.current?.load(); }, [source]);

  const hasLoadedSelected = useCallback((player: HTMLAudioElement | null): player is HTMLAudioElement => Boolean(
    selected?.available
    && source?.recordingId === selected.id
    && Date.now() < source.expiresAt - 15_000
    && player
    && player.readyState >= 1
    && !failed,
  ), [failed, selected, source]);

  const seek = useCallback((seconds: number, shouldPlay = true, seekSource?: SeekSource) => {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    const player = audio.current;
    const isLoadedSelected = hasLoadedSelected(player);
    const loadedAccepts = isLoadedSelected && Number.isFinite(player.duration) && seconds < player.duration;
    let recording = selected;
    if (!loadedAccepts && (!recording?.available || (recording.duration > 0 && seconds >= recording.duration))) {
      recording = available.find(item => item.duration > seconds);
    }
    if (!recording) {
      setMessage('This timestamp falls beyond the available recording. The transcript and source locator are still available below.');
      return;
    }
    recoveryTried.current = false;
    retryScrubIntent.current = null;
    if (isLoadedSelected && recording.id === selected!.id) {
      if (Number.isFinite(player.duration) && seconds >= player.duration) {
        setMessage('This timestamp falls beyond this recording. Please choose another recording.');
        return;
      }
      if (seekSource) report('audio_seek', recording.id, { seekSource });
      telemetry.current.tracker.suspend();
      programmedSeek.current = { generation: generation.current, target: seconds, when: performance.now() };
      player.currentTime = seconds;
      lastPosition.current = seconds;
      setPosition(seconds);
      onTime(seconds);
      if (shouldPlay) void playLoaded();
      setMessage('');
    } else {
      if (seekSource) report('audio_seek', recording.id, { seekSource });
      void load(recording, seconds, shouldPlay);
    }
  }, [available, hasLoadedSelected, load, onTime, playLoaded, report, selected]);

  const scrubTo = useCallback((rawSeconds: number) => {
    if (!selected?.available || !Number.isFinite(rawSeconds) || sliderMax <= 0) return;
    const clamped = clampSeekPosition(rawSeconds, sliderMax);
    const toEnd = clamped >= sliderMax;
    const player = audio.current;
    if (hasLoadedSelected(player)) {
      const mediaMax = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : clamped;
      const mediaTarget = toEnd ? mediaMax : Math.min(clamped, mediaMax);
      if (Math.abs(player.currentTime - mediaTarget) < 0.05 && Math.abs(lastPosition.current - mediaTarget) < 0.05) return;
      recoveryTried.current = false;
      retryScrubIntent.current = null;
      setMessage('');
      telemetry.current.tracker.suspend();
      programmedSeek.current = { generation: generation.current, target: mediaTarget, when: performance.now() };
      player.currentTime = mediaTarget;
      lastPosition.current = mediaTarget;
      setPosition(mediaTarget);
      onTime(mediaTarget);
      scheduleScrubSeek(selected.id);
      return;
    }
    if (loading.current && pending.current && pending.current.generation === generation.current) {
      if (
        Math.abs(pending.current.at - clamped) < 0.05
        && Boolean(pending.current.fromScrub)
        && Boolean(pending.current.toEnd) === toEnd
      ) {
        return;
      }
      recoveryTried.current = false;
      setMessage('');
      const intent: ScrubIntent = { fromScrub: true, toEnd, target: clamped, reportSeek: true };
      retryScrubIntent.current = intent;
      pending.current = { ...pending.current, at: clamped, fromScrub: true, toEnd, reportSeek: true };
      lastPosition.current = clamped;
      setPosition(clamped);
      onTime(clamped);
      return;
    }
    if (playing && source && Date.now() >= source.expiresAt - 15_000) {
      recoveryTried.current = false;
      setMessage('');
      const intent: ScrubIntent = { fromScrub: true, toEnd, target: clamped, reportSeek: true };
      retryScrubIntent.current = intent;
      lastPosition.current = clamped;
      setPosition(clamped);
      onTime(clamped);
      void load(selected, clamped, true, intent);
      return;
    }
    const currentTarget = retryScrubIntent.current ? retryScrubIntent.current.target : lastPosition.current;
    const samePosition = Math.abs(currentTarget - clamped) < 0.05;
    const sameIntent = Boolean(retryScrubIntent.current?.fromScrub) && Boolean(retryScrubIntent.current?.toEnd) === toEnd;
    if (samePosition && (sameIntent || (!retryScrubIntent.current && !toEnd))) return;
    recoveryTried.current = false;
    setMessage('');
    retryScrubIntent.current = { fromScrub: true, toEnd, target: clamped, reportSeek: true };
    lastPosition.current = clamped;
    setPosition(clamped);
    onTime(clamped);
  }, [hasLoadedSelected, load, onTime, playing, scheduleScrubSeek, selected, sliderMax, source]);

  const handleSeekKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = nextSeekPositionFromKey(sliderValue, event.key, sliderMax);
    if (next === null) return;
    event.preventDefault();
    scrubTo(next);
  }, [scrubTo, sliderMax, sliderValue]);

  const applyVolume = useCallback((nextPercent: number) => {
    const clamped = clampVolumePercent(nextPercent);
    const nextVolume = clamped / 100;
    const nextMuted = clamped === 0;
    if (audio.current) {
      audio.current.muted = nextMuted;
      if (!nextMuted) {
        audio.current.volume = nextVolume;
        if (Math.abs(audio.current.volume - nextVolume) > 0.05) {
          volume.current = audio.current.volume;
          muted.current = false;
          setVolumeSupported(false);
          setVolumeLevel(audio.current.volume);
          setIsMuted(false);
          return;
        }
      } else {
        audio.current.volume = 0;
      }
    }
    if (nextVolume > 0) lastNonZeroVolume.current = nextVolume;
    volume.current = nextVolume;
    muted.current = nextMuted;
    setVolumeLevel(nextVolume);
    setIsMuted(nextMuted);
  }, []);

  const toggleMute = useCallback(() => {
    if (!effectiveMuted) {
      if (volumeLevel > 0) lastNonZeroVolume.current = volumeLevel;
      muted.current = true;
      setIsMuted(true);
      if (audio.current) audio.current.muted = true;
      return;
    }
    const restored = volumeSupported && lastNonZeroVolume.current > 0 ? lastNonZeroVolume.current : 1;
    volume.current = restored;
    muted.current = false;
    setVolumeLevel(restored);
    setIsMuted(false);
    if (audio.current) {
      if (volumeSupported) audio.current.volume = restored;
      audio.current.muted = false;
    }
  }, [effectiveMuted, volumeLevel, volumeSupported]);

  const handleVolumeKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = nextVolumeFromKey(effectiveVolumePercent, event.key);
    if (next === null) return;
    event.preventDefault();
    applyVolume(next);
  }, [applyVolume, effectiveVolumePercent]);

  const toggle = useCallback(() => {
    if (busy) return;
    if (playing) {
      audio.current?.pause();
      return;
    }
    if (!selected?.available) return;
    const player = audio.current;
    const loaded = hasLoadedSelected(player);
    const retainedScrub = !loaded ? retryScrubIntent.current : null;
    const loadedDuration = loaded && Number.isFinite(player.duration) && player.duration > 0 ? player.duration : null;
    const atEnd = retainedScrub
      ? retainedScrub.toEnd
      : Boolean(player?.ended)
        || (loadedDuration !== null
          ? lastPosition.current >= loadedDuration - 0.05
          : effectiveDuration > 0 && lastPosition.current >= effectiveDuration - 0.05);
    const target = atEnd ? 0 : (retainedScrub ? retainedScrub.target : lastPosition.current);
    const scrubIntent = atEnd ? undefined : (retainedScrub ?? undefined);
    recoveryTried.current = false;
    setMessage('');
    if (loaded) {
      retryScrubIntent.current = null;
      if (atEnd || Math.abs(player.currentTime - target) > 0.05) {
        telemetry.current.tracker.suspend();
        programmedSeek.current = { generation: generation.current, target, when: performance.now() };
        player.currentTime = target;
        lastPosition.current = target;
        setPosition(target);
        onTime(target);
      }
      void playLoaded();
      return;
    }
    if (atEnd) {
      retryScrubIntent.current = null;
      lastPosition.current = 0;
      setPosition(0);
      onTime(0);
    }
    void load(selected, target, true, scrubIntent);
  }, [busy, effectiveDuration, hasLoadedSelected, load, onTime, playLoaded, playing, selected]);

  const prepareAt = useCallback((seconds: number): PrepareAudioResult => {
    if (!available.length) {
      return { status: 'no-audio' };
    }
    const player = audio.current;
    const isLoadedSelected = hasLoadedSelected(player);
    const loadedDuration = isLoadedSelected && Number.isFinite(player.duration) && player.duration > 0
      ? player.duration
      : null;
    const maxKnownDuration = Math.max(
      loadedDuration ?? 0,
      ...available.map(item => (Number.isFinite(item.duration) && item.duration > 0 ? item.duration : 0)),
    );
    if (!Number.isFinite(seconds) || seconds < 0) {
      return { status: 'out-of-range', duration: maxKnownDuration };
    }

    const selectedDuration = loadedDuration ?? (selected?.duration || 0);
    let recording = selected;
    if (!recording?.available || (selectedDuration > 0 && seconds >= selectedDuration)) {
      recording = available.find(item => item.duration <= 0 || seconds < item.duration);
    }
    if (!recording) {
      return { status: 'out-of-range', duration: maxKnownDuration };
    }

    recoveryTried.current = false;
    retryScrubIntent.current = null;
    setMessage('');

    if (isLoadedSelected && recording.id === selected!.id) {
      if (!player.paused) {
        player.pause();
      }
      telemetry.current.tracker.suspend();
      programmedSeek.current = { generation: generation.current, target: seconds, when: performance.now() };
      player.currentTime = seconds;
      lastPosition.current = seconds;
      setPosition(seconds);
      onTime(seconds);
      return { status: 'ready', seconds };
    }

    if (loading.current && pending.current && pending.current.generation === generation.current && recording.id === selected?.id) {
      pending.current = {
        ...pending.current,
        at: seconds,
        play: false,
        fromScrub: false,
        toEnd: false,
        reportSeek: false,
      };
      lastPosition.current = seconds;
      setPosition(seconds);
      onTime(seconds);
      return { status: 'ready', seconds };
    }

    if (recording.id !== selected?.id) {
      telemetry.current.tracker.suspend();
      selectTelemetry(recording.id);
      if (seekTimer.current) {
        clearTimeout(seekTimer.current);
        seekTimer.current = null;
      }
      generation.current += 1;
      controller.current?.abort();
      loading.current = false;
      pending.current = null;
      releaseMedia(audio.current);
      setPlaying(false);
      onPlaying(false);
      setSelectedId(recording.id);
      setSource(null);
      setMediaDuration(null);
      setBusy(false);
      setFailed(false);
    }

    lastPosition.current = seconds;
    setPosition(seconds);
    onTime(seconds);
    return { status: 'ready', seconds };
  }, [available, hasLoadedSelected, onPlaying, onTime, selectTelemetry, selected]);

  useImperativeHandle(
    ref,
    () => ({ playAt: seconds => seek(seconds, true, 'passage'), prepareAt, toggle }),
    [prepareAt, seek, toggle],
  );

  // Refresh only an actively playing URL, once near expiry; idle pages do not poll.
  useEffect(() => {
    if (!source || !playing || !selected?.available) return;
    const timeout = window.setTimeout(() => {
      void load(selected, lastPosition.current, true);
    }, Math.max(0, source.expiresAt - Date.now() - 30_000));
    return () => window.clearTimeout(timeout);
  }, [load, playing, selected, source]);

  const isCurrentMedia = (player: HTMLAudioElement) => player === audio.current
    && source !== null && source.generation === generation.current;

  const onLoaded = (player: HTMLAudioElement) => {
    if (!isCurrentMedia(player)) return;
    const next = pending.current;
    if (next && next.generation !== generation.current) return;
    if (Number.isFinite(player.duration) && player.duration > 0) {
      setMediaDuration({ recordingId: source!.recordingId, seconds: player.duration });
    }
    player.playbackRate = preferredSpeed.current;
    player.volume = volume.current;
    player.muted = muted.current;
    loading.current = false;
    setBusy(false);
    if (!next) return;
    pending.current = null;
    retryScrubIntent.current = null;
    let target = next.at;
    if (next.fromScrub) {
      if (Number.isFinite(player.duration) && player.duration > 0) {
        target = next.toEnd ? player.duration : Math.min(next.at, player.duration);
      }
    } else if (Number.isFinite(player.duration) && next.at >= player.duration) {
      setMessage('This timestamp falls beyond the loaded recording. Please choose another recording.');
      return;
    }
    programmedSeek.current = { generation: generation.current, target, when: performance.now() };
    player.currentTime = target;
    lastPosition.current = target;
    setPosition(target);
    onTime(target);
    if (next.reportSeek) scheduleScrubSeek(source!.recordingId);
    if (next.play) void playLoaded();
  };

  return <section className="audio-panel" aria-labelledby="listen-heading">
    <div className="section-label"><Headphones size={18} aria-hidden="true" /><Heading id="listen-heading">Listen to the recording</Heading></div>
    {!recordings.length ? <p>The archive has a transcript for this session, but no corresponding recording.</p> : <>
      {playableRecordings.length > 0 && <div className="field audio-file-choice"><label htmlFor="recording-select">MP3 recording</label><select id="recording-select" value={selectedId} disabled={!available.length} onChange={event => {
        telemetry.current.tracker.suspend();
        selectTelemetry(event.target.value);
        if (seekTimer.current) {
          clearTimeout(seekTimer.current);
          seekTimer.current = null;
        }
        generation.current += 1;
        controller.current?.abort();
        loading.current = false;
        pending.current = null;
        retryScrubIntent.current = null;
        recoveryTried.current = false;
        releaseMedia(audio.current);
        setPlaying(false);
        onPlaying(false);
        setSelectedId(event.target.value);
        setSource(null);
        setMediaDuration(null);
        setBusy(false);
        setFailed(false);
        lastPosition.current = 0;
        setPosition(0);
        onTime(0);
        setMessage('');
      }}>{playableRecordings.map(recording => <option key={recording.id} value={recording.id} disabled={!recording.available}>{recording.name} · {recording.kind === 'listening-copy' ? 'MP3 listening copy' : 'Original MP3'} · {timeLabel(recording.duration)}{!recording.available ? ' · Not yet available' : ''}</option>)}</select></div>}
      {selected && <p className="small muted audio-provenance">{selected.kind === 'listening-copy' ? <><strong>MP3 listening copy.</strong> Converted from{originalRecording ? <> <span className="audio-filename">{originalRecording.name}</span></> : ' the original WAV'} for playback. The original WAV is preserved.{selected.encoding ? ` Encoding: ${selected.encoding}.` : ''}</> : <><strong>Original MP3.</strong> This is the MP3 supplied in the archive.</>}</p>}
      {available.length ? <>
        <div className="audio-player" aria-busy={busy || undefined}>
          <div className="playback-controls">
            <button type="button" className="button primary" aria-disabled={busy || undefined} onClick={toggle}>{playing ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}{busy ? 'Loading audio…' : playing ? 'Pause' : 'Play recording'}</button>
            <button type="button" className="button secondary" disabled={!source || busy} onClick={() => seek(Math.max(0, lastPosition.current - 15), playing, 'back')}><RotateCcw size={17} aria-hidden="true" /><span className="sr-only">Back 15 seconds</span><span aria-hidden="true">15s</span></button>
            <button type="button" className="button secondary" disabled={!source || busy} onClick={() => {
              const player = audio.current;
              const boundDuration = hasLoadedSelected(player) && Number.isFinite(player.duration) && player.duration > 0
                ? player.duration
                : (selected && selected.duration > 0 ? selected.duration : null);
              const upperBound = boundDuration !== null ? Math.max(0, boundDuration - 0.05) : lastPosition.current + 30;
              if (boundDuration !== null && lastPosition.current >= upperBound) return;
              seek(Math.min(lastPosition.current + 30, upperBound), playing, 'forward');
            }}><span className="sr-only">Forward 30 seconds</span><span aria-hidden="true">30s</span><RotateCw size={17} aria-hidden="true" /></button>
            <div className="playback-speed field"><label htmlFor="playback-speed">Speed</label><select id="playback-speed" value={speed} onChange={event => {
              const rate = Number(event.target.value);
              if (audio.current) observe(telemetry.current.tracker.sample(playbackSample(audio.current)), telemetry.current.recordingId);
              if (rate !== preferredSpeed.current && selected) report('audio_rate', selected.id, { rateBucket: rateBucket(rate) });
              setSpeed(rate);
              preferredSpeed.current = rate;
              if (audio.current) audio.current.playbackRate = rate;
            }}>{Array.from(new Set([.5, .75, 1, 1.25, 1.5, 2, speed])).sort((a, b) => a - b).map(rate => <option key={rate} value={rate}>{rate}×{rate === 1 ? ' (normal)' : ''}</option>)}</select></div>
          </div>
          <div className="audio-scrubber">
            <div className="audio-slider-header">
              <label htmlFor="playback-seek">Playback position</label>
              <span className="small muted audio-time-readout">{timeLabel(sliderValue)} / {timeLabel(sliderMax)}</span>
            </div>
            <input
              id="playback-seek"
              type="range"
              className="audio-range audio-seek-range"
              min={0}
              max={sliderMax}
              step={1}
              value={sliderValue}
              disabled={sliderMax <= 0}
              aria-valuetext={seekValueText}
              aria-describedby="playback-seek-help"
              style={{ '--range-progress': `${seekPercent}%` } as CSSProperties}
              onChange={event => scrubTo(Number(event.target.value))}
              onKeyDown={handleSeekKeyDown}
            />
            <span id="playback-seek-help" className="sr-only">Use arrow keys to seek by {formatDurationWords(smallStep)}, Page Up or Page Down by {formatDurationWords(pageStep)}, and Home or End to jump to the start or end.</span>
          </div>
          <div className="player-meta">
            <div className="audio-volume-control">
              <button type="button" className="button secondary audio-mute-button" aria-pressed={effectiveMuted} onClick={toggleMute}>
                {effectiveMuted ? <VolumeX size={17} aria-hidden="true" /> : volumeLevel <= 0.5 ? <Volume1 size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}
                <span>Mute</span>
              </button>
              {volumeSupported ? <div className="audio-volume-slider">
                <div className="audio-slider-header">
                  <label htmlFor="playback-volume">Volume</label>
                  <span className="small muted audio-volume-value">{effectiveMuted ? 'Muted' : `${effectiveVolumePercent}%`}</span>
                </div>
                <input
                  id="playback-volume"
                  type="range"
                  className="audio-range audio-volume-range"
                  min={0}
                  max={100}
                  step={5}
                  value={effectiveVolumePercent}
                  aria-valuetext={volumeValueText}
                  style={{ '--range-progress': `${effectiveVolumePercent}%` } as CSSProperties}
                  onChange={event => applyVolume(Number(event.target.value))}
                  onKeyDown={handleVolumeKeyDown}
                />
              </div> : <span className="small muted audio-device-volume-note">Use device buttons to adjust volume.</span>}
            </div>
            {selected?.available && <a className="text-link small" href={`/api/assets/${encodeURIComponent(selected.id)}?download=1`} download={selected.name} referrerPolicy="no-referrer" onClick={() => report('audio_download', selected.id, { format: 'mp3', fileKind: selected.kind === 'listening-copy' ? 'listening-copy' : 'original' })}><Download size={15} aria-hidden="true" />{selected.kind === 'listening-copy' ? 'Download MP3 listening copy' : 'Download original MP3'}</a>}
          </div>
        </div>
        <audio key={source ? `source-${source.generation}` : `empty-${generation.current}`} ref={audio} preload={source ? 'metadata' : 'none'} src={source?.url} aria-hidden="true"
          onLoadedMetadata={event => onLoaded(event.currentTarget)}
          onDurationChange={event => {
            if (!isCurrentMedia(event.currentTarget)) return;
            const duration = event.currentTarget.duration;
            if (Number.isFinite(duration) && duration > 0) {
              setMediaDuration({ recordingId: source!.recordingId, seconds: duration });
            }
          }}
          onTimeUpdate={event => {
            if (!isCurrentMedia(event.currentTarget) || loading.current) return;
            const time = event.currentTarget.currentTime;
            if (event.currentTarget.seeking) telemetry.current.tracker.suspend();
            else observe(telemetry.current.tracker.sample(playbackSample(event.currentTarget)), source!.recordingId);
            if (retryScrubIntent.current) return;
            lastPosition.current = time;
            setPosition(time);
            onTime(time);
          }}
          onPlay={event => {
            if (!isCurrentMedia(event.currentTarget)) return;
            if (source && Date.now() >= source.expiresAt - 15_000 && selected) {
              const intent = retryScrubIntent.current;
              if (intent?.toEnd) {
                retryScrubIntent.current = null;
                lastPosition.current = 0;
                setPosition(0);
                onTime(0);
                void load(selected, 0, true);
                return;
              }
              void load(selected, intent ? intent.target : lastPosition.current, true, intent ?? undefined);
              return;
            }
            setPlaying(true);
            onPlaying(true);
          }}
          onPlaying={event => { if (isCurrentMedia(event.currentTarget)) observe(telemetry.current.tracker.playing(playbackSample(event.currentTarget)), source!.recordingId); }}
          onWaiting={event => {
            if (!isCurrentMedia(event.currentTarget)) return;
            if (!event.currentTarget.seeking) observe(telemetry.current.tracker.sample(playbackSample(event.currentTarget)), source!.recordingId);
            telemetry.current.tracker.suspend();
          }}
          onSeeking={event => {
            if (!isCurrentMedia(event.currentTarget)) return;
            telemetry.current.tracker.suspend();
            const programmed = programmedSeek.current;
            nativeSeek.current = !(programmed && programmed.generation === generation.current && performance.now() - programmed.when < 5000 && Math.abs(event.currentTarget.currentTime - programmed.target) < 0.25);
            if (nativeSeek.current && seekTimer.current) {
              clearTimeout(seekTimer.current);
              seekTimer.current = null;
            }
          }}
          onSeeked={event => {
            if (!isCurrentMedia(event.currentTarget)) return;
            const player = event.currentTarget;
            if (!player.paused && !player.ended && player.readyState >= 3) telemetry.current.tracker.reanchor(playbackSample(player));
            if (nativeSeek.current && !retryScrubIntent.current) scheduleScrubSeek(source!.recordingId);
            nativeSeek.current = false;
            programmedSeek.current = null;
          }}
          onPause={event => { if (isCurrentMedia(event.currentTarget)) {
            if (!event.currentTarget.ended && !event.currentTarget.error && !loading.current) observe(telemetry.current.tracker.pause(playbackSample(event.currentTarget)), source!.recordingId);
            setPlaying(false); onPlaying(false);
          } }}
          onEnded={event => { if (isCurrentMedia(event.currentTarget)) {
            observe(telemetry.current.tracker.end(playbackSample(event.currentTarget)), source!.recordingId);
            if (!retryScrubIntent.current) {
              lastPosition.current = event.currentTarget.currentTime;
              setPosition(event.currentTarget.currentTime);
            }
            setPlaying(false); onPlaying(false);
          } }}
          onVolumeChange={event => {
            if (!isCurrentMedia(event.currentTarget)) return;
            const nextVolume = event.currentTarget.volume;
            const nextMuted = event.currentTarget.muted;
            volume.current = nextVolume;
            muted.current = nextMuted;
            if (nextVolume > 0) lastNonZeroVolume.current = nextVolume;
            setVolumeLevel(nextVolume);
            setIsMuted(nextMuted);
          }}
          onRateChange={event => {
            if (!isCurrentMedia(event.currentTarget) || loading.current) return;
            const rate = event.currentTarget.playbackRate;
            if (Number.isFinite(rate) && rate > 0) {
              observe(telemetry.current.tracker.sample(playbackSample(event.currentTarget)), source!.recordingId);
              if (rate !== preferredSpeed.current) report('audio_rate', source!.recordingId, { rateBucket: rateBucket(rate) });
              preferredSpeed.current = rate;
              setSpeed(rate);
            }
          }}
          onError={event => {
            if (!isCurrentMedia(event.currentTarget) || !source || controller.current?.signal.aborted) return;
            const activeIntent: ScrubIntent | null = pending.current?.fromScrub
              ? { fromScrub: true, toEnd: Boolean(pending.current.toEnd), target: pending.current.at, reportSeek: Boolean(pending.current.reportSeek) }
              : retryScrubIntent.current;
            if (selected && Date.now() >= source.expiresAt - 30_000 && !recoveryTried.current) {
              recoveryTried.current = true;
              void load(selected, activeIntent ? activeIntent.target : (pending.current?.at ?? lastPosition.current), playing || pending.current?.play || false, activeIntent ?? undefined);
              return;
            }
            loading.current = false;
            pending.current = null;
            retryScrubIntent.current = activeIntent;
            telemetry.current.tracker.suspend();
            const code = event.currentTarget.error?.code;
            reportError(source.recordingId, code === 1 ? 'aborted' : code === 2 ? 'network' : code === 3 ? 'decode' : 'unsupported');
            setBusy(false);
            setFailed(true);
            setPlaying(false);
            onPlaying(false);
            setMessage('This recording could not be played. Retry from your current position, or choose another recording.');
          }} />
        {failed && <button className="button secondary audio-retry-button" type="button" onClick={() => {
          recoveryTried.current = false;
          if (!selected) return;
          const intent = retryScrubIntent.current;
          void load(selected, intent ? intent.target : lastPosition.current, true, intent ?? undefined);
        }}>Retry audio</button>}
        <p className="small muted audio-timing-note">Audio loads when you choose to listen. Transcript times are approximate and have not been independently verified against the recordings; alternate recordings may differ.</p>
      </> : <p className="small muted">MP3 playback for this session is not available on the site yet. You can read the transcript and guide below.</p>}
      {originalWavs.length > 0 && <details className="original-audio-downloads"><summary>Original WAV {originalWavs.length === 1 ? 'recording' : 'recordings'}</summary><p className="small muted">These larger recordings are preserved for download. The player uses MP3 audio.</p><ul>{originalWavs.map(recording => <li key={recording.id}>{recording.available ? <a className="text-link small" href={`/api/assets/${encodeURIComponent(recording.id)}?download=1`} download={recording.name} referrerPolicy="no-referrer" onClick={() => report('audio_download', recording.id, { format: 'wav', fileKind: 'original' })}><Download size={15} aria-hidden="true" /><span>Download original WAV: <span className="audio-filename">{recording.name}</span> ({(recording.bytes / 1_000_000).toFixed(1)} MB)</span></a> : <span className="small muted audio-filename">{recording.name} · Not yet available</span>}</li>)}</ul></details>}
    </>}
    <p className="small player-status" role="status">{message}</p>
  </section>;
});

export default RecordingAudio;
