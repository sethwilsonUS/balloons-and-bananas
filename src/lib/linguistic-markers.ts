export type LinguisticMarkerId = 'repetition' | 'retracing' | 'pause' | 'question' | 'wh-question' | 'negation' | 'first-person' | 'deixis';
export type LinguisticSpeaker = 'child' | 'any';

// Public definitions contain no archive text. Matches are discovery aids, not
// linguistic analyses or claims about who supplied a source annotation.
export const linguisticMarkers: ReadonlyArray<{
  id: LinguisticMarkerId;
  label: string;
  kind: 'chat' | 'text';
  description: string;
}> = [
  { id: 'repetition', label: 'Repetition notation', kind: 'chat', description: 'Finds the CHAT [/] repetition symbol in source utterances. Does not detect every spoken repetition or identify the annotator.' },
  { id: 'retracing', label: 'Retracing notation', kind: 'chat', description: 'Finds the CHAT [//] retracing symbol in source utterances. Does not detect every self-correction or identify the annotator.' },
  { id: 'pause', label: 'Pause notation', kind: 'chat', description: 'Finds CHAT (.), (..), (...) and numeric pause notation in source utterances. Does not measure pauses from audio.' },
  { id: 'question', label: 'Question mark', kind: 'text', description: 'Finds a question mark in utterance text, excluding bracket annotations. Punctuation is a candidate clue, not a grammatical analysis.' },
  { id: 'wh-question', label: 'Question mark + wh word', kind: 'text', description: 'Finds a question mark together with what, who, whom, whose, which, when, where, why or how. This does not establish a wh-question structure.' },
  { id: 'negation', label: 'Negation words', kind: 'text', description: 'Finds no, not, never and written n’t contractions. Candidate word forms can have different functions in context.' },
  { id: 'first-person', label: 'First-person forms', kind: 'text', description: 'Finds I, me, my, mine, myself, we, us, our, ours and ourselves, including contractions. Does not infer the speaker’s identity.' },
  { id: 'deixis', label: 'Deixis candidate forms', kind: 'text', description: 'Finds this, that, these, those, here and there, including contractions. These forms are not necessarily deictic in context.' },
];

export function isLinguisticMarkerId(value: unknown): value is LinguisticMarkerId {
  return typeof value === 'string' && linguisticMarkers.some(marker => marker.id === value);
}

export function isLinguisticSpeaker(value: unknown): value is LinguisticSpeaker {
  return value === 'child' || value === 'any';
}
