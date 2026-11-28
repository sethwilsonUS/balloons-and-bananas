'use client';

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowDown, Check, Download, Link2, Search, X } from 'lucide-react';
import type { Session, TranscriptOrigin } from '../lib/types';
import { trackArchiveEvent } from '../lib/analytics';
import { getNotationLinks, readingText } from '../lib/transcript-display';
import { linguisticMarkers } from '../lib/linguistic-markers';
import {
  findNearestPassageIndex,
  formatCanonicalPassageUrl,
  formatTimeLinkAnnouncement,
  parseSessionHash,
} from '../lib/session-reading';
import { timeLabel, transcriptOriginLabels } from './api';
import { CitePassageButton } from './CiteControl';

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

function TranscriptText({ text, query, links, sessionId, origin }: { text: string; query: string; links: ReturnType<typeof getNotationLinks>; sessionId: string; origin: TranscriptOrigin }) {
  if (!links.length) return <Highlight text={text} query={query} />;
  const pieces = [];
  let cursor = 0;
  for (const link of links) {
    pieces.push(<Highlight key={`text-${cursor}`} text={text} query={query} start={cursor} end={link.start} />);
    const label = linguisticMarkers.find(item => item.id === link.marker)?.label.toLowerCase() || 'notation';
    pieces.push(<a key={`marker-${link.start}`} className="notation-marker-link" href={`/search?marker=${encodeURIComponent(link.marker)}&speaker=any`}
      aria-label={`${text.slice(link.start, link.end)} — find ${label} across transcripts`}
      onClick={() => trackArchiveEvent('notation_explore', { recordingId: sessionId, origin, marker: link.marker })}
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
  printCitation,
}: {
  session: Session;
  printCitation?: ReactNode;
}) {
  const [jump, setJump] = useState<{ index: number; serial: number } | null>(null);
  const [selectedPassage, setSelectedPassage] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const linkedIndex = selectedPassage !== null && Number.isSafeInteger(selectedPassage) && selectedPassage > 0 && selectedPassage <= session.transcript.length
    ? selectedPassage - 1
    : null;

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
    // `#t=` links are transcript-only: they scroll to and highlight the nearest
    // timestamped passage and never touch the recording player.
    const nearest = findNearestPassageIndex(session.transcript, parsed.seconds);
    setSelectedPassage(nearest?.timed ? nearest.index + 1 : null);
    setMessage(formatTimeLinkAnnouncement(parsed.seconds, nearest ? { passage: nearest.index + 1, timed: nearest.timed } : null));
    if (nearest) {
      setJump(value => ({ index: nearest.index, serial: (value?.serial || 0) + 1 }));
    }
  }, [jumpToPassage, session.transcript]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash) {
      applySessionHash(window.location.hash);
    }
    const onHashChange = () => applySessionHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [applySessionHash]);

  const readPassage = (at: number | null) => {
    trackArchiveEvent('transcript_jump', { recordingId: session.id, origin: session.origin, source: 'moment', action: 'read' });
    const nearest = at !== null ? findNearestPassageIndex(session.transcript, at) : null;
    const targetIndex = nearest ? nearest.index : 0;
    setMessage(nearest?.timed && at !== null ? `Showing the transcript near ${timeLabel(at)}. Use the source locator to check the exact passage.` : 'Showing the transcript. Use the source locator to check the exact passage in the downloadable original.');
    setJump(value => ({ index: targetIndex, serial: (value?.serial || 0) + 1 }));
  };

  return <>
    <section id="moments" className="moments-section" aria-labelledby="moments-heading">
      <div className="section-heading">
        <h2 id="moments-heading">Moments</h2>
        <span className="muted small">{session.moments.length} {session.moments.length === 1 ? 'moment' : 'moments'}</span>
      </div>
      <ol className="moment-list">
        {session.moments.map((moment, index) => <li key={`${index}-${moment.title}`}>
          <div className="moment-marker"><span className="moment-number">{String(index + 1).padStart(2, '0')}</span>{moment.start !== null && <span className="moment-time">{timeLabel(moment.start)}</span>}</div>
          <div className="moment-body"><h3>{moment.title}</h3><p>{moment.description}</p><p className="source-locator">{moment.locator}{moment.end !== null && moment.start !== null ? ` · ${timeLabel(moment.start)}–${timeLabel(moment.end)}` : ''}</p><div className="moment-actions"><button className="text-button small" type="button" onClick={() => readPassage(moment.start)} aria-label={`Read in the transcript: ${moment.title}`}>Read in the transcript<ArrowDown size={14} aria-hidden="true" /></button></div></div>
        </li>)}
      </ol>
    </section>
    {printCitation}
    <Transcript
      session={session}
      jump={jump}
      message={message}
      linkedIndex={linkedIndex}
      onSelectPassage={jumpToPassage}
    />
  </>;
}

function Transcript({
  session,
  jump,
  message,
  linkedIndex,
  onSelectPassage,
}: {
  session: Session;
  jump: { index: number; serial: number } | null;
  message: string;
  linkedIndex: number | null;
  onSelectPassage: (passageNumber: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [isPrinting, setIsPrinting] = useState(false);
  const findEdited = useRef(false);
  const hasChatNotation = session.origin === 'archived_research' || session.origin === 'talkbank_ai_draft';
  const [showNotation, setShowNotation] = useState(false);
  const [copiedPassage, setCopiedPassage] = useState<number | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  const [manualCopy, setManualCopy] = useState<{ passage: number; url: string } | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualCopyInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  // Ensure print output always includes the full numbered transcript even when
  // the reader has an active Find filter, without modifying the screen query.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia('print') : null;
    let beforePrintActive = false;

    const applyPrintState = (sync: boolean) => {
      const next = beforePrintActive || Boolean(mql?.matches);
      if (sync) {
        flushSync(() => setIsPrinting(next));
      } else {
        setIsPrinting(next);
      }
    };

    if (mql?.matches) {
      setIsPrinting(true);
    }

    const handleBeforePrint = () => {
      beforePrintActive = true;
      applyPrintState(true);
    };
    const handleAfterPrint = () => {
      beforePrintActive = false;
      applyPrintState(false);
    };
    const handleMediaChange = () => {
      applyPrintState(true);
    };

    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);
    if (mql && typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleMediaChange);
    }
    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
      if (mql && typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', handleMediaChange);
      }
    };
  }, []);

  useEffect(() => {
    if (manualCopy) {
      manualCopyInput.current?.focus();
      manualCopyInput.current?.select();
    }
  }, [manualCopy]);

  const [pendingFocus, setPendingFocus] = useState<{ index: number; serial: number } | null>(null);
  const rows = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    if (!jump || !Number.isInteger(jump.index) || jump.index < 0 || jump.index >= session.transcript.length) return;
    setQuery('');
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

  const displayRows = useMemo(() => session.transcript.map((passage, index) => ({
    passage, index, text: showNotation ? passage.text : readingText(passage, session.origin),
    links: showNotation ? getNotationLinks(passage, session.origin) : [],
  })), [session.origin, session.transcript, showNotation]);

  const results = useMemo(() => displayRows.filter(({ passage, text }) => !query.trim() || `${passage.speaker || ''} ${text}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [displayRows, query]);
  const visibleRows = isPrinting ? displayRows : results;
  const activeQuery = isPrinting ? '' : query;

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

  return <section id="transcript" className="transcript-section" aria-labelledby="transcript-heading" tabIndex={-1}>
    <div className="section-heading">
      <h2 id="transcript-heading">Transcript</h2>
      <div className="transcript-provenance-badges">
        <span className={`origin-badge ${session.origin}`}>{transcriptOriginLabels[session.origin]}</span>
        {session.origin !== 'archived_research' && (
          <a className="small provenance-link" href="/about#transcript-origins">
            Unreviewed machine transcription
          </a>
        )}
      </div>
    </div>
    <p className="small muted">
      {session.origin === 'archived_research'
        ? <>Readable view of the archived research transcript; full CHAT notation stays in the downloadable source.{' '}<a href="/about#transcript-origins">Learn more</a></>
        : <>Unreviewed machine draft — check the recording before treating wording or speakers as evidence.{' '}<a href="/about#transcript-origins">Learn more</a></>}
    </p>
    {hasChatNotation ? <div className="transcript-view-controls"><label className="follow-control"><input type="checkbox" checked={showNotation} aria-describedby="transcript-notation-help" onChange={event => {
      setShowNotation(event.target.checked);
      trackArchiveEvent('notation_toggle', { recordingId: session.id, origin: session.origin, enabled: event.target.checked });
    }} />Show linguistic notation</label><p id="transcript-notation-help" className="small muted">Displays stored CHAT codes and notes without altering source files.</p>{showNotation && <p className="small muted">Linked symbols search matching passages across all transcripts.</p>}</div> : <p className="small muted transcript-view-controls">Local AI draft displayed as generated (no CHAT notation layer).</p>}
    <div className="transcript-search field"><label htmlFor="transcript-query">Find within this transcript</label><div className="search-input"><Search size={18} aria-hidden="true" /><input id="transcript-query" type="search" value={query} onChange={event => { findEdited.current = true; setQuery(event.target.value); }} placeholder="A word, name, or phrase" autoComplete="off" spellCheck={false} aria-describedby="transcript-search-help" /></div><p id="transcript-search-help" className="small muted">Searches displayed text and speaker labels.</p></div>
    <p className="small muted" role="status">{activeQuery.trim() ? `${results.length.toLocaleString()} matching ${results.length === 1 ? 'passage' : 'passages'}` : `${session.transcript.length.toLocaleString()} transcript ${session.transcript.length === 1 ? 'passage' : 'passages'}`}</p>
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
      {visibleRows.map(({ passage, index, text, links }) => {
        const passageNumber = index + 1;
        const isCopied = copiedPassage === passageNumber;
        return (
          <div
            className={`transcript-line${linkedIndex === index ? ' is-linked' : ''}`}
            id={`p${passageNumber}`}
            key={index}
            tabIndex={-1}
            ref={node => { if (node) rows.current.set(index, node); else rows.current.delete(index); }}
          >
            <div className="transcript-cue">
              <a
                className="passage-anchor"
                href={`#p${passageNumber}`}
                onClick={() => {
                  if (window.location.hash.toLowerCase() === `#p${passageNumber}`) {
                    onSelectPassage(passageNumber);
                  }
                }}
              >
                <span className="sr-only">Passage </span><span aria-hidden="true">#</span>{passageNumber}
              </a>
              {typeof passage.start === 'number' && (
                <span className="small muted transcript-timestamp">{timeLabel(passage.start)}</span>
              )}
            </div>
            <p className="transcript-text">
              {passage.speaker && <span className="speaker">{passage.speaker}: </span>}
              <TranscriptText
                sessionId={session.id}
                origin={session.origin}
                text={text}
                query={activeQuery}
                links={links}
              />
            </p>
            <div className="passage-actions">
              <button
                type="button"
                className="text-button passage-copy-button"
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
      {!visibleRows.length && <p className="empty-inline">No matching passages. Try a different word or clear your search.</p>}
    </div>
  </section>;
}

export function SessionSources({ session }: { session: Session }) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const wasOpenBeforePrintRef = useRef<boolean | null>(null);

  useEffect(() => {
    wasOpenBeforePrintRef.current = null;
    if (typeof window === 'undefined') return;
    const details = detailsRef.current;
    if (!details) return;
    const handleBeforePrint = () => {
      if (wasOpenBeforePrintRef.current === null) {
        wasOpenBeforePrintRef.current = details.open;
      }
      details.open = true;
    };
    const handleAfterPrint = () => {
      if (wasOpenBeforePrintRef.current === null) return;
      details.open = wasOpenBeforePrintRef.current;
      wasOpenBeforePrintRef.current = null;
    };
    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
      if (wasOpenBeforePrintRef.current !== null) {
        details.open = wasOpenBeforePrintRef.current;
        wasOpenBeforePrintRef.current = null;
      }
    };
  }, [session.id]);

  return <section className="source-section" aria-labelledby="sources-heading">
    <h2 id="sources-heading">Sources &amp; reading notes</h2>
    {session.limits.length > 0 && <ul className="reading-notes">{session.limits.map((limit, index) => <li key={index}>{limit}</li>)}</ul>}
    <div className="source-downloads">{session.sources.map(source => <a key={source.id} href={`/api/assets/${encodeURIComponent(source.id)}`} className="text-link download-link" download={source.name} referrerPolicy="no-referrer" onClick={() => {
      const format = ['cha', 'txt', 'json', 'vtt', 'md', 'html'].includes(source.format.toLowerCase()) ? source.format.toLowerCase() : 'other';
      const category = format === 'cha' ? 'chat' : ['txt', 'json', 'vtt'].includes(format) ? 'transcript' : ['md', 'html'].includes(format) ? 'guide' : 'other';
      trackArchiveEvent('source_download', { recordingId: session.id, origin: session.origin, format, category });
    }}><Download size={18} aria-hidden="true" /><span><strong>{source.label}</strong><span className="small muted">{source.name} · {source.format.toUpperCase()}</span></span></a>)}</div>
    <details ref={detailsRef} className="technical-notes"><summary>Source identification</summary><p>{session.association}</p><p><strong>Source file: </strong><code>{session.sourceName}</code></p>{session.ages.length > 0 && <p><strong>Stored age notation (CHAT): </strong>{session.ages.join(' / ')}</p>}{session.ages.length === 0 && session.inferredAge && <p><strong>Inferred age notation (from filename): </strong>{session.inferredAge}</p>}<p className="small">Source SHA-256</p><code>{session.sourceSha256}</code></details>
  </section>;
}
