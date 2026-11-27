import { linguisticMarkers, type LinguisticMarkerId, type LinguisticSpeaker } from './linguistic-markers';
import type { LinguisticEvidence, Passage, Session } from './types';

const WH_WORDS = new Set(['what', 'who', 'whom', 'whose', 'which', 'when', 'where', 'why', 'how']);
const FIRST_PERSON = new Set(['i', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our', 'ours', 'ourselves']);
const DEIXIS = new Set(['this', 'that', 'these', 'those', 'here', 'there']);
const NEGATION = new Set(['no', 'not', 'never']);
const blank = (value: string) => ' '.repeat(value.length);

function isSourceChild(speaker: string | undefined) {
  // CHI is the source code. "Child", another child's CH2 code, or an anonymous
  // AI participant label is not evidence of the target child's identity.
  return !!speaker && /^(?:\*?CHI:?|[^()]+\(CHI(?:,\s*[^()]*)?\))$/.test(speaker.trim());
}

export function utteranceText(passage: Passage): string {
  // The reading-copy importer puts speech on the first line and dependent
  // tiers / observation notes on subsequent lines. Those are not spoken words.
  // Remove delimited editorial comments first, including any embedded inline.
  return passage.text
    .replace(/\[\[LOCAL AI[\s\S]*?END LOCAL AI EDITORIAL COMMENT\]\]/g, '')
    .split(/\r?\n/, 1)[0]
    .trim();
}

function withoutAnnotations(text: string, keepChatMarkers: boolean): string {
  let output = '';
  for (let at = 0; at < text.length;) {
    if (text[at] !== '[') { output += text[at++]; continue; }
    const from = at++;
    let depth = 1;
    while (at < text.length && depth) {
      if (text[at] === '[') depth++;
      if (text[at] === ']') depth--;
      at++;
    }
    const annotation = text.slice(from, at);
    output += keepChatMarkers && (annotation === '[/]' || annotation === '[//]') ? annotation : blank(annotation);
  }
  return output;
}

function lexicalText(text: string): string {
  return withoutAnnotations(text, false)
    .replace(/[‘’ʼ]/g, "'")
    // CHAT events, fragments, fillers and zero-marked unspoken words are not
    // lexical evidence; special-form suffixes are codes, not spoken words.
    .replace(/&[^\s<>]+/g, blank)
    .replace(/(^|[\s<>])0[^\s<>]*/g, blank)
    .replace(/@[A-Za-z][\w:]*/g, blank)
    // Reconstruct only parenthetical letters attached to an overt word, such
    // as (w)here or don('t). Standalone parenthetical text is not a token.
    // Null placeholders keep source offsets intact without splitting the word.
    .replace(/(?<=[A-Za-z'])\(([A-Za-z']+)\)|\(([A-Za-z']+)\)(?=[A-Za-z'])/g, (_match, after: string | undefined, before: string | undefined) => `\0${after ?? before ?? ''}\0`)
    .replace(/\([^)]*\)/g, blank)
    .toLowerCase();
}

function matchedMarkers(speech: string, chatEligible: boolean): Array<{ marker: LinguisticMarkerId; at: number }> {
  const matches: Array<{ marker: LinguisticMarkerId; at: number }> = [];
  if (chatEligible) {
    const notation = withoutAnnotations(speech, true).replace(/&[^\s<>]+/g, blank);
    const repetition = notation.indexOf('[/]');
    const retracing = notation.indexOf('[//]');
    const pause = /\((?:\.{1,3}|…|(?:\d+:)?\d+(?:\.\d*)?|\.\d+)\)/.exec(notation);
    if (repetition >= 0) matches.push({ marker: 'repetition', at: repetition });
    if (retracing >= 0) matches.push({ marker: 'retracing', at: retracing });
    if (pause) matches.push({ marker: 'pause', at: pause.index });
  }
  const lexical = lexicalText(speech);
  const tokens = [...lexical.matchAll(/[a-z][a-z'\0]*/g)].map(match => {
    const word = match[0].replace(/\0/g, '').replace(/'+$/, '');
    return { word, base: word.split("'", 1)[0], at: match.index };
  });
  const question = lexical.indexOf('?');
  if (question >= 0) {
    matches.push({ marker: 'question', at: question });
    const wh = tokens.find(token => WH_WORDS.has(token.base));
    if (wh) matches.push({ marker: 'wh-question', at: wh.at });
  }
  const negation = tokens.find(token => NEGATION.has(token.word) || token.word.endsWith("n't"));
  const firstPerson = tokens.find(token => FIRST_PERSON.has(token.base));
  const deixis = tokens.find(token => DEIXIS.has(token.base));
  if (negation) matches.push({ marker: 'negation', at: negation.at });
  if (firstPerson) matches.push({ marker: 'first-person', at: firstPerson.at });
  if (deixis) matches.push({ marker: 'deixis', at: deixis.at });
  return matches;
}

function evidenceExcerpt(speech: string, at: number): string {
  if (speech.length <= 500) return speech;
  const from = Math.max(0, Math.min(at - 150, speech.length - 500));
  const to = Math.min(speech.length, from + 500);
  return `${from ? '…' : ''}${speech.slice(from, to)}${to < speech.length ? '…' : ''}`;
}

type SessionEvidence = Map<string, LinguisticEvidence>;
type MarkerIndex = Map<LinguisticMarkerId, Record<LinguisticSpeaker, SessionEvidence>>;

function buildIndex(sessions: Session[]): MarkerIndex {
  const index: MarkerIndex = new Map(linguisticMarkers.map(marker => [marker.id, { child: new Map(), any: new Map() }]));
  for (const session of sessions) {
    session.transcript.forEach((passage, passageIndex) => {
      const chatEligible = session.origin !== 'local_ai_draft' && !!passage.speaker?.trim();
      // Source metadata has no speaker. Local ASR passages are speech drafts,
      // but have no established identity and can only enter the "any" scope.
      if (session.origin !== 'local_ai_draft' && !chatEligible) return;
      const speech = utteranceText(passage);
      if (!speech || /^(?:\[Source\b|Source \(|Note:|Phonetic transcription\b|Speech-act annotation\b|[%@]\w)/i.test(speech)) return;
      const scopes: LinguisticSpeaker[] = session.origin === 'archived_research' && isSourceChild(passage.speaker) ? ['child', 'any'] : ['any'];
      for (const { marker, at } of matchedMarkers(speech, chatEligible)) {
        for (const scope of scopes) {
          const sessionEvidence = index.get(marker)![scope];
          let evidence = sessionEvidence.get(session.id);
          if (!evidence) {
            evidence = { marker, count: 0, examples: [] };
            sessionEvidence.set(session.id, evidence);
          }
          evidence.count++;
          if (evidence.examples.length < 3) {
            evidence.examples.push({
              passageIndex, text: evidenceExcerpt(speech, at),
              ...(passage.speaker ? { speaker: passage.speaker } : {}),
              ...(passage.start !== undefined ? { start: passage.start } : {}),
            });
          }
        }
      }
    });
  }
  return index;
}

export function makeLinguisticSearch(sessions: Session[]) {
  // All markers and both scopes are indexed in one pass on first use. Ordinary
  // search pays no extra cost, and subsequent filter changes don't rescan text.
  let index: MarkerIndex | undefined;
  return (marker: LinguisticMarkerId, speaker: LinguisticSpeaker = 'child'): ReadonlyMap<string, LinguisticEvidence> => {
    index ??= buildIndex(sessions);
    return index.get(marker)![speaker];
  };
}
