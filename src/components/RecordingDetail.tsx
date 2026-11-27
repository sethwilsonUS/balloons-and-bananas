'use client';

import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowDown, Download, Pause, Play, Search } from 'lucide-react';
import type { ArchiveEntry, Origin } from '../lib/types';
import { trackArchiveEvent } from '../lib/analytics';
import { formatAge } from '../lib/age';
import { getNotationLinks, readingText } from '../lib/transcript-display';
import { linguisticMarkers, type LinguisticMarkerId } from '../lib/linguistic-markers';
import { ApiError, originLabels, request, timeLabel } from './api';
import { TopicLabels } from './TopicThemes';
import RecordingAudio, { type RecordingAudioHandle } from './RecordingAudio';

function Highlight({ text, query, start = 0, end = text.length }: { text: string; query: string; start?: number; end?: number }) {
  if (!query.trim()) return <>{text.slice(start, end)}</>;
  const needle = query.trim().toLocaleLowerCase();
  const haystack = text.toLocaleLowerCase();
  const pieces = [];
  let cursor = start;
  let found = haystack.indexOf(needle);
  while (found !== -1 && found < end) {
    if (found + needle.length > start) {
      const matchStart = Math.max(start, found);
      const matchEnd = Math.min(end, found + needle.length);
      pieces.push(text.slice(cursor, matchStart));
      pieces.push(<mark key={found}>{text.slice(matchStart, matchEnd)}</mark>);
      cursor = matchEnd;
    }
    found = haystack.indexOf(needle, found + needle.length);
  }
  pieces.push(text.slice(cursor, end));
  return <>{pieces}</>;
}

function TranscriptText({ text, query, links, onMarker, recordingId, origin }: { text: string; query: string; links: ReturnType<typeof getNotationLinks>; onMarker: (marker: LinguisticMarkerId) => void; recordingId: string; origin: Origin }) {
  if (!links.length) return <Highlight text={text} query={query} />;
  const pieces = [];
  let cursor = 0;
  for (const link of links) {
    pieces.push(<Highlight key={`text-${cursor}`} text={text} query={query} start={cursor} end={link.start} />);
    const label = linguisticMarkers.find(item => item.id === link.marker)?.label.toLowerCase() || 'notation';
    pieces.push(<a key={`marker-${link.start}`} className="notation-marker-link" href={`?marker=${encodeURIComponent(link.marker)}&speaker=any`}
      aria-label={`${text.slice(link.start, link.end)} — find ${label} across transcripts`}
      onClick={event => { trackArchiveEvent('notation_explore', { recordingId, origin, marker: link.marker }); if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return; event.preventDefault(); onMarker(link.marker); }}
      onAuxClick={event => { if (event.button === 1) trackArchiveEvent('notation_explore', { recordingId, origin, marker: link.marker }); }}>
      <Highlight text={text} query={query} start={link.start} end={link.end} />
    </a>);
    cursor = link.end;
  }
  pieces.push(<Highlight key={`text-${cursor}`} text={text} query={query} start={cursor} />);
  return <>{pieces}</>;
}

function RecordingPassages({ entry, passage, onMarker }: { entry: ArchiveEntry; passage: number | null; onMarker: (marker: LinguisticMarkerId, sourcePassage: number) => void }) {
  const [jump, setJump] = useState<{ index: number; serial: number } | null>(null);
  const [message, setMessage] = useState('');
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const player = useRef<RecordingAudioHandle>(null);
  const playbackFiles = entry.audio.filter(file => file.format.toLowerCase() === 'mp3' && file.available);
  const hasAudio = playbackFiles.length > 0;
  const canPlayAt = (at: number | null | undefined) => typeof at === 'number' && Number.isFinite(at) && at >= 0
    && playbackFiles.some(file => file.duration <= 0 || at < file.duration);
  const activeIndex = useMemo(() => currentTime === null ? null : entry.transcript.findIndex(segment =>
    typeof segment.start === 'number' && typeof segment.end === 'number'
    && segment.start <= currentTime && segment.end > currentTime), [currentTime, entry.transcript]);
  const linkedIndex = passage !== null && Number.isSafeInteger(passage) && passage > 0 && passage <= entry.transcript.length ? passage - 1 : null;

  useEffect(() => {
    if (passage === null) return;
    if (linkedIndex === null) {
      setMessage(`Passage ${passage} is outside this transcript. The available transcript is shown below.`);
      setJump(null);
      return;
    }
    setMessage(`Showing transcript passage ${passage}, with surrounding passages for context.`);
    setJump(value => ({ index: linkedIndex, serial: (value?.serial || 0) + 1 }));
  }, [linkedIndex, passage]);

  const readPassage = (at: number | null, source: 'moment' | 'current' = 'moment') => {
    trackArchiveEvent('transcript_jump', { recordingId: entry.id, origin: entry.origin, source, action: 'read' });
    let closest = 0;
    let distance = Infinity;
    entry.transcript.forEach((segment, index) => {
      if (at !== null && typeof segment.start === 'number') {
        const difference = segment.start <= at && typeof segment.end === 'number' && segment.end >= at ? 0 : Math.abs(segment.start - at);
        if (difference < distance) { distance = difference; closest = index; }
      }
    });
    setMessage(Number.isFinite(distance) && at !== null ? `Showing the transcript near ${timeLabel(at)}. Use the source locator to check the exact passage.` : 'Showing the transcript. Use the source locator to check the exact passage in the downloadable original.');
    setJump(value => ({ index: closest, serial: (value?.serial || 0) + 1 }));
  };

  return <>
    <RecordingAudio ref={player} recordingId={entry.id} origin={entry.origin} files={entry.audio} preferredId={entry.preferredAudioId} onTime={setCurrentTime} onPlaying={setPlaying} />
    <section className="landmarks" aria-labelledby="moments-heading">
      <div className="section-heading"><div><p className="eyebrow">A closer look</p><h3 id="moments-heading">Passages to revisit</h3></div><span className="muted small">{entry.moments.length} passages</span></div>
      <ol className="moment-list">
        {entry.moments.map((moment, index) => <li key={`${index}-${moment.title}`}>
          <div className="moment-marker"><span className="moment-number">{String(index + 1).padStart(2, '0')}</span>{moment.start !== null && <span className="moment-time">{timeLabel(moment.start)}</span>}</div>
          <div className="moment-body"><h4>{moment.title}</h4><p>{moment.description}</p><p className="source-locator">{moment.locator}{moment.end !== null && moment.start !== null ? ` · ${timeLabel(moment.start)}–${timeLabel(moment.end)}` : ''}</p><div className="moment-actions">{canPlayAt(moment.start) && <button className="text-button small" type="button" onClick={() => {
            trackArchiveEvent('transcript_jump', { recordingId: entry.id, origin: entry.origin, source: 'moment', action: 'listen' });
            player.current?.playAt(moment.start!);
          }} aria-label={`Listen from ${timeLabel(moment.start!)}: ${moment.title}`}><Play size={14} aria-hidden="true" />Listen from {timeLabel(moment.start!)}</button>}<button className="text-button small" type="button" onClick={() => readPassage(moment.start)} aria-label={`Read in the transcript: ${moment.title}`}>Read in the transcript<ArrowDown size={14} aria-hidden="true" /></button></div></div>
        </li>)}
      </ol>
    </section>
    <Transcript entry={entry} jump={jump} message={message} linkedIndex={linkedIndex} activeIndex={activeIndex} playing={playing} hasAudio={hasAudio} canPlayAt={canPlayAt} onPlayAt={at => {
      trackArchiveEvent('transcript_jump', { recordingId: entry.id, origin: entry.origin, source: 'cue', action: 'listen' });
      player.current?.playAt(at);
    }} onTogglePlayback={() => player.current?.toggle()} onCurrentPassage={() => readPassage(currentTime, 'current')} onMarker={onMarker} />
  </>;
}

function Transcript({ entry, jump, message, linkedIndex, activeIndex, playing, hasAudio, canPlayAt, onPlayAt, onTogglePlayback, onCurrentPassage, onMarker }: {
  entry: ArchiveEntry;
  jump: { index: number; serial: number } | null;
  message: string;
  linkedIndex: number | null;
  activeIndex: number | null;
  playing: boolean;
  hasAudio: boolean;
  canPlayAt: (at: number | null | undefined) => boolean;
  onPlayAt: (at: number) => void;
  onTogglePlayback: () => void;
  onCurrentPassage: () => void;
  onMarker: (marker: LinguisticMarkerId, sourcePassage: number) => void;
}) {
  const [query, setQuery] = useState('');
  const findEdited = useRef(false);
  const [limit, setLimit] = useState(100);
  const [follow, setFollow] = useState(false);
  const hasChatNotation = entry.origin === 'archived_research' || entry.origin === 'talkbank_ai_draft';
  const [showNotation, setShowNotation] = useState(hasChatNotation && linkedIndex !== null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const toolbar = useRef<HTMLDivElement>(null);
  // Inspectable source notation is the initial view for exact passage links.
  // Playback and ordinary passage jumps do not override a reader's choice.
  useEffect(() => {
    if (hasChatNotation && linkedIndex !== null) setShowNotation(true);
  }, [hasChatNotation, linkedIndex]);
  useEffect(() => {
    const element = toolbar.current;
    if (!element) { setToolbarHeight(0); return; }
    const measure = () => setToolbarHeight(Math.ceil(element.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasAudio]);
  const [pendingFocus, setPendingFocus] = useState<number | null>(null);
  const rows = useRef(new Map<number, HTMLDivElement>());
  useEffect(() => {
    if (!jump || !Number.isInteger(jump.index) || jump.index < 0 || jump.index >= entry.transcript.length) return;
    setQuery('');
    setFollow(false);
    setLimit(Math.max(100, jump.index + 25));
    setPendingFocus(jump.index);
  }, [entry.transcript.length, jump]);
  useEffect(() => {
    if (pendingFocus === null) return;
    const row = rows.current.get(pendingFocus);
    if (!row) return;
    row.focus();
    row.scrollIntoView({ block: 'start', behavior: 'instant' });
    setPendingFocus(null);
  }, [pendingFocus, limit, query]);
  useEffect(() => {
    if (!follow || !playing || query.trim() || activeIndex === null || activeIndex < 0) return;
    setLimit(value => Math.max(value, activeIndex + 25));
    rows.current.get(activeIndex)?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [activeIndex, follow, playing, query, limit, toolbarHeight]);
  const displayRows = useMemo(() => entry.transcript.map((segment, index) => ({
    segment, index, text: showNotation ? segment.text : readingText(segment, entry.origin),
    links: showNotation ? getNotationLinks(segment, entry.origin) : [],
  })), [entry.origin, entry.transcript, showNotation]);
  const results = useMemo(() => displayRows.filter(({ segment, text }) => !query.trim() || `${segment.speaker || ''} ${text}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [displayRows, query]);
  useEffect(() => {
    if (!findEdited.current || !query.trim()) return;
    const timer = window.setTimeout(() => {
      findEdited.current = false;
      trackArchiveEvent('transcript_find', { recordingId: entry.id, origin: entry.origin, queryLength: Math.min(300, query.trim().length), results: results.length, notation: showNotation });
    }, 750);
    return () => window.clearTimeout(timer);
  }, [entry.id, entry.origin, query, results.length, showNotation]);

  return <section className="transcript-section" aria-labelledby="transcript-heading" style={{ '--transcript-toolbar-height': `${toolbarHeight}px` } as CSSProperties}>
    <div className="section-heading"><div><p className="eyebrow">The source text</p><h3 id="transcript-heading">Transcript</h3></div><span className={`origin-badge ${entry.origin}`}>{originLabels[entry.origin]}</span></div>
    <p className="small muted">{entry.origin === 'archived_research' ? 'A readable view of the archived research transcript. Original notation is retained in the downloadable source files.' : 'Machine-generated draft: words, speakers, and timestamps may be wrong. Check the recording before treating a passage as evidence.'}</p>
    {hasAudio && <div ref={toolbar} className="transcript-playback-tools" role="group" aria-label="Transcript playback controls"><button type="button" className="button secondary" onClick={onTogglePlayback}>{playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{playing ? 'Pause audio' : 'Play audio'}</button><button type="button" className="button secondary" onClick={onCurrentPassage} disabled={activeIndex === null || activeIndex < 0}>Current passage</button><label className="follow-control"><input type="checkbox" checked={follow} onChange={event => {
      setFollow(event.target.checked);
      trackArchiveEvent('transcript_follow', { recordingId: entry.id, origin: entry.origin, enabled: event.target.checked });
    }} />Follow playback</label></div>}
    {follow && query.trim() && <p className="small muted">Clear the transcript search to follow playback.</p>}
    {hasChatNotation ? <div className="transcript-view-controls"><label className="follow-control"><input type="checkbox" checked={showNotation} aria-describedby="transcript-notation-help" onChange={event => {
      setShowNotation(event.target.checked);
      trackArchiveEvent('notation_toggle', { recordingId: entry.id, origin: entry.origin, enabled: event.target.checked });
    }} />Show linguistic notation</label><p id="transcript-notation-help" className="small muted">Off: an easier reading view with research codes and dependent notes hidden. Partial-word spellings and uncertainty remain. On: the notation and notes stored in this reading copy; full analysis tiers are in the downloadable CHAT source. This changes only the display; source files are unchanged.</p>{showNotation && <p className="small muted">Linked repetition, retracing, and pause symbols find matching passages across transcripts, initially including any speaker.</p>}</div> : <p className="small muted transcript-view-controls">This local AI draft has no CHAT notation layer to switch on. Its text is displayed unchanged.</p>}
    <div className="transcript-search field"><label htmlFor="transcript-query">Find within this transcript</label><div className="search-input"><Search size={18} aria-hidden="true" /><input id="transcript-query" type="search" value={query} onChange={event => { findEdited.current = true; setQuery(event.target.value); setLimit(100); }} placeholder="A word, name, or phrase" autoComplete="off" spellCheck={false} aria-describedby="transcript-search-help" /></div><p id="transcript-search-help" className="small muted">Searches the text currently displayed, including speaker labels and visible source notes.</p></div>
    <p className="small muted" role="status">{query.trim() ? `${results.length.toLocaleString()} matching passages` : `${entry.transcript.length.toLocaleString()} transcript passages`}{results.length > limit ? ` · showing the first ${limit}` : ''}</p>
    <p className="small muted" role="status">{message}</p>
    <div className="transcript-lines">
      {results.slice(0, limit).map(({ segment, index, text, links }) => <div className={`transcript-line${activeIndex === index ? ' is-current' : ''}${linkedIndex === index ? ' is-linked' : ''}`} id={`transcript-passage-${index + 1}`} key={index} tabIndex={-1} aria-current={activeIndex === index ? 'true' : undefined} ref={node => { if (node) rows.current.set(index, node); else rows.current.delete(index); }}>
        <div className="transcript-cue">{canPlayAt(segment.start) ? <button className="cue-button" type="button" onClick={() => onPlayAt(segment.start!)} aria-label={`Play transcript passage ${index + 1} at ${timeLabel(segment.start!)}`}><Play size={11} aria-hidden="true" />{timeLabel(segment.start!)}</button> : <span className="small muted">{typeof segment.start === 'number' ? timeLabel(segment.start) : index + 1}</span>}</div>
        <p><span className="sr-only">Passage {index + 1}. </span>{segment.speaker && <span className="speaker">{segment.speaker}: </span>}<TranscriptText recordingId={entry.id} origin={entry.origin} text={text} query={query} links={links} onMarker={marker => onMarker(marker, index + 1)} /></p>
      </div>)}
      {!results.length && <p className="empty-inline">No matching passages. Try a different word or clear your search.</p>}
    </div>
    {results.length > limit && <button type="button" className="button secondary" onClick={() => {
      trackArchiveEvent('transcript_more', { recordingId: entry.id, origin: entry.origin });
      setPendingFocus(results[limit].index);
      setLimit(value => value + 100);
    }}>Show {Math.min(100, results.length - limit)} more passages</button>}
  </section>;
}

export default function RecordingDetail({ id, passage = null, onBack, onMarker, onEntryState }: {
  id: string;
  passage?: number | null;
  onBack: () => void;
  onMarker: (marker: LinguisticMarkerId, sourcePassage: number) => void;
  onEntryState?: (state: { id: string; title: string | null; notFound: boolean }) => void;
}) {
  const [entry, setEntry] = useState<ArchiveEntry | null>(null);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setEntry(null);
    setError('');
    setNotFound(false);
    void request<ArchiveEntry>(`/api/entries/${encodeURIComponent(id)}`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setEntry(data);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      const missing = reason instanceof ApiError && reason.status === 404;
      setNotFound(missing);
      setError(missing ? 'This recording guide could not be found.' : 'This guide could not be loaded. Please try again.');
    });
    return () => controller.abort();
  }, [id, retry]);

  useEffect(() => {
    onEntryState?.({ id, title: entry?.id === id ? entry.title : null, notFound });
  }, [entry, id, notFound, onEntryState]);

  useEffect(() => {
    if (entry) trackArchiveEvent('recording_view', { recordingId: entry.id, origin: entry.origin });
  }, [entry]);

  useEffect(() => {
    if (entry && (passage === null || !Number.isSafeInteger(passage) || passage < 1 || passage > entry.transcript.length)) heading.current?.focus();
  }, [entry, passage]);

  return <article className="recording-detail">
    <button type="button" className="text-button back-button" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />Back to recordings</button>
    {error ? <div className="error-panel" role="alert"><p>{error}</p><button className="button secondary" type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : !entry ? <p className="loading-message" role="status">Opening the recording guide…</p> : <>
      <header className="detail-header">
        <div className="entry-meta"><span className="eyebrow">Recording guide</span><span>{entry.sourceName}</span>{entry.ages.length > 0 && <span>Age {entry.ages.map(formatAge).join(' / ')}</span>}{entry.dates.length > 0 && <span>{entry.dates.join(' / ')}</span>}</div>
        <h2 ref={heading} tabIndex={-1}>{entry.title}</h2>
        <div className="badge-row"><span className="ai-badge">AI-written guide</span><span className={`origin-badge ${entry.origin}`}>{originLabels[entry.origin]}</span></div>
        <p className="detail-overview">{entry.overview}</p>
        <TopicLabels topics={entry.topics} />
      </header>
      <div className="provenance-note"><p><strong>About this guide.</strong> This summary and its interpretations were generated with AI from the transcript. They are a starting point for exploring the material; they are not part of the original research transcript or an independently verified account of the audio.</p></div>
      <RecordingPassages key={entry.id} entry={entry} passage={passage} onMarker={onMarker} />
      <section className="source-section" aria-labelledby="sources-heading">
        <p className="eyebrow">Keep the evidence in view</p><h3 id="sources-heading">Sources &amp; reading notes</h3>
        {entry.limits.length > 0 && <ul className="reading-notes">{entry.limits.map((limit, index) => <li key={index}>{limit}</li>)}</ul>}
        <div className="source-downloads">{entry.sources.map(source => <a key={source.id} href={`/api/assets/${encodeURIComponent(source.id)}`} className="download-link" download={source.name} referrerPolicy="no-referrer" onClick={() => {
          const format = ['cha', 'txt', 'json', 'vtt', 'md', 'html'].includes(source.format.toLowerCase()) ? source.format.toLowerCase() : 'other';
          const category = format === 'cha' ? 'chat' : ['txt', 'json', 'vtt'].includes(format) ? 'transcript' : ['md', 'html'].includes(format) ? 'guide' : 'other';
          trackArchiveEvent('source_download', { recordingId: entry.id, origin: entry.origin, format, category });
        }}><Download size={18} aria-hidden="true" /><span><strong>{source.label}</strong><span className="small muted">{source.name} · {source.format.toUpperCase()}</span></span></a>)}</div>
        <details className="technical-notes"><summary>Source identification</summary><p>{entry.association}</p>{entry.ages.length > 0 && <p><strong>Stored age notation (CHAT): </strong>{entry.ages.join(' / ')}</p>}<p className="small">Source SHA-256</p><code>{entry.sourceSha256}</code></details>
      </section>
    </>}
  </article>;
}
