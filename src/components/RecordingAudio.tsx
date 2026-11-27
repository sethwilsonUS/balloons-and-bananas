'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Download, Headphones, Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import type { AudioFile, Origin } from '../lib/types';
import { trackArchiveEvent } from '../lib/analytics';
import { PlaybackTelemetry, type PlaybackEvent } from '../lib/playback-telemetry';
import { request, timeLabel } from './api';

export interface RecordingAudioHandle { playAt: (seconds: number) => void; toggle: () => void }
interface Props {
  recordingId: string;
  origin: Origin;
  files: AudioFile[];
  preferredId: string | null;
  onTime: (seconds: number) => void;
  onPlaying: (playing: boolean) => void;
}
type SignedAudio = { url: string; expiresAt: number; fileId: string; generation: number };
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

const RecordingAudio = forwardRef<RecordingAudioHandle, Props>(function RecordingAudio({ recordingId, origin, files, preferredId, onTime, onPlaying }, ref) {
  const playbackFiles = files.filter(file => file.format.toLowerCase() === 'mp3');
  const originalWavs = files.filter(file => file.format.toLowerCase() === 'wav' && file.kind !== 'listening-copy');
  const initial = playbackFiles.find(file => file.id === preferredId && file.available)
    || playbackFiles.find(file => file.available && file.kind !== 'listening-copy')
    || playbackFiles.find(file => file.available) || playbackFiles[0];
  const [selectedId, setSelectedId] = useState(initial?.id || '');
  const [source, setSource] = useState<SignedAudio | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const generation = useRef(0);
  const pending = useRef<{ at: number; play: boolean; generation: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const loading = useRef(false);
  const recoveryTried = useRef(false);
  const lastPosition = useRef(0);
  const volume = useRef(1);
  const muted = useRef(false);
  const preferredSpeed = useRef(1);
  const telemetry = useRef({ fileId: initial?.id || '', tracker: new PlaybackTelemetry() });
  const reportedErrors = useRef(new Set<string>());
  const programmedSeek = useRef<{ generation: number; target: number; when: number } | null>(null);
  const nativeSeek = useRef(false);
  const seekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected = playbackFiles.find(file => file.id === selectedId);
  const available = playbackFiles.filter(file => file.available);
  const originalSource = files.find(file => file.id === selected?.derivedFromId && file.kind !== 'listening-copy');

  const report = useCallback((name: AudioEvent, fileId: string, properties: Record<string, string | number | boolean> = {}) => {
    if (!files.some(file => file.id === fileId)) return;
    trackArchiveEvent(name, { recordingId, origin, audioId: fileId, ...properties });
  }, [files, origin, recordingId]);
  const observe = useCallback((events: PlaybackEvent[], fileId: string) => {
    for (const event of events) {
      if (event.type === 'milestone') report('audio_listen_milestone', fileId, { milestoneSeconds: event.seconds });
      else report(`audio_${event.type}`, fileId);
    }
  }, [report]);
  const reportError = useCallback((fileId: string, errorCode: 'load' | 'play' | 'aborted' | 'network' | 'decode' | 'unsupported') => {
    const key = `${fileId}:${generation.current}:${errorCode}`;
    if (reportedErrors.current.has(key)) return;
    reportedErrors.current.add(key);
    report('audio_error', fileId, { errorCode });
  }, [report]);
  const selectTelemetry = useCallback((fileId: string) => {
    if (telemetry.current.fileId === fileId) return;
    if (telemetry.current.fileId) report('audio_file_change', fileId);
    telemetry.current = { fileId, tracker: new PlaybackTelemetry() };
  }, [report]);

  useEffect(() => () => {
    generation.current += 1;
    controller.current?.abort();
    telemetry.current.tracker.suspend();
    if (seekTimer.current) clearTimeout(seekTimer.current);
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
        reportError(telemetry.current.fileId, 'play');
        setMessage('The audio is ready. Press play in the audio controls to listen.');
      }
    }
  }, [reportError]);

  const load = useCallback(async (file: AudioFile, at: number, shouldPlay: boolean) => {
    if (!file.available || file.format.toLowerCase() !== 'mp3') return;
    telemetry.current.tracker.suspend();
    selectTelemetry(file.id);
    const nextGeneration = ++generation.current;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    loading.current = true;
    pending.current = { at, play: shouldPlay, generation: nextGeneration };
    releaseMedia(audio.current);
    setSource(null);
    setPlaying(false);
    onPlaying(false);
    setBusy(true);
    setFailed(false);
    setMessage('');
    setSelectedId(file.id);
    try {
      const signed = await request<{ url: string; expiresAt: number }>(`/api/assets/${encodeURIComponent(file.id)}?json=1`, { signal: next.signal });
      if (next.signal.aborted || generation.current !== nextGeneration) return;
      setSource({ ...signed, fileId: file.id, generation: nextGeneration });
    } catch (error) {
      if (next.signal.aborted || generation.current !== nextGeneration) return;
      pending.current = null;
      loading.current = false;
      setBusy(false);
      setFailed(true);
      reportError(file.id, 'load');
      setMessage(error instanceof Error ? error.message : 'The recording could not be loaded. Please try again.');
    }
  }, [onPlaying, reportError, selectTelemetry]);

  useEffect(() => { if (source) audio.current?.load(); }, [source]);

  const seek = useCallback((seconds: number, shouldPlay = true, seekSource?: SeekSource) => {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    let file = selected;
    if (!file?.available || (file.duration > 0 && seconds >= file.duration)) {
      file = available.find(item => item.duration > seconds);
    }
    if (!file) {
      setMessage('This timestamp falls beyond the available recording. The transcript and source locator are still available below.');
      return;
    }
    recoveryTried.current = false;
    const player = audio.current;
    if (source?.fileId === file.id && Date.now() < source.expiresAt - 15_000 && player && player.readyState >= 1 && !failed) {
      if (Number.isFinite(player.duration) && seconds >= player.duration) {
        setMessage('This timestamp falls beyond this recording. Please choose another recording file.');
        return;
      }
      if (seekSource) report('audio_seek', file.id, { seekSource });
      telemetry.current.tracker.suspend();
      programmedSeek.current = { generation: generation.current, target: seconds, when: performance.now() };
      player.currentTime = seconds;
      lastPosition.current = seconds;
      setPosition(seconds);
      onTime(seconds);
      if (shouldPlay) void playLoaded();
      setMessage('');
    } else {
      if (seekSource) report('audio_seek', file.id, { seekSource });
      void load(file, seconds, shouldPlay);
    }
  }, [available, failed, load, onTime, playLoaded, report, selected, source]);

  const toggle = useCallback(() => {
    if (playing) audio.current?.pause();
    else seek(audio.current?.ended ? 0 : lastPosition.current, true);
  }, [playing, seek]);

  useImperativeHandle(ref, () => ({ playAt: seconds => seek(seconds, true, 'passage'), toggle }), [seek, toggle]);

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
    player.playbackRate = preferredSpeed.current;
    player.volume = volume.current;
    player.muted = muted.current;
    loading.current = false;
    setBusy(false);
    if (!next) return;
    pending.current = null;
    if (Number.isFinite(player.duration) && next.at >= player.duration) {
      setMessage('This timestamp falls beyond the loaded recording. Please choose another recording file.');
      return;
    }
    programmedSeek.current = { generation: generation.current, target: next.at, when: performance.now() };
    player.currentTime = next.at;
    lastPosition.current = next.at;
    setPosition(next.at);
    onTime(next.at);
    if (next.play) void playLoaded();
  };

  return <section className="audio-panel" aria-labelledby="listen-heading">
    <div className="section-label"><Headphones size={18} aria-hidden="true" /><h3 id="listen-heading">Listen to the recording</h3></div>
    {!files.length ? <p>The archive has a transcript for this session, but no corresponding audio file.</p> : <>
      {playbackFiles.length > 0 && <div className="field audio-file-choice"><label htmlFor="recording-file">MP3 recording file</label><select id="recording-file" value={selectedId} disabled={!available.length} onChange={event => {
        telemetry.current.tracker.suspend();
        selectTelemetry(event.target.value);
        generation.current += 1;
        controller.current?.abort();
        loading.current = false;
        pending.current = null;
        recoveryTried.current = false;
        releaseMedia(audio.current);
        setPlaying(false);
        onPlaying(false);
        setSelectedId(event.target.value);
        setSource(null);
        setBusy(false);
        setFailed(false);
        lastPosition.current = 0;
        setPosition(0);
        onTime(0);
        setMessage('');
      }}>{playbackFiles.map(file => <option key={file.id} value={file.id} disabled={!file.available}>{file.name} · {file.kind === 'listening-copy' ? 'MP3 listening copy' : 'Original MP3'} · {timeLabel(file.duration)}{!file.available ? ' · Not yet available' : ''}</option>)}</select></div>}
      {selected && <p className="small muted audio-provenance">{selected.kind === 'listening-copy' ? <><strong>MP3 listening copy.</strong> Converted from{originalSource ? <> <span className="audio-filename">{originalSource.name}</span></> : ' the original WAV'} for playback. The original WAV is preserved.{selected.encoding ? ` Encoding: ${selected.encoding}.` : ''}</> : <><strong>Original MP3.</strong> This is the MP3 supplied in the archive.</>}</p>}
      {available.length ? <>
        <div className="playback-controls">
          <button type="button" className="button primary" disabled={busy} onClick={toggle}>{playing ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}{busy ? 'Loading audio…' : playing ? 'Pause' : 'Play recording'}</button>
          <button type="button" className="button secondary" disabled={!source || busy} onClick={() => seek(Math.max(0, lastPosition.current - 15), playing, 'back')}><RotateCcw size={17} aria-hidden="true" /><span className="sr-only">Back 15 seconds</span><span aria-hidden="true">15s</span></button>
          <button type="button" className="button secondary" disabled={!source || busy} onClick={() => {
            const duration = audio.current?.duration;
            seek(Math.min(lastPosition.current + 30, Number.isFinite(duration) ? Math.max(0, duration! - .05) : selected?.duration || lastPosition.current + 30), playing, 'forward');
          }}><span className="sr-only">Forward 30 seconds</span><span aria-hidden="true">30s</span><RotateCw size={17} aria-hidden="true" /></button>
          <div className="playback-speed field"><label htmlFor="playback-speed">Speed</label><select id="playback-speed" value={speed} onChange={event => {
            const rate = Number(event.target.value);
            if (audio.current) observe(telemetry.current.tracker.sample(playbackSample(audio.current)), telemetry.current.fileId);
            if (rate !== preferredSpeed.current && selected) report('audio_rate', selected.id, { rateBucket: rateBucket(rate) });
            setSpeed(rate);
            preferredSpeed.current = rate;
            if (audio.current) audio.current.playbackRate = rate;
          }}>{Array.from(new Set([.5, .75, 1, 1.25, 1.5, 2, speed])).sort((a, b) => a - b).map(rate => <option key={rate} value={rate}>{rate}×{rate === 1 ? ' (normal)' : ''}</option>)}</select></div>
        </div>
        <audio key={source ? `source-${source.generation}` : `empty-${generation.current}`} ref={audio} controls preload={source ? 'metadata' : 'none'} src={source?.url} aria-label={`Audio: ${selected?.name || 'Recording'}`}
          onLoadedMetadata={event => onLoaded(event.currentTarget)}
          onTimeUpdate={event => {
            if (!isCurrentMedia(event.currentTarget) || loading.current) return;
            const time = event.currentTarget.currentTime;
            if (event.currentTarget.seeking) telemetry.current.tracker.suspend();
            else observe(telemetry.current.tracker.sample(playbackSample(event.currentTarget)), source!.fileId);
            lastPosition.current = time;
            setPosition(time);
            onTime(time);
          }}
          onPlay={event => {
            if (!isCurrentMedia(event.currentTarget)) return;
            if (source && Date.now() >= source.expiresAt - 15_000 && selected) {
              void load(selected, lastPosition.current, true);
              return;
            }
            setPlaying(true);
            onPlaying(true);
          }}
          onPlaying={event => { if (isCurrentMedia(event.currentTarget)) observe(telemetry.current.tracker.playing(playbackSample(event.currentTarget)), source!.fileId); }}
          onWaiting={event => {
            if (!isCurrentMedia(event.currentTarget)) return;
            if (!event.currentTarget.seeking) observe(telemetry.current.tracker.sample(playbackSample(event.currentTarget)), source!.fileId);
            telemetry.current.tracker.suspend();
          }}
          onSeeking={event => {
            if (!isCurrentMedia(event.currentTarget)) return;
            telemetry.current.tracker.suspend();
            if (seekTimer.current) clearTimeout(seekTimer.current);
            const programmed = programmedSeek.current;
            nativeSeek.current = !(programmed && programmed.generation === generation.current && performance.now() - programmed.when < 5000 && Math.abs(event.currentTarget.currentTime - programmed.target) < 0.25);
          }}
          onSeeked={event => {
            if (!isCurrentMedia(event.currentTarget)) return;
            const player = event.currentTarget;
            if (!player.paused && !player.ended && player.readyState >= 3) telemetry.current.tracker.reanchor(playbackSample(player));
            if (nativeSeek.current) {
              const fileId = source!.fileId;
              const seekGeneration = generation.current;
              seekTimer.current = setTimeout(() => { if (generation.current === seekGeneration) report('audio_seek', fileId, { seekSource: 'native' }); }, 350);
            }
            nativeSeek.current = false;
            programmedSeek.current = null;
          }}
          onPause={event => { if (isCurrentMedia(event.currentTarget)) {
            if (!event.currentTarget.ended && !event.currentTarget.error && !loading.current) observe(telemetry.current.tracker.pause(playbackSample(event.currentTarget)), source!.fileId);
            setPlaying(false); onPlaying(false);
          } }}
          onEnded={event => { if (isCurrentMedia(event.currentTarget)) {
            observe(telemetry.current.tracker.end(playbackSample(event.currentTarget)), source!.fileId);
            setPlaying(false); onPlaying(false);
          } }}
          onVolumeChange={event => {
            if (!isCurrentMedia(event.currentTarget)) return;
            volume.current = event.currentTarget.volume;
            muted.current = event.currentTarget.muted;
          }}
          onRateChange={event => {
            if (!isCurrentMedia(event.currentTarget) || loading.current) return;
            const rate = event.currentTarget.playbackRate;
            if (Number.isFinite(rate) && rate > 0) {
              observe(telemetry.current.tracker.sample(playbackSample(event.currentTarget)), source!.fileId);
              if (rate !== preferredSpeed.current) report('audio_rate', source!.fileId, { rateBucket: rateBucket(rate) });
              preferredSpeed.current = rate;
              setSpeed(rate);
            }
          }}
          onError={event => {
            if (!isCurrentMedia(event.currentTarget) || !source || controller.current?.signal.aborted) return;
            if (selected && Date.now() >= source.expiresAt - 30_000 && !recoveryTried.current) {
              recoveryTried.current = true;
              void load(selected, lastPosition.current, playing || pending.current?.play || false);
              return;
            }
            loading.current = false;
            telemetry.current.tracker.suspend();
            const code = event.currentTarget.error?.code;
            reportError(source.fileId, code === 1 ? 'aborted' : code === 2 ? 'network' : code === 3 ? 'decode' : 'unsupported');
            setBusy(false);
            setFailed(true);
            setPlaying(false);
            onPlaying(false);
            setMessage('This recording could not be played. Retry from your current position, or choose another file.');
          }} />
        <div className="player-meta"><span className="small muted">{timeLabel(position)} / {timeLabel(selected?.duration || 0)}</span>{selected?.available && <a className="text-link small" href={`/api/assets/${encodeURIComponent(selected.id)}?download=1`} download={selected.name} referrerPolicy="no-referrer" onClick={() => report('audio_download', selected.id, { format: 'mp3', fileKind: selected.kind === 'listening-copy' ? 'listening-copy' : 'original' })}><Download size={15} aria-hidden="true" />{selected.kind === 'listening-copy' ? 'Download MP3 listening copy' : 'Download original MP3'}</a>}</div>
        {failed && <button className="button secondary" type="button" onClick={() => { recoveryTried.current = false; if (selected) void load(selected, lastPosition.current, true); }}>Retry audio</button>}
        <p className="small muted audio-timing-note">Audio loads when you choose to listen. Transcript times are approximate and have not been independently verified against the recordings; alternate files may differ.</p>
      </> : <p className="small muted">MP3 playback for this session is not available on the site yet. You can read the transcript and guide below.</p>}
      {originalWavs.length > 0 && <details className="original-audio-downloads"><summary>Original WAV {originalWavs.length === 1 ? 'file' : 'files'}</summary><p className="small muted">These larger files are preserved for download. The player uses MP3 audio.</p><ul>{originalWavs.map(file => <li key={file.id}>{file.available ? <a className="text-link small" href={`/api/assets/${encodeURIComponent(file.id)}?download=1`} download={file.name} referrerPolicy="no-referrer" onClick={() => report('audio_download', file.id, { format: 'wav', fileKind: 'original' })}><Download size={15} aria-hidden="true" /><span>Download original WAV: <span className="audio-filename">{file.name}</span> ({(file.bytes / 1_000_000).toFixed(1)} MB)</span></a> : <span className="small muted audio-filename">{file.name} · Not yet available</span>}</li>)}</ul></details>}
    </>}
    <p className="small player-status" role="status">{message}</p>
  </section>;
});

export default RecordingAudio;
