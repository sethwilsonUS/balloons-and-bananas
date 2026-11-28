'use client';

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowDown, Check, Download, Link2, Pause, Play, Search, X } from 'lucide-react';
import type { Session, TranscriptOrigin } from '../lib/types';
import { trackArchiveEvent } from '../lib/analytics';
import { getNotationLinks, readingText } from '../lib/transcript-display';
import { linguisticMarkers, type LinguisticMarkerId } from '../lib/linguistic-markers';
import {
  findNearestPassageIndex,
  formatCanonicalPassageUrl,
  formatTimeReadyAnnouncement,
  parseSessionHash,
} from '../lib/session-reading';
import { ApiError, request, timeLabel, transcriptOriginLabels } from './api';
import { CitePassageButton, SessionCiteProvider } from './CiteControl';
import SessionAge from './SessionAge';
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

function TranscriptText({ text, query, links, onMarker, sessionId, origin }: { text: string; query: string; links: ReturnType<typeof getNotationLinks>; onMarker?: (marker: LinguisticMarkerId) => void; sessionId: string; origin: TranscriptOrigin }) {
  if (!links.length) return <Highlight text={text} query={query} />;
  const pieces = [];
  let cursor = 0;
  for (const link of links) {
    pieces.push(<Highlight key={`text-${cursor}`} text={text} query={query} start={cursor} end={link.start} />);
    const label = linguisticMarkers.find(item => item.id === link.marker)?.label.toLowerCase() || 'notation';
    pieces.push(<a key={`marker-${link.start}`} className="notation-marker-link" href={`/?marker=${encodeURIComponent(link.marker)}&speaker=any`}
      aria-label={`${text.slice(link.start, link.end)} — find ${label} across transcripts`}
      onClick={event => { trackArchiveEvent('notation_explore', { recordingId: sessionId, origin, marker: link.marker }); if (!onMarker || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return; event.preventDefault(); onMarker(link.marker); }}
      onAuxClick={event => { if (event.button === 1) trackArchiveEvent('notation_explore', { recordingId: sessionId, origin, marker: link.marker }); }}>
      <Highlight text={text} query={query} start={link.start} end={link.end} />
    </a>);
    cursor = link.end;
  }
  pieces.push(<Highlight key={`text-${cursor}`} text={text} query={query} start={cursor} />);
  return <>{pieces}</>;
}

export function SessionBody({
  session,
  targetPassage = null,
  onMarker,
  headingLevel = 3,
  momentsBeforePlayer = false,
  enableHashNavigation = false,
}: {
  session: Session;
  targetPassage?: number | null;
  onMarker?: (marker: LinguisticMarkerId, sourcePassage: number) => void;
  headingLevel?: 2 | 3;
  momentsBeforePlayer?: boolean;
  enableHashNavigation?: boolean;
}) {
  const SectionHeading = headingLevel === 2 ? 'h2' : 'h3';
  const MomentHeading = headingLevel === 2 ? 'h3' : 'h4';
  const [jump, setJump] = useState<{ index: number; serial: number } | null>(null);
  const [selectedPassage, setSelectedPassage] = useState<number | null>(targetPassage);
  const [message, setMessage] = useState('');
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const player = useRef<RecordingAudioHandle>(null);
  const playableRecordings = session.recordings.filter(recording => recording.format.toLowerCase() === 'mp3' && recording.available);
  const hasAudio = playableRecordings.length > 0;
  const canPlayAt = (at: number | null | undefined) => typeof at === 'number' && Number.isFinite(at) && at >= 0
    && playableRecordings.some(recording => recording.duration <= 0 || at < recording.duration);
  const activeIndex = useMemo(() => currentTime === null ? null : session.transcript.findIndex(passage =>
    typeof passage.start === 'number' && typeof passage.end === 'number'
    && passage.start <= currentTime && passage.end > currentTime), [currentTime, session.transcript]);
  const linkedIndex = selectedPassage !== null && Number.isSafeInteger(selectedPassage) && selectedPassage > 0 && selectedPassage <= session.transcript.length
    ? selectedPassage - 1
    : null;
  const targetPassageValid = targetPassage !== null && Number.isSafeInteger(targetPassage) && targetPassage > 0 && targetPassage <= session.transcript.length;

  useEffect(() => {
    if (targetPassage === null) {
      if (!enableHashNavigation) setSelectedPassage(null);
      return;
    }
    setSelectedPassage(targetPassage);
    if (!targetPassageValid) {
      setMessage(`Passage ${targetPassage} is outside this transcript. The available transcript is shown below.`);
      setJump(null);
      return;
    }
    setMessage(`Showing transcript passage ${targetPassage}, with surrounding passages for context.`);
    setJump(value => ({ index: targetPassage - 1, serial: (value?.serial || 0) + 1 }));
  }, [enableHashNavigation, targetPassage, targetPassageValid]);

  const jumpToPassage = useCallback((passageNumber: number) => {
    setSelectedPassage(passageNumber);
    if (!Number.isSafeInteger(passageNumber) || passageNumber < 1 || passageNumber > session.transcript.length) {
      setMessage(`Passage ${passageNumber} is outside this transcript. The available transcript is shown below.`);
      setJump(null);
      return;
    }
    setMessage(`Showing transcript passage ${passageNumber}, with surrounding passages for context.`);
    setJump(value => ({ index: passageNumber - 1, serial: (value?.serial || 0) + 1 }));
  }, [session.transcript.length]);

  const applySessionHash = useCallback((rawHash: string) => {
    const parsed = parseSessionHash(rawHash);
    if (!parsed) {
      setSelectedPassage(null);
      return;
    }
    if (parsed.kind === 'passage') {
      jumpToPassage(parsed.passage);
      return;
    }
    setSelectedPassage(null);
    const prepared = player.current?.prepareAt(parsed.seconds) ?? { status: 'no-audio' as const };
    const nearest = findNearestPassageIndex(session.transcript, parsed.seconds);
    setMessage(formatTimeReadyAnnouncement(parsed.seconds, prepared.status, {
      duration: prepared.status === 'out-of-range' ? prepared.duration : undefined,
      hasTimedPassage: nearest?.timed ?? false,
    }));
    if (nearest) {
      setJump(value => ({ index: nearest.index, serial: (value?.serial || 0) + 1 }));
    }
  }, [jumpToPassage, session.transcript]);

  useEffect(() => {
    if (!enableHashNavigation || typeof window === 'undefined') return;
    if (window.location.hash) {
      applySessionHash(window.location.hash);
    }
    const onHashChange = () => applySessionHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [applySessionHash, enableHashNavigation]);

  const readPassage = (at: number | null, source: 'moment' | 'current' = 'moment') => {
    trackArchiveEvent('transcript_jump', { recordingId: session.id, origin: session.origin, source, action: 'read' });
    const nearest = at !== null ? findNearestPassageIndex(session.transcript, at) : null;
    const targetIndex = nearest ? nearest.index : 0;
    setMessage(nearest?.timed && at !== null ? `Showing the transcript near ${timeLabel(at)}. Use the source locator to check the exact passage.` : 'Showing the transcript. Use the source locator to check the exact passage in the downloadable original.');
    setJump(value => ({ index: targetIndex, serial: (value?.serial || 0) + 1 }));
  };

  const audioSection = <RecordingAudio ref={player} sessionId={session.id} origin={session.origin} recordings={session.recordings} preferredRecordingId={session.preferredRecordingId} onTime={setCurrentTime} onPlaying={setPlaying} headingLevel={headingLevel} />;
  const momentsSection = <section id="moments" className="moments-section" aria-labelledby="moments-heading">
    <div className="section-heading"><div><p className="eyebrow">From the guide</p><SectionHeading id="moments-heading">Moments</SectionHeading></div><span className="muted small">{session.moments.length} {session.moments.length === 1 ? 'moment' : 'moments'}</span></div>
    <ol className="moment-list">
      {session.moments.map((moment, index) => <li key={`${index}-${moment.title}`}>
        <div className="moment-marker"><span className="moment-number">{String(index + 1).padStart(2, '0')}</span>{moment.start !== null && <span className="moment-time">{timeLabel(moment.start)}</span>}</div>
        <div className="moment-body"><MomentHeading>{moment.title}</MomentHeading><p>{moment.description}</p><p className="source-locator">{moment.locator}{moment.end !== null && moment.start !== null ? ` · ${timeLabel(moment.start)}–${timeLabel(moment.end)}` : ''}</p><div className="moment-actions">{canPlayAt(moment.start) && <button className="text-button small" type="button" onClick={() => {
          trackArchiveEvent('transcript_jump', { recordingId: session.id, origin: session.origin, source: 'moment', action: 'listen' });
          player.current?.playAt(moment.start!);
        }} aria-label={`Listen from ${timeLabel(moment.start!)}: ${moment.title}`}><Play size={14} aria-hidden="true" />Listen from {timeLabel(moment.start!)}</button>}<button className="text-button small" type="button" onClick={() => readPassage(moment.start)} aria-label={`Read in the transcript: ${moment.title}`}>Read in the transcript<ArrowDown size={14} aria-hidden="true" /></button></div></div>
      </li>)}
    </ol>
  </section>;

  return <>
    {momentsBeforePlayer ? <>{momentsSection}{audioSection}</> : <>{audioSection}{momentsSection}</>}
    <Transcript
      session={session}
      jump={jump}
      message={message}
      linkedIndex={linkedIndex}
      autoShowNotation={targetPassageValid}
      activeIndex={activeIndex}
      playing={playing}
      hasAudio={hasAudio}
      canPlayAt={canPlayAt}
      headingLevel={headingLevel}
      enableHashNavigation={enableHashNavigation}
      onSelectPassage={jumpToPassage}
      onPlayAt={at => {
        trackArchiveEvent('transcript_jump', { recordingId: session.id, origin: session.origin, source: 'cue', action: 'listen' });
        player.current?.playAt(at);
      }}
      onTogglePlayback={() => player.current?.toggle()}
      onCurrentPassage={() => readPassage(currentTime, 'current')}
      onMarker={onMarker}
    />
  </>;
}

function Transcript({
  session,
  jump,
  message,
  linkedIndex,
  autoShowNotation,
  activeIndex,
  playing,
  hasAudio,
  canPlayAt,
  headingLevel,
  enableHashNavigation,
  onSelectPassage,
  onPlayAt,
  onTogglePlayback,
  onCurrentPassage,
  onMarker,
}: {
  session: Session;
  jump: { index: number; serial: number } | null;
  message: string;
  linkedIndex: number | null;
  autoShowNotation: boolean;
  activeIndex: number | null;
  playing: boolean;
  hasAudio: boolean;
  canPlayAt: (at: number | null | undefined) => boolean;
  headingLevel: 2 | 3;
  enableHashNavigation: boolean;
  onSelectPassage: (passageNumber: number) => void;
  onPlayAt: (at: number) => void;
  onTogglePlayback: () => void;
  onCurrentPassage: () => void;
  onMarker?: (marker: LinguisticMarkerId, sourcePassage: number) => void;
}) {
  const SectionHeading = headingLevel === 2 ? 'h2' : 'h3';
  const [query, setQuery] = useState('');
  const findEdited = useRef(false);
  const [follow, setFollow] = useState(false);
  const hasChatNotation = session.origin === 'archived_research' || session.origin === 'talkbank_ai_draft';
  const [showNotation, setShowNotation] = useState(hasChatNotation && autoShowNotation);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [copiedPassage, setCopiedPassage] = useState<number | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const [manualCopy, setManualCopy] = useState<{ passage: number; url: string } | null>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualCopyInput = useRef<HTMLInputElement>(null);

  // Inspectable source notation is the initial view for exact linguistic passage links.
  // Playback and ordinary passage jumps do not override a reader's choice.
  useEffect(() => {
    if (hasChatNotation && autoShowNotation) setShowNotation(true);
  }, [hasChatNotation, autoShowNotation]);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  useEffect(() => {
    if (manualCopy) {
      manualCopyInput.current?.focus();
      manualCopyInput.current?.select();
    }
  }, [manualCopy]);

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

  const [pendingFocus, setPendingFocus] = useState<{ index: number; serial: number } | null>(null);
  const rows = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    if (!jump || !Number.isInteger(jump.index) || jump.index < 0 || jump.index >= session.transcript.length) return;
    setQuery('');
    setFollow(false);
    setPendingFocus(jump);
  }, [session.transcript.length, jump]);

  useEffect(() => {
    if (!pendingFocus) return;
    const row = rows.current.get(pendingFocus.index);
    if (!row) return;
    row.scrollIntoView({ block: 'start', behavior: 'instant' });
    row.focus({ preventScroll: true });
    // Re-align once after layout/sticky heights settle (e.g. content-visibility rows above).
    const frame = window.requestAnimationFrame(() => {
      row.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    setPendingFocus(null);
    return () => window.cancelAnimationFrame(frame);
  }, [pendingFocus, query]);

  useEffect(() => {
    if (!follow || !playing || query.trim() || activeIndex === null || activeIndex < 0) return;
    rows.current.get(activeIndex)?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [activeIndex, follow, playing, query, toolbarHeight]);

  const displayRows = useMemo(() => session.transcript.map((passage, index) => ({
    passage, index, text: showNotation ? passage.text : readingText(passage, session.origin),
    links: showNotation ? getNotationLinks(passage, session.origin) : [],
  })), [session.origin, session.transcript, showNotation]);

  const results = useMemo(() => displayRows.filter(({ passage, text }) => !query.trim() || `${passage.speaker || ''} ${text}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [displayRows, query]);

  useEffect(() => {
    if (!findEdited.current || !query.trim()) return;
    const timer = window.setTimeout(() => {
      findEdited.current = false;
      trackArchiveEvent('transcript_find', { recordingId: session.id, origin: session.origin, queryLength: Math.min(300, query.trim().length), results: results.length, notation: showNotation });
    }, 750);
    return () => window.clearTimeout(timer);
  }, [session.id, session.origin, query, results.length, showNotation]);

  const copyPassageLink = async (passageNumber: number) => {
    const slug = session.slug || session.id;
    const url = formatCanonicalPassageUrl(slug, passageNumber, window.location.origin);
    setManualCopy(null);
    setCopyMessage('');
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(url);
      setCopiedPassage(passageNumber);
      setCopyMessage(`Copied link to passage ${passageNumber}.`);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => {
        setCopiedPassage(current => (current === passageNumber ? null : current));
      }, 4000);
    } catch {
      setCopiedPassage(null);
      setManualCopy({ passage: passageNumber, url });
      setCopyMessage(`Could not copy automatically. Select and copy the link to passage ${passageNumber} below.`);
    }
  };

  return <section id="transcript" className="transcript-section" aria-labelledby="transcript-heading" style={{ '--transcript-toolbar-height': `${toolbarHeight}px` } as CSSProperties}>
    <div className="section-heading"><div><p className="eyebrow">The source text</p><SectionHeading id="transcript-heading">Transcript</SectionHeading></div><span className={`origin-badge ${session.origin}`}>{transcriptOriginLabels[session.origin]}</span></div>
    <p className="small muted">{session.origin === 'archived_research' ? 'A readable view of the archived research transcript. Original notation is retained in the downloadable source files.' : 'Machine-generated draft: words, speakers, and timestamps may be wrong. Check the recording before treating a passage as evidence.'}</p>
    {hasAudio && <div ref={toolbar} className="transcript-playback-tools" role="group" aria-label="Transcript playback controls"><button type="button" className="button secondary" onClick={onTogglePlayback}>{playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{playing ? 'Pause audio' : 'Play audio'}</button><button type="button" className="button secondary" onClick={onCurrentPassage} disabled={activeIndex === null || activeIndex < 0}>Current passage</button><label className="follow-control"><input type="checkbox" checked={follow} onChange={event => {
      setFollow(event.target.checked);
      trackArchiveEvent('transcript_follow', { recordingId: session.id, origin: session.origin, enabled: event.target.checked });
    }} />Follow playback</label></div>}
    {follow && query.trim() && <p className="small muted">Clear the transcript search to follow playback.</p>}
    {hasChatNotation ? <div className="transcript-view-controls"><label className="follow-control"><input type="checkbox" checked={showNotation} aria-describedby="transcript-notation-help" onChange={event => {
      setShowNotation(event.target.checked);
      trackArchiveEvent('notation_toggle', { recordingId: session.id, origin: session.origin, enabled: event.target.checked });
    }} />Show linguistic notation</label><p id="transcript-notation-help" className="small muted">Off: an easier reading view with research codes and dependent notes hidden. Partial-word spellings and uncertainty remain. On: the notation and notes stored in this reading copy; full analysis tiers are in the downloadable CHAT source. This changes only the display; source files are unchanged.</p>{showNotation && <p className="small muted">Linked repetition, retracing, and pause symbols find matching passages across transcripts, initially including any speaker.</p>}</div> : <p className="small muted transcript-view-controls">This local AI draft has no CHAT notation layer to switch on. Its text is displayed unchanged.</p>}
    <div className="transcript-search field"><label htmlFor="transcript-query">Find within this transcript</label><div className="search-input"><Search size={18} aria-hidden="true" /><input id="transcript-query" type="search" value={query} onChange={event => { findEdited.current = true; setQuery(event.target.value); }} placeholder="A word, name, or phrase" autoComplete="off" spellCheck={false} aria-describedby="transcript-search-help" /></div><p id="transcript-search-help" className="small muted">Searches the text currently displayed, including speaker labels and visible source notes.</p></div>
    <p className="small muted" role="status">{query.trim() ? `${results.length.toLocaleString()} matching ${results.length === 1 ? 'passage' : 'passages'}` : `${session.transcript.length.toLocaleString()} transcript ${session.transcript.length === 1 ? 'passage' : 'passages'}`}</p>
    <p className="small muted transcript-live-status" role="status" aria-live="polite" aria-atomic="true">{message}</p>
    <p className="small muted transcript-copy-status" role="status" aria-live="polite" aria-atomic="true">{copyMessage}</p>
    {manualCopy && (
      <div className="passage-manual-copy">
        <label htmlFor="manual-passage-link">Link to passage {manualCopy.passage}</label>
        <div>
          <input ref={manualCopyInput} id="manual-passage-link" value={manualCopy.url} readOnly />
          <button
            type="button"
            className="button secondary"
            onClick={() => setManualCopy(null)}
          >
            <X size={16} aria-hidden="true" />Close
          </button>
        </div>
      </div>
    )}
    <div className="transcript-lines">
      {results.map(({ passage, index, text, links }) => {
        const passageNumber = index + 1;
        const isCopied = copiedPassage === passageNumber;
        return (
          <div
            className={`transcript-line${activeIndex === index ? ' is-current' : ''}${linkedIndex === index ? ' is-linked' : ''}`}
            id={`p${passageNumber}`}
            key={index}
            tabIndex={-1}
            aria-current={activeIndex === index ? 'true' : undefined}
            ref={node => { if (node) rows.current.set(index, node); else rows.current.delete(index); }}
          >
            <div className="transcript-cue">
              <a
                className="passage-anchor"
                href={`#p${passageNumber}`}
                onClick={event => {
                  if (!enableHashNavigation) {
                    event.preventDefault();
                    onSelectPassage(passageNumber);
                  } else if (window.location.hash.toLowerCase() === `#p${passageNumber}`) {
                    onSelectPassage(passageNumber);
                  }
                }}
              >
                <span className="sr-only">Passage </span><span aria-hidden="true">#</span>{passageNumber}
              </a>
              {canPlayAt(passage.start) ? (
                <button
                  className="cue-button"
                  type="button"
                  onClick={() => onPlayAt(passage.start!)}
                  aria-label={`Play transcript passage ${passageNumber} at ${timeLabel(passage.start!)}`}
                >
                  <Play size={11} aria-hidden="true" />
                  {timeLabel(passage.start!)}
                </button>
              ) : typeof passage.start === 'number' ? (
                <span className="small muted transcript-timestamp">{timeLabel(passage.start)}</span>
              ) : null}
            </div>
            <p className="transcript-text">
              {passage.speaker && <span className="speaker">{passage.speaker}: </span>}
              <TranscriptText
                sessionId={session.id}
                origin={session.origin}
                text={text}
                query={query}
                links={links}
                onMarker={onMarker ? marker => onMarker(marker, passageNumber) : undefined}
              />
            </p>
            <div className="passage-actions">
              <button
                type="button"
                className={`passage-copy-button${isCopied ? ' is-copied' : ''}`}
                onClick={() => void copyPassageLink(passageNumber)}
                aria-label={isCopied ? `Copied link to passage ${passageNumber}` : `Copy link to passage ${passageNumber}`}
              >
                {isCopied ? <Check size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
                <span>{isCopied ? 'Copied' : 'Copy link'}</span>
              </button>
              <CitePassageButton passageNumber={passageNumber} />
            </div>
          </div>
        );
      })}
      {!results.length && <p className="empty-inline">No matching passages. Try a different word or clear your search.</p>}
    </div>
  </section>;
}

export function SessionSources({ session, headingLevel = 3 }: { session: Session; headingLevel?: 2 | 3 }) {
  const SectionHeading = headingLevel === 2 ? 'h2' : 'h3';
  return <section className="source-section" aria-labelledby="sources-heading">
    <p className="eyebrow">Keep the evidence in view</p><SectionHeading id="sources-heading">Sources &amp; reading notes</SectionHeading>
    {session.limits.length > 0 && <ul className="reading-notes">{session.limits.map((limit, index) => <li key={index}>{limit}</li>)}</ul>}
    <div className="source-downloads">{session.sources.map(source => <a key={source.id} href={`/api/assets/${encodeURIComponent(source.id)}`} className="download-link" download={source.name} referrerPolicy="no-referrer" onClick={() => {
      const format = ['cha', 'txt', 'json', 'vtt', 'md', 'html'].includes(source.format.toLowerCase()) ? source.format.toLowerCase() : 'other';
      const category = format === 'cha' ? 'chat' : ['txt', 'json', 'vtt'].includes(format) ? 'transcript' : ['md', 'html'].includes(format) ? 'guide' : 'other';
      trackArchiveEvent('source_download', { recordingId: session.id, origin: session.origin, format, category });
    }}><Download size={18} aria-hidden="true" /><span><strong>{source.label}</strong><span className="small muted">{source.name} · {source.format.toUpperCase()}</span></span></a>)}</div>
    <details className="technical-notes"><summary>Source identification</summary><p>{session.association}</p><p><strong>Source file: </strong><code>{session.sourceName}</code></p>{session.ages.length > 0 && <p><strong>Stored age notation (CHAT): </strong>{session.ages.join(' / ')}</p>}{session.ages.length === 0 && session.inferredAge && <p><strong>Inferred age notation (from filename): </strong>{session.inferredAge}</p>}<p className="small">Source SHA-256</p><code>{session.sourceSha256}</code></details>
  </section>;
}

export default function SessionDetail({ id, passage = null, onBack, onMarker, onDocument, onSessionState }: {
  id: string;
  passage?: number | null;
  onBack: () => void;
  onMarker: (marker: LinguisticMarkerId, sourcePassage: number) => void;
  onDocument: (id: string) => void;
  onSessionState?: (state: { id: string; title: string | null; notFound: boolean }) => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [retry, setRetry] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setSession(null);
    setError('');
    setNotFound(false);
    void request<Session>(`/api/entries/${encodeURIComponent(id)}`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setSession(data);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      const missing = reason instanceof ApiError && reason.status === 404;
      setNotFound(missing);
      setError(missing ? 'This session could not be found.' : 'This session could not be loaded. Please try again.');
    });
    return () => controller.abort();
  }, [id, retry]);

  useEffect(() => {
    onSessionState?.({ id, title: session?.id === id ? session.title : null, notFound });
  }, [session, id, notFound, onSessionState]);

  useEffect(() => {
    if (session) trackArchiveEvent('recording_view', { recordingId: session.id, origin: session.origin });
  }, [session]);

  useEffect(() => {
    if (session && (passage === null || !Number.isSafeInteger(passage) || passage < 1 || passage > session.transcript.length)) heading.current?.focus();
  }, [session, passage]);

  return <article className="session-detail">
    <button type="button" className="text-button back-button" onClick={onBack}><ArrowLeft size={17} aria-hidden="true" />Back to sessions</button>
    {error ? <div className="error-panel" role="alert"><p>{error}</p><button className="button secondary" type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : !session ? <p className="loading-message" role="status">Opening the session…</p> : (
      <SessionCiteProvider
        session={{
          slug: session.slug || session.id,
          ages: session.ages,
          inferredAge: session.inferredAge,
          dates: session.dates,
          origin: session.origin,
        }}
      >
        <header className="detail-header">
          <div className="session-meta"><span className="eyebrow">Session</span><span>{session.sourceName}</span><SessionAge ages={session.ages} inferredAge={session.inferredAge} onDocument={onDocument} />{session.dates.length > 0 && <span>{session.dates.join(' / ')}</span>}</div>
          <h2 ref={heading} tabIndex={-1}>{session.title}</h2>
          <div className="badge-row"><span className="ai-badge">AI-written guide</span><span className={`origin-badge ${session.origin}`}>{transcriptOriginLabels[session.origin]}</span></div>
          <p className="detail-overview">{session.overview}</p>
          <TopicLabels topics={session.topics} />
        </header>
        <div className="provenance-note"><p><strong>About this guide.</strong> This overview, its themes, and its moments were written with AI from the transcript. They are a starting point for exploring the session; they are not part of the source transcript or an independently verified account of the recordings.</p></div>
        <SessionBody key={session.id} session={session} targetPassage={passage} onMarker={onMarker} />
        <SessionSources session={session} />
      </SessionCiteProvider>
    )}
  </article>;
}
