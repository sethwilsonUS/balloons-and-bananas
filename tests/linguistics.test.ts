import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLinguisticMarkerId, isLinguisticSpeaker, linguisticMarkers } from '../src/lib/linguistic-markers';
import { makeLinguisticSearch, utteranceText } from '../src/lib/linguistic-search';
import type { ArchiveEntry, TranscriptSegment } from '../src/lib/types';

function entry(id: string, transcript: TranscriptSegment[], changes: Partial<ArchiveEntry> = {}): ArchiveEntry {
  return { id, sourceName: `${id}.txt`, title: 'A guide', overview: 'An AI-written guide.', origin: 'archived_research', topics: [], dates: [], ages: [], audio: [], preferredAudioId: null, sources: [], moments: [], limits: [], transcript, sourceSha256: '', association: '', ...changes };
}
const child = (text: string, changes: Partial<TranscriptSegment> = {}): TranscriptSegment => ({ text, speaker: 'Seth (CHI, target child)', ...changes });

test('only archived CHI labels establish child identity; other sources and labels stay in any scope', () => {
  const search = makeLinguisticSearch([
    entry('chi', [child('where am I ?')]),
    entry('chi-code', [child('where am I ?', { speaker: 'CHI' })]),
    entry('parent', [child('where am I ?', { speaker: 'Bob Wilson (FAT, father)' })]),
    entry('other-child', [child('where am I ?', { speaker: 'Child (CH2)' })]),
    entry('named-child', [child('where am I ?', { speaker: 'Seth' })]),
    entry('par', [child('where am I ?', { speaker: 'Participant (PAR2)' })]),
    entry('talkbank-par', [child('where am I ?', { speaker: 'Participant (PAR2)' })], { origin: 'talkbank_ai_draft' }),
    entry('talkbank-chi', [child('where am I ?')], { origin: 'talkbank_ai_draft' }),
    entry('local', [{ text: 'where am I ?' }], { origin: 'local_ai_draft' }),
    entry('local-chi', [child('where am I ?')], { origin: 'local_ai_draft' }),
    entry('metadata', [{ text: 'where am I ?' }]),
  ]);
  assert.deepEqual([...search('question').keys()], ['chi', 'chi-code']);
  assert.equal(search('question', 'any').size, 10);
  assert.ok(!search('question', 'any').has('metadata'));
});

test('metadata, notes, dependent tiers and local editorial explanations are never lexical evidence', () => {
  const search = makeLinguisticSearch([
    entry('notes', [
      child('hello .\n  Note: why? no! I was here (.) [/] [//]'),
      child('hello .\n  Phonetic transcription (%xpho): why? no! I was here (.) [/] [//]'),
      child('hello .\n  Speech-act annotation (%spa): why? no! I was here'),
      child('hello .\n%mor: why? no! I was here'),
      child('hello . [[LOCAL AI-GENERATED EDITORIAL PROVENANCE COMMENT | why? no! I was here (.) [/] [//] | END LOCAL AI EDITORIAL COMMENT]]'),
      { text: '[Source Comment] why? no! I was here (.) [/] [//]' },
    ]),
    entry('notes-only', [child('Note: why? no! I was here')]),
  ]);
  for (const marker of linguisticMarkers) assert.equal(search(marker.id, 'any').size, 0, marker.id);
});

test('CHAT symbols are exact top-level source notation, not repetitions inferred from words or ASR', () => {
  const search = makeLinguisticSearch([
    entry('repeat', [child('go [/] go [/] go .')]),
    entry('retrace', [child('go [//] stay .')]),
    entry('other-symbols', [child('go [///] stay . [/?] [?] [= he wrote [/] and [//]]')]),
    entry('spoken-repeat', [child('go go go .')]),
    entry('talkbank', [child('go [/] stay .', { speaker: 'Participant (PAR1)' })], { origin: 'talkbank_ai_draft' }),
    entry('local', [child('go [/] stay [//] (.) .')], { origin: 'local_ai_draft' }),
  ]);
  assert.deepEqual([...search('repetition').keys()], ['repeat']);
  assert.deepEqual([...search('repetition', 'any').keys()], ['repeat', 'talkbank']);
  assert.deepEqual([...search('retracing', 'any').keys()], ['retrace']);
  assert.equal(search('repetition').get('repeat')!.count, 1, 'Count passages, not occurrences');
  assert.equal(search('question', 'any').size, 0, 'Bracket uncertainty is not question punctuation');
  assert.equal(search('pause', 'any').size, 0, 'Local ASR cannot supply CHAT notation');
});

test('pause notation includes timed forms and does not use numbers or punctuation outside pause notation', () => {
  const forms = ['(.)', '(..)', '(...)', '(…)', '(7.)', '(2.)', '(1.2)', '(4)', '(.4)', '(1:02.3)'];
  const search = makeLinguisticSearch([
    entry('pause', forms.map(form => child(`hello ${form} again .`))),
    entry('not-pause', [child('hello ... at 1.2 .'), child('hello [= (.)] .'), child('hello &=event(.) .')]),
  ]);
  assert.equal(search('pause').size, 1);
  assert.equal(search('pause').get('pause')!.count, forms.length);
});

test('lexical matching handles contractions and partial words without counting annotation/event vocabulary', () => {
  const search = makeLinguisticSearch([
    entry('forms', [
      child('I’m here, we’re together and I don’t know .'),
      child('(w)here is th(a)t ?'),
      child('what’s happening ?'),
      child("do n't, never and not ."),
      child("don('t) ."),
      child("'no', 'not' and 'never' ."),
    ]),
    entry('annotation', [
      child('okay [= no I here what?] [:= not] [?] [=? why] [/?] .'),
      child('hello@i &=what? &~no &-my 0no 0where 0I 0here .'),
      child('yellow hollow theirs knowledge worry .'),
      child('(no) (I) (here) (what?) .'),
    ]),
  ]);
  assert.equal(search('first-person').get('forms')!.count, 1);
  assert.equal(search('deixis').get('forms')!.count, 2);
  assert.equal(search('negation').get('forms')!.count, 4);
  assert.equal(search('question').get('forms')!.count, 2);
  assert.equal(search('wh-question').get('forms')!.count, 2);
  for (const marker of linguisticMarkers) assert.ok(!search(marker.id).has('annotation'), marker.id);
});

test('question mark and wh word must co-occur in the same utterance; words alone do not establish questions', () => {
  const search = makeLinguisticSearch([
    entry('separate', [child('where it goes .'), child('is it good ?')]),
    entry('same', [child('why is that ?')]),
  ]);
  assert.equal(search('question').size, 2);
  assert.deepEqual([...search('wh-question').keys()], ['same']);
});

test('evidence retains source segment identity and timestamp, caps examples, and does not mutate sources', () => {
  const transcript: TranscriptSegment[] = [{ text: '[Source Comment] where?' }, ...Array.from({ length: 5 }, (_, i) => child(`where is it ${i} ?\n  Note: source observation`, { start: i === 0 ? 0 : null }))];
  const snapshot = JSON.stringify(transcript);
  const search = makeLinguisticSearch([entry('evidence', transcript)]);
  const evidence = search('wh-question').get('evidence')!;
  assert.equal(evidence.count, 5);
  assert.deepEqual(evidence.examples.map(example => example.segmentIndex), [1, 2, 3]);
  assert.equal(evidence.examples[0].start, 0);
  assert.equal(evidence.examples[1].start, null);
  assert.equal(evidence.examples[0].speaker, 'Seth (CHI, target child)');
  assert.equal(evidence.examples[0].text, 'where is it 0 ?');
  assert.equal(JSON.stringify(transcript), snapshot);
  assert.strictEqual(search('wh-question').get('evidence'), evidence, 'Repeat requests reuse the index');
  assert.equal(utteranceText(child('hello .\r\nNote: explanation')), 'hello .');
});

test('long exact source excerpts are bounded, and public input guards reject malformed marker/speaker values', () => {
  const speech = `where ${'word '.repeat(150)}?`;
  const evidence = makeLinguisticSearch([entry('long', [child(speech)])])('question').get('long')!;
  assert.equal(evidence.examples[0].text, '…' + speech.slice(-500));
  const annotated = `hello [= ${'word '.repeat(120)}no] ${'yes '.repeat(130)}never .`;
  const negation = makeLinguisticSearch([entry('long-annotation', [child(annotated)])])('negation').get('long-annotation')!;
  assert.ok(negation.examples[0].text.endsWith('never .'));
  assert.ok(annotated.includes(negation.examples[0].text.replace(/^…|…$/g, '')));
  assert.ok(negation.examples[0].text.length <= 502);
  for (const value of [null, 1, {}, [], 'unknown']) {
    assert.equal(isLinguisticMarkerId(value), false);
    assert.equal(isLinguisticSpeaker(value), false);
  }
  assert.ok(isLinguisticMarkerId('wh-question'));
  assert.ok(isLinguisticSpeaker('child'));
  assert.ok(isLinguisticSpeaker('any'));
});
