import { Check } from 'lucide-react';
import { linguisticMarkers, type LinguisticMarkerId, type LinguisticSpeaker } from '../lib/linguistic-markers';

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
      <p className="small muted">Find transcript notation and word forms. These are discovery aids, not developmental scores or exhaustive linguistic coding. Select one marker; select it again to clear it.</p>
      {(['chat', 'text'] as const).map(kind => <fieldset className="linguistic-marker-group" key={kind}>
        <legend>{kind === 'chat' ? 'Source CHAT notation' : 'Automatic text patterns'}</legend>
        <p className="small muted" id={`linguistic-${kind}-help`}>{kind === 'chat' ? 'Notation present in the source CHAT text. Its presence does not establish who added it; retain the transcript’s source label when citing it.' : 'Literal forms found automatically in the transcript. A matching form does not establish its grammatical function or how it was used. Matching normalizes apostrophes and partial-word spellings in CHAT; examples retain the source text.'}</p>
        <div className="linguistic-shortcuts">
          {linguisticMarkers.filter(item => item.kind === kind).map(item => <button
            type="button" key={item.id} className="button secondary theme-shortcut"
            aria-pressed={marker === item.id} aria-describedby={`linguistic-${kind}-help linguistic-${item.id}-description`}
            onClick={() => onMarker(marker === item.id ? '' : item.id)}>
            {marker === item.id && <Check size={15} aria-hidden="true" />}{item.label}
          </button>)}
        </div>
        {linguisticMarkers.filter(item => item.kind === kind).map(item => <p key={item.id} id={`linguistic-${item.id}-description`} className={marker === item.id ? 'small linguistic-description' : 'sr-only'}>{item.description}</p>)}
      </fieldset>)}
      {externalSpeakerControl ? (
        <p className="small muted">Speaker scope for both the concordance and any selected linguistic marker is controlled by the Speaker filter above. “Seth (CHI) only” uses explicit CHI labels in archived research; no speaker identity is inferred.</p>
      ) : (
        <>
          <div className="field linguistic-speaker"><label htmlFor="linguistic-speaker">Speaker for this marker</label><select id="linguistic-speaker" value={speaker} disabled={!marker} aria-describedby="linguistic-speaker-help" onChange={event => onSpeaker(event.target.value as LinguisticSpeaker)}><option value="child">Seth (CHI) only</option><option value="any">Any speaker / unidentified</option></select></div>
          <p id="linguistic-speaker-help" className="small muted">Speaker scope applies only while a marker is selected. “Seth (CHI) only” uses explicit CHI labels; it excludes PAR and unidentified speech in AI drafts. No speaker identity is inferred.</p>
        </>
      )}
      <p className="small muted">Notation, speaker labels, and AI punctuation vary across transcript origins; counts are not directly comparable. Few or no matches do not show an absence of a linguistic ability. Check the source transcript and recordings; raw CHAT files are available with each session. <a href="https://talkbank.org/0info/manuals/CHAT.html" target="_blank" rel="noreferrer">Read the CHAT notation manual (opens in a new tab)</a>.</p>
    </div>
  </details>;
}
