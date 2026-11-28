import { Check } from 'lucide-react';
import { isLinguisticSpeaker, linguisticMarkers, type LinguisticMarkerId, type LinguisticSpeaker } from '../lib/linguistic-markers';

export default function LinguisticFilters({
  marker,
  speaker,
  open,
  onMarker,
  onSpeaker,
  onOpen,
  externalSpeakerControl = false,
}: {
  marker: LinguisticMarkerId | '';
  speaker: LinguisticSpeaker;
  open: boolean;
  onMarker: (value: LinguisticMarkerId | '') => void;
  onSpeaker: (value: LinguisticSpeaker) => void;
  onOpen: (value: boolean) => void;
  externalSpeakerControl?: boolean;
}) {
  const selected = linguisticMarkers.find(item => item.id === marker);
  return <details className="linguistic-filters" open={open} onToggle={event => onOpen(event.currentTarget.open)}>
    <summary>Linguistics <span className="small muted">{selected ? `· ${selected.label} · ${speaker === 'child' ? 'Seth (CHI)' : 'Any speaker'}` : '· optional filters'}</span></summary>
    <div className="linguistic-filter-content">
      <p className="small muted">Discovery aids for transcript notation and word forms (not developmental scores); select a marker again to clear it.</p>
      {(['chat', 'text'] as const).map(kind => <fieldset className="linguistic-marker-group" key={kind}>
        <legend>{kind === 'chat' ? 'Source CHAT notation' : 'Automatic text patterns'}</legend>
        <p className="small muted" id={`linguistic-${kind}-help`}>{kind === 'chat' ? 'Notation present in source CHAT text; retain the transcript’s origin label when citing.' : 'Literal forms normalized for apostrophes and partial-word spellings; examples keep source text.'}</p>
        <div className="linguistic-shortcuts">
          {linguisticMarkers.filter(item => item.kind === kind).map(item => <button
            type="button" key={item.id} className="button secondary linguistic-marker-button"
            aria-pressed={marker === item.id} aria-describedby={`linguistic-${kind}-help linguistic-${item.id}-description`}
            onClick={() => onMarker(marker === item.id ? '' : item.id)}>
            {marker === item.id && <Check size={15} aria-hidden="true" />}{item.label}
          </button>)}
        </div>
        {linguisticMarkers.filter(item => item.kind === kind).map(item => <p key={item.id} id={`linguistic-${item.id}-description`} className={marker === item.id ? 'small linguistic-description' : 'sr-only'}>{item.description}</p>)}
      </fieldset>)}
      {externalSpeakerControl ? (
        <p className="small muted">Speaker scope uses the Speaker filter above; “Seth (CHI) only” matches explicit CHI labels and never infers speakers in AI drafts.</p>
      ) : (
        <>
          <div className="field linguistic-speaker"><label htmlFor="linguistic-speaker">Speaker for this marker</label><select id="linguistic-speaker" value={speaker} disabled={!marker} aria-describedby="linguistic-speaker-help" onChange={event => { if (isLinguisticSpeaker(event.target.value)) onSpeaker(event.target.value); }}><option value="child">Seth (CHI) only</option><option value="any">Any speaker / unidentified</option></select></div>
          <p id="linguistic-speaker-help" className="small muted">Applies only while a marker is selected; “Seth (CHI) only” uses explicit CHI labels and never infers speakers in AI drafts.</p>
        </>
      )}
      <p className="small muted">Counts vary by transcript origin and are not directly comparable; check source transcripts and recordings (<a href="https://talkbank.org/0info/manuals/CHAT.html" target="_blank" rel="noreferrer">CHAT notation manual, opens in a new tab</a>).</p>
    </div>
  </details>;
}
