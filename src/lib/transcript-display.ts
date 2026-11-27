import type { Passage, TranscriptOrigin } from './types';
import type { LinguisticMarkerId } from './linguistic-markers';

// A conservative display projection, not a corrected transcript or CHAT parser.
// CHAT §§8.4–8.6, 9.10, 10.2–10.3 and the §11.1 flow-tier convention:
// https://talkbank.org/0info/manuals/CHAT.html
// Source mode must always render passage.text directly. Never persist this
// projection over source text, index it as research evidence, or infer speakers.
const EDITORIAL = /\[\[LOCAL AI[\s\S]*?END LOCAL AI EDITORIAL COMMENT\]\]/g;

function plainSpeech(text: string): string {
  return text
    // These are missing-word annotations, not words that were spoken. Retain a
    // readable signal for a wholly nonlexical turn, rather than an empty row.
    .replace(/(^|[\s<>])0[\p{L}][\p{L}\p{M}'’()@:-]*/gu, '$1')
    .replace(/(^|[\s<>])0(?=[\s.,!?;:]|$)/g, '$1[no words transcribed]')
    .replace(/\bxxx\b/g, '[unintelligible]')
    .replace(/\byyy\b/g, '[unidentified word]')
    .replace(/\bwww\b/g, '[untranscribed]')
    // Keep lexical sounds and events. Neither a fragment nor a nonword is
    // silently promoted into a confident ordinary word.
    .replace(/&([{}])[ln]=([^\s<>\[\].,!?]+)/g, (_match, boundary: string, event: string) => `[event ${boundary === '{' ? 'begins' : 'ends'}: ${event.replace(/:/g, ': ')}]`)
    .replace(/&\*([A-Za-z0-9]+):([^\s<>\[\].,!?]+)/g, '[$1: $2]')
    .replace(/&=([^\s<>\[\].,!?]+)/g, (_match, event: string) => `[${event.replace(/:/g, ': ')}]`)
    .replace(/&-([^\s<>\[\].,!?]+)/g, '$1')
    .replace(/&\+([^\s<>\[\].,!?]+)/g, '[fragment: $1]')
    .replace(/&~([^\s<>\[\].,!?]+)/g, '[sound: $1]')
    .replace(/&([\p{L}][^\s<>\[\].,!?]*)/gu, '[sound: $1]')
    .replace(/@[A-Za-z][A-Za-z0-9:_]*/g, '')
    .replace(/\((?:\.{1,3}|…|(?:\d+:)?\d+(?:\.\d*)?|\.\d+)\)/g, '[pause]')
    // Preserve partial-word spellings, including their parentheses: completing
    // them would imply sounds that the transcription says were missing.
    .replace(/\+\.\.\?/g, '…?')
    .replace(/\+(?:\.{3}|…)/g, '…')
    .replace(/\+\/\/([.?])/g, '[self-interrupted]$1')
    .replace(/\+\/([.?])/g, '[interrupted]$1')
    .replace(/\+!\?/g, '!?')
    .replace(/(^|\s)(?:\+\+|\+,|\+\^|\+<)(?=\s|$)/g, '$1')
    .replace(/[<>]/g, '')
    // Lengthening / within-word pause signs are not letters. Other unfamiliar
    // symbols remain available rather than being guessed at or erased.
    .replace(/(?<=[\p{L})])[:^]+(?=[\p{L}(])/gu, '')
    .replace(/[ˈˌ]/g, '');
}

function annotationText(raw: string): string {
  const code = raw.slice(1, -1).trim();
  if (code === '?') return ' [uncertain] ';
  if (code.startsWith('=?')) return ` [uncertain; alternative: ${code.slice(2).trim()}] `;
  if (code.startsWith('=!')) return ` [${code.slice(2).trim()}] `;
  if (code === '^c') return ' '; // Clause delimiter, not an event named "c".
  if (code.startsWith('^')) return ` [${code.slice(1).trim()}] `;
  if (code.startsWith('%')) return ` [note: ${code.slice(1).trim()}] `;
  if (/^=\s/.test(code)) return ` [source note: ${code.slice(1).trim()}] `;
  // The overt form is already in the speech; a replacement is never used to
  // rewrite it. Repetition/retracing marks disappear but all overt tokens stay.
  if (/^:{1,2}\s/.test(code)) return ' ';
  if (/^(?:\/{1,3}|\/[?-]|[<>!]|!!|\*(?:\s.*)?|[+-]\s.*)$/.test(code)) return ' ';
  const repetition = /^x\s+(\d+)$/.exec(code);
  if (repetition) return ` [repeated ${repetition[1]} times] `;
  // Do not erase unfamiliar annotations or pretend to understand every CHAT
  // convention. Rendering remains plain React text, not executable markup.
  return raw;
}

function displayUtterance(speech: string): string {
  let result = '';
  let from = 0;
  for (let at = 0; at < speech.length;) {
    if (speech[at] !== '[') { at++; continue; }
    result += plainSpeech(speech.slice(from, at));
    const start = at++;
    let depth = 1;
    while (at < speech.length && depth) {
      if (speech[at] === '[') depth++;
      else if (speech[at] === ']') depth--;
      at++;
    }
    // Malformed or unfinished markup stays exact; do not hide the remainder.
    result += depth ? speech.slice(start, at) : annotationText(speech.slice(start, at));
    from = at;
  }
  result += plainSpeech(speech.slice(from));
  return result.replace(/\s+/g, ' ').replace(/\s+([,.!?;])/g, '$1').trim();
}

export function readingText(passage: Passage, origin: TranscriptOrigin): string {
  if (origin === 'local_ai_draft' || !passage.speaker?.trim()) return passage.text;
  const editorialComments = [...passage.text.matchAll(EDITORIAL)].map(match => match[0]);
  const speech = passage.text.replace(EDITORIAL, '').split(/\r?\n/, 1)[0];
  const reading = displayUtterance(speech);
  // These local AI explanations must remain explicitly labelled and separate
  // even when linguistic/dependent tiers are hidden in the easier reading view.
  return [reading, ...editorialComments].filter(Boolean).join('\n\n');
}

export interface NotationLink { start: number; end: number; marker: LinguisticMarkerId }

export function getNotationLinks(passage: Passage, origin: TranscriptOrigin): NotationLink[] {
  if (origin === 'local_ai_draft' || !passage.speaker?.trim()) return [];
  // Mask rather than remove: offsets must address the untouched source string.
  const speech = passage.text
    .replace(EDITORIAL, comment => comment.replace(/[^\r\n]/g, ' '))
    .split(/\r?\n/, 1)[0];
  if (/^\s*(?:\[Source\b|Source \(|Note:|Phonetic transcription\b|Speech-act annotation\b|[%@]\w)/i.test(speech)) return [];
  const links: NotationLink[] = [];
  for (let at = 0; at < speech.length;) {
    if (speech[at] === '&') {
      // Skip events only at the top level. Masking them before bracket parsing
      // could consume a comment's closing bracket and hide later real symbols.
      while (at < speech.length && !/[\s<>]/.test(speech[at])) at++;
      continue;
    }
    if (speech[at] === '[') {
      const start = at++;
      let depth = 1;
      while (at < speech.length && depth) {
        if (speech[at] === '[') depth++;
        else if (speech[at] === ']') depth--;
        at++;
      }
      const symbol = speech.slice(start, at);
      if (symbol === '[/]' || symbol === '[//]') links.push({ start, end: at, marker: symbol === '[/]' ? 'repetition' : 'retracing' });
      continue;
    }
    if (speech[at] === '(') {
      const pause = /^\((?:\.{1,3}|…|(?:\d+:)?\d+(?:\.\d*)?|\.\d+)\)/.exec(speech.slice(at));
      if (pause) {
        links.push({ start: at, end: at + pause[0].length, marker: 'pause' });
        at += pause[0].length;
        continue;
      }
    }
    at++;
  }
  return links;
}
