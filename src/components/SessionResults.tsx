import { ArrowRight, Headphones } from 'lucide-react';
import { trackArchiveEvent } from '../lib/analytics';
import { linguisticMarkers, type LinguisticSpeaker } from '../lib/linguistic-markers';
import { shortOverview, visibleExcerpt, type SessionView } from '../lib/results-view';
import { buildSessionHrefFromSearch } from '../lib/search-params';
import type { SearchResult } from '../lib/types';
import { timeLabel, transcriptOriginLabels } from './api';
import SessionAge from './SessionAge';
import { TopicLabels } from './TopicThemes';

export type { SessionView };

function SearchExcerpt({
  result,
  excerpt,
  showPassageTag = false,
}: {
  result: SearchResult;
  excerpt: string;
  showPassageTag?: boolean;
}) {
  if (result.matchedIn === 'browse' || !excerpt) return null;
  return (
    <div className="search-excerpt">
      <span className="excerpt-label">{result.matchedIn === 'transcript' ? 'From the transcript' : 'From the guide'}</span>
      {showPassageTag && result.matchedIn === 'transcript' && result.matchedPassage !== undefined && (
        <span className="excerpt-passage-tag">{` · Passage ${result.matchedPassage}`}</span>
      )}
      <p>{excerpt}</p>
    </div>
  );
}

function MatchingPassages({
  result,
  speaker,
  view,
  returnTo,
  linkPassagesToSessionRoute,
  onBeforeSessionNavigate,
  onPassage,
}: {
  result: SearchResult;
  speaker: LinguisticSpeaker;
  view: SessionView;
  returnTo?: string;
  linkPassagesToSessionRoute: boolean;
  onBeforeSessionNavigate?: () => void;
  onPassage?: (id: string, passage: number) => void;
}) {
  const evidence = result.linguisticEvidence;
  if (!evidence) return null;
  const definition = linguisticMarkers.find(item => item.id === evidence.marker);
  const slug = result.session.slug || result.session.id;
  return (
    <div className="linguistic-evidence">
      <p className="linguistic-evidence-heading">
        <strong>{definition?.label || 'Linguistic marker'}</strong>
        <span>{evidence.count.toLocaleString()} matching {evidence.count === 1 ? 'passage' : 'passages'}</span>
      </p>
      <p className="small muted linguistic-evidence-kind">
        {definition?.kind === 'chat' ? 'Source CHAT notation' : 'Automatic text-pattern matches'} · {speaker === 'child' ? 'Seth (CHI) only' : 'Any speaker / unidentified'}
        {evidence.count > evidence.examples.length ? ` · showing ${evidence.examples.length} examples` : ''}
      </p>
      <ol className="linguistic-examples">
        {evidence.examples.map(example => {
          const passageNumber = example.passageIndex + 1;
          const href = linkPassagesToSessionRoute
            ? buildSessionHrefFromSearch(slug, { passage: passageNumber, returnTo })
            : `?entry=${encodeURIComponent(result.session.id)}&passage=${passageNumber}`;
          return (
            <li key={example.passageIndex}>
              <p className="small muted linguistic-example-locator">
                Passage {passageNumber}
                {example.speaker ? ` · ${example.speaker}` : ' · Speaker unidentified'}
                {typeof example.start === 'number' && Number.isFinite(example.start) && example.start >= 0 ? ` · ${timeLabel(example.start)}` : ''}
              </p>
              <blockquote><p>{example.text}</p></blockquote>
              <a
                className="text-link small"
                href={href}
                onClick={event => {
                  onBeforeSessionNavigate?.();
                  trackArchiveEvent('recording_open', {
                    recordingId: result.session.id,
                    origin: result.session.origin,
                    view,
                    action: 'passage',
                    passage: passageNumber,
                  });
                  if (linkPassagesToSessionRoute || !onPassage) return;
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
                  event.preventDefault();
                  onPassage(result.session.id, passageNumber);
                }}
                onAuxClick={event => {
                  if (event.button === 1) {
                    trackArchiveEvent('recording_open', {
                      recordingId: result.session.id,
                      origin: result.session.origin,
                      view,
                      action: 'passage',
                      passage: passageNumber,
                    });
                  }
                }}
                aria-label={`Read in the transcript: passage ${passageNumber}, ${result.session.title}`}
              >
                Read in the transcript
                <ArrowRight size={15} aria-hidden="true" />
              </a>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function SessionResults({
  results,
  view,
  firstIndex,
  speaker,
  headingLevel = 4,
  returnTo,
  linkPassagesToSessionRoute = false,
  onBeforeSessionNavigate,
  onPassage,
  onDocument,
}: {
  results: SearchResult[];
  view: SessionView;
  firstIndex: number;
  speaker: LinguisticSpeaker;
  headingLevel?: 3 | 4;
  returnTo?: string;
  linkPassagesToSessionRoute?: boolean;
  onBeforeSessionNavigate?: () => void;
  onPassage?: (id: string, passage: number) => void;
  onDocument?: (id: string) => void;
}) {
  const CardHeading = headingLevel === 3 ? 'h3' : 'h4';
  const rows = results.map((result, index) => {
    const { session, matchedIn, matchedPassage, linguisticEvidence } = result;
    const excerpt = visibleExcerpt(result, view);
    const hasMatches = Boolean(linguisticEvidence || excerpt);
    const markerLabel = linguisticEvidence && linguisticMarkers.find(item => item.id === linguisticEvidence.marker)?.label;
    const headingId = `result-${session.id}`;
    const slug = session.slug || session.id;
    const targetPassage = linkPassagesToSessionRoute && matchedIn === 'transcript' ? matchedPassage : undefined;
    const sessionHref = linkPassagesToSessionRoute
      ? buildSessionHrefFromSearch(slug, { passage: targetPassage, returnTo })
      : `/sessions/${encodeURIComponent(slug)}`;
    const clickAction = targetPassage !== undefined ? 'passage' : 'guide';
    const openProperties = targetPassage !== undefined
      ? { recordingId: session.id, origin: session.origin, view, action: clickAction, passage: targetPassage }
      : { recordingId: session.id, origin: session.origin, view, action: clickAction };

    const content = (
      <article className={view === 'list' ? 'session-list-row' : 'session-card'} aria-labelledby={headingId}>
        <div className="session-index" aria-hidden="true">{String(firstIndex + index).padStart(2, '0')}</div>
        <div className="session-card-body">
          <div className="session-meta">
            <span>{session.sourceName}</span>
            <SessionAge ages={session.ages} inferredAge={session.inferredAge} onDocument={onDocument} />
            {session.dates.length > 0 && <span>{session.dates.join(' / ')}</span>}
          </div>
          <CardHeading id={headingId}>
            <a
              href={sessionHref}
              onClick={() => {
                onBeforeSessionNavigate?.();
                trackArchiveEvent('recording_open', openProperties);
              }}
              onAuxClick={event => {
                if (event.button === 1) trackArchiveEvent('recording_open', openProperties);
              }}
            >
              {session.title}
              <ArrowRight size={view === 'list' ? 17 : 20} aria-hidden="true" />
            </a>
          </CardHeading>
          <p className="card-overview">{view === 'list' ? shortOverview(session.overview) : session.overview}</p>
          {view === 'details' && (
            <>
              <SearchExcerpt result={result} excerpt={excerpt} showPassageTag={linkPassagesToSessionRoute} />
              <MatchingPassages
                result={result}
                speaker={speaker}
                view={view}
                returnTo={returnTo}
                linkPassagesToSessionRoute={linkPassagesToSessionRoute}
                onBeforeSessionNavigate={onBeforeSessionNavigate}
                onPassage={onPassage}
              />
            </>
          )}
          <div className="card-bottom">
            <span className={`origin-badge ${session.origin}`}>{transcriptOriginLabels[session.origin]}</span>
            {view === 'details' && (
              <span className="audio-count small muted">
                <Headphones size={15} aria-hidden="true" />
                {session.recordings.some(recording => recording.available && recording.format.toLowerCase() === 'mp3')
                  ? 'MP3 playback available'
                  : session.recordings.length
                    ? 'MP3 playback not yet available'
                    : 'Transcript only'}
              </span>
            )}
          </div>
          {view === 'details' ? (
            <TopicLabels topics={session.topics} compact />
          ) : hasMatches && (
            <details className="compact-result-matches" key={`${session.id}-${linguisticEvidence?.marker || 'text'}-${speaker}`}>
              <summary>
                {linguisticEvidence ? (
                  <>Matching passages <span className="small muted">· {linguisticEvidence.count.toLocaleString()} · {markerLabel}</span></>
                ) : (
                  <>Search match <span className="small muted">· {matchedIn === 'transcript' ? 'transcript' : 'guide'}</span></>
                )}
              </summary>
              <SearchExcerpt result={result} excerpt={excerpt} showPassageTag={linkPassagesToSessionRoute} />
              <MatchingPassages
                result={result}
                speaker={speaker}
                view={view}
                returnTo={returnTo}
                linkPassagesToSessionRoute={linkPassagesToSessionRoute}
                onBeforeSessionNavigate={onBeforeSessionNavigate}
                onPassage={onPassage}
              />
            </details>
          )}
        </div>
      </article>
    );
    return view === 'list' ? <li key={session.id}>{content}</li> : <div key={session.id}>{content}</div>;
  });
  return view === 'list' ? <ol className="sessions-compact-list" role="list" start={firstIndex}>{rows}</ol> : <>{rows}</>;
}
