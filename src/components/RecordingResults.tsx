import { ArrowRight, Headphones } from 'lucide-react';
import { trackArchiveEvent } from '../lib/analytics';
import { formatAge } from '../lib/age';
import { linguisticMarkers, type LinguisticSpeaker } from '../lib/linguistic-markers';
import type { SearchResult } from '../lib/types';
import { originLabels, timeLabel } from './api';
import { TopicLabels } from './TopicThemes';

export type RecordingView = 'details' | 'list';

function shortSummary(text: string): string {
  const words = text.trim().split(/\s+/);
  let summary = '';
  for (const word of words) {
    if (summary && summary.length + word.length + 1 > 180) return `${summary}…`;
    summary += `${summary ? ' ' : ''}${word}`;
  }
  return summary;
}

function SearchExcerpt({ result }: { result: SearchResult }) {
  if (result.matchedIn === 'browse' || !result.excerpt) return null;
  return <div className="search-excerpt"><span className="excerpt-label">{result.matchedIn === 'transcript' ? 'From the transcript' : 'From the guide'}</span><p>{result.excerpt}</p></div>;
}

function MatchingPassages({ result, speaker, view, onPassage }: { result: SearchResult; speaker: LinguisticSpeaker; view: RecordingView; onPassage: (id: string, passage: number) => void }) {
  const evidence = result.linguisticEvidence;
  if (!evidence) return null;
  const definition = linguisticMarkers.find(item => item.id === evidence.marker);
  return <div className="linguistic-evidence">
    <p className="linguistic-evidence-heading"><strong>{definition?.label || 'Linguistic marker'}</strong><span>{evidence.count.toLocaleString()} matching {evidence.count === 1 ? 'passage' : 'passages'}</span></p>
    <p className="small muted linguistic-evidence-kind">{definition?.kind === 'chat' ? 'Source CHAT notation' : 'Automatic text-pattern matches'} · {speaker === 'child' ? 'Seth (CHI) only' : 'Any speaker / unidentified'}{evidence.count > evidence.examples.length ? ` · showing ${evidence.examples.length} examples` : ''}</p>
    <ol className="linguistic-examples">{evidence.examples.map(example => <li key={example.segmentIndex}>
      <p className="small muted linguistic-example-locator">Passage {example.segmentIndex + 1}{example.speaker ? ` · ${example.speaker}` : ' · Speaker unidentified'}{typeof example.start === 'number' && Number.isFinite(example.start) && example.start >= 0 ? ` · ${timeLabel(example.start)}` : ''}</p>
      <blockquote><p>{example.text}</p></blockquote>
      <a className="text-link small" href={`?entry=${encodeURIComponent(result.entry.id)}&passage=${example.segmentIndex + 1}`} onClick={event => { trackArchiveEvent('recording_open', { recordingId: result.entry.id, origin: result.entry.origin, view, action: 'passage', passage: example.segmentIndex + 1 }); if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return; event.preventDefault(); onPassage(result.entry.id, example.segmentIndex + 1); }} onAuxClick={event => { if (event.button === 1) trackArchiveEvent('recording_open', { recordingId: result.entry.id, origin: result.entry.origin, view, action: 'passage', passage: example.segmentIndex + 1 }); }} aria-label={`Read in the transcript: passage ${example.segmentIndex + 1}, ${result.entry.title}`}>Read in the transcript<ArrowRight size={15} aria-hidden="true" /></a>
    </li>)}</ol>
  </div>;
}

export default function RecordingResults({ results, view, firstIndex, speaker, onEntry, onPassage }: {
  results: SearchResult[];
  view: RecordingView;
  firstIndex: number;
  speaker: LinguisticSpeaker;
  onEntry: (id: string) => void;
  onPassage: (id: string, passage: number) => void;
}) {
  const rows = results.map((result, index) => {
    const { entry, matchedIn, excerpt, linguisticEvidence } = result;
    const hasMatches = Boolean(linguisticEvidence || (matchedIn !== 'browse' && excerpt));
    const markerLabel = linguisticEvidence && linguisticMarkers.find(item => item.id === linguisticEvidence.marker)?.label;
    const headingId = `result-${entry.id}`;
    const content = <article className={view === 'list' ? 'recording-list-row' : 'recording-card'} aria-labelledby={headingId}>
      <div className="recording-index" aria-hidden="true">{String(firstIndex + index).padStart(2, '0')}</div>
      <div className="recording-card-body">
        <div className="entry-meta"><span>{entry.sourceName}</span>{entry.ages.length > 0 && <span>Age {entry.ages.map(formatAge).join(' / ')}</span>}{entry.dates.length > 0 && <span>{entry.dates.join(' / ')}</span>}</div>
        <h4 id={headingId}><a href={`?entry=${encodeURIComponent(entry.id)}`} onClick={event => { trackArchiveEvent('recording_open', { recordingId: entry.id, origin: entry.origin, view, action: 'guide' }); if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return; event.preventDefault(); onEntry(entry.id); }} onAuxClick={event => { if (event.button === 1) trackArchiveEvent('recording_open', { recordingId: entry.id, origin: entry.origin, view, action: 'guide' }); }}>{entry.title}<ArrowRight size={view === 'list' ? 17 : 20} aria-hidden="true" /></a></h4>
        <p className="card-overview">{view === 'list' ? shortSummary(entry.overview) : entry.overview}</p>
        {view === 'details' && <><SearchExcerpt result={result} /><MatchingPassages result={result} speaker={speaker} view={view} onPassage={onPassage} /></>}
        <div className="card-bottom"><span className={`origin-badge ${entry.origin}`}>{originLabels[entry.origin]}</span>{view === 'details' && <span className="audio-count small muted"><Headphones size={15} aria-hidden="true" />{entry.audio.some(file => file.available && file.format.toLowerCase() === 'mp3') ? 'MP3 playback available' : entry.audio.length ? 'MP3 playback not yet available' : 'Transcript only'}</span>}</div>
        {view === 'details' ? <TopicLabels topics={entry.topics} compact /> : hasMatches && <details className="compact-result-matches" key={`${entry.id}-${linguisticEvidence?.marker || 'text'}-${speaker}`}>
          <summary>{linguisticEvidence ? <>Matching passages <span className="small muted">· {linguisticEvidence.count.toLocaleString()} · {markerLabel}</span></> : <>Search match <span className="small muted">· {matchedIn === 'transcript' ? 'transcript' : 'guide'}</span></>}</summary>
          <SearchExcerpt result={result} /><MatchingPassages result={result} speaker={speaker} view={view} onPassage={onPassage} />
        </details>}
      </div>
    </article>;
    return view === 'list' ? <li key={entry.id}>{content}</li> : <div key={entry.id}>{content}</div>;
  });
  return view === 'list' ? <ol className="recordings-compact-list" role="list" start={firstIndex}>{rows}</ol> : <>{rows}</>;
}
