import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getNotationLinks, readingText } from '../src/lib/transcript-display';
import type { Passage, TranscriptOrigin } from '../src/lib/types';

const spoken = (text: string): Passage => ({ text, speaker: 'Synthetic (CHI, target child)', start: 3.2, end: 4.1 });
const read = (text: string, origin: TranscriptOrigin = 'archived_research') => readingText(spoken(text), origin);

test('reading projection retains repeated/retraced speech and overt forms instead of target corrections', () => {
  assert.equal(read('<go go> [/] go [//] stay [///] here .'), 'go go go stay here.');
  assert.equal(read('goed [: went] [*] home .'), 'goed home.');
  assert.equal(read('wanna [: want to] go [:: went] .'), 'wanna go.');
  assert.equal(read('mip@c [= small toy] .'), 'mip [source note: small toy].');
});

test('uncertainty, alternatives, unintelligibility and untranscribed material stay explicit', () => {
  assert.equal(read('<the green one> [?] ?'), 'the green one [uncertain]?');
  assert.equal(read('two [=? too] .'), 'two [uncertain; alternative: too].');
  assert.equal(read('xxx yyy www .'), '[unintelligible] [unidentified word] [untranscribed].');
  assert.equal(read('xxx xxx .'), '[unintelligible] [unintelligible].');
});

test('partial-word parentheses retain missing-sound evidence and zero words do not become speech', () => {
  assert.equal(read('(o)kay th(a)t (i)s don(\'t) .'), '(o)kay th(a)t (i)s don(\'t).');
  assert.equal(read('I 0am here 0today .'), 'I here.');
  assert.equal(read('0 [^ waves] .'), '[no words transcribed] [waves].');
  assert.equal(read('0 .'), '[no words transcribed].');
  assert.equal(read('the 10 red things .'), 'the 10 red things.');
});

test('events, fragments, nonwords and fillers retain their audible or contextual content', () => {
  assert.equal(read('&=laughs &-uh &+b &~wa &legacy .'), '[laughs] uh [fragment: b] [sound: wa] [sound: legacy].');
  assert.equal(read('turn &=turns:page .'), 'turn [turns: page].');
  assert.equal(read('mine [=! laughing] [^ points to door] [% quietly] .'), 'mine [laughing] [points to door] [note: quietly].');
  assert.equal(read('&{l=laughs hello &}l=laughs .'), '[event begins: laughs] hello [event ends: laughs].');
  assert.equal(read('hello &*MOT:mhm there .'), 'hello [MOT: mhm] there.');
});

test('pause and terminator codes have readable renderings without expanding spelling', () => {
  for (const pause of ['(.)', '(..)', '(...)', '(…)', '(7.)', '(.5)', '(1:02.5)']) {
    assert.equal(read(`hello ${pause} again .`), 'hello [pause] again.');
  }
  assert.equal(read('bana:nas ^ [<] [>] [!] [!!] [- eng] [+ code] +...'), 'bananas ^ …');
  assert.equal(read('I was +/.'), 'I was [interrupted].');
  assert.equal(read('are you +..?'), 'are you …?');
  assert.equal(read('++ and +, then .'), 'and then.');
});

test('known suffixes simplify while unknown annotations and malformed bracket content survive', () => {
  assert.equal(read('meow@p snarg@c word@s:eng .'), 'meow snarg word.');
  assert.equal(read('if@q-s .'), 'if-s.');
  assert.equal(read('first [^c] next .'), 'first next.');
  assert.equal(read('word [rare unknown code] .'), 'word [rare unknown code].');
  assert.equal(read('word [unclosed unusual annotation'), 'word [unclosed unusual annotation');
  assert.equal(read('word [% observed [unclear tag]] .'), 'word [note: observed [unclear tag]].');
  assert.equal(read('word [x 3] .'), 'word [repeated 3 times].');
});

test('notation links retain exact sorted source offsets for supported raw symbols', () => {
  const text = '  go [/] go [//] stay (.) (7.) (.5) (1:02.5) (…)?';
  const links = getNotationLinks(spoken(text), 'archived_research');
  assert.deepEqual(links.map(link => text.slice(link.start, link.end)), ['[/]', '[//]', '(.)', '(7.)', '(.5)', '(1:02.5)', '(…)']);
  assert.deepEqual(links.map(link => link.marker), ['repetition', 'retracing', 'pause', 'pause', 'pause', 'pause', 'pause']);
  assert.equal(links[0].start, 5);
  assert.ok(links.every((link, at) => link.end > link.start && (!at || links[at - 1].end <= link.start)));
  assert.deepEqual(getNotationLinks(spoken(text), 'talkbank_ai_draft'), links);
});

test('notation links exclude comments, nested annotations, uncertainty, events and dependent tiers', () => {
  const editorial = '[[LOCAL AI-GENERATED EDITORIAL PROVENANCE COMMENT | (.) [/] [//] | END LOCAL AI EDITORIAL COMMENT]]';
  const text = `word [/?] [?] [///] [= (.) [/] [//]] &=event(.) ${editorial} (2.) .\n  Note: (.) [/] [//]`;
  const links = getNotationLinks(spoken(text), 'archived_research');
  assert.deepEqual(links, [{ start: text.indexOf('(2.)'), end: text.indexOf('(2.)') + 4, marker: 'pause' }]);
  assert.deepEqual(getNotationLinks(spoken('word [unfinished (.) [/]'), 'archived_research'), []);
  assert.deepEqual(getNotationLinks(spoken('word (a)gain don(\'t) .'), 'archived_research'), []);
  const eventInComment = 'word [= &=event] [/] word (.) &=event[/] .';
  const outsideComment = getNotationLinks(spoken(eventInComment), 'archived_research');
  assert.deepEqual(outsideComment.map(link => eventInComment.slice(link.start, link.end)), ['[/]', '(.)']);
  const multiline = `word [[LOCAL AI-GENERATED EDITORIAL PROVENANCE COMMENT |\n (.) [/] [//]\nEND LOCAL AI EDITORIAL COMMENT]]`;
  assert.deepEqual(getNotationLinks(spoken(multiline), 'archived_research'), []);
});

test('notation links never interpret local AI or metadata as CHAT speech', () => {
  const text = 'word [/] (.)';
  assert.deepEqual(getNotationLinks(spoken(text), 'local_ai_draft'), []);
  assert.deepEqual(getNotationLinks({ text }, 'archived_research'), []);
  assert.deepEqual(getNotationLinks({ text, speaker: '' }, 'talkbank_ai_draft'), []);
  assert.deepEqual(getNotationLinks(spoken('[Source Comment] word [/] (.)'), 'archived_research'), []);
});

test('reading mode hides dependent tiers but retains local AI editorial provenance distinctly', () => {
  const editorial = '[[LOCAL AI-GENERATED EDITORIAL PROVENANCE COMMENT | Synthetic explanation, not speech. | END LOCAL AI EDITORIAL COMMENT]]';
  const source = `word [?] .\n  Note: synthetic observation\n  Phonetic transcription (%xpho): synthetic\n%mor: synthetic\n${editorial}`;
  assert.equal(read(source), `word [uncertain].\n\n${editorial}`);
  assert.equal(read(`word ${editorial} [?] .`), `word [uncertain].\n\n${editorial}`);
  assert.equal(read('hello .\r\n  Note: source note'), 'hello.');
});

test('metadata and local AI bypass CHAT parsing, inputs stay immutable, and results are deterministic', () => {
  const source = 'hello [/] hello (.) xxx 0am .\n  Note: plain AI text';
  assert.equal(read(source, 'local_ai_draft'), source);
  for (const origin of ['archived_research', 'talkbank_ai_draft', 'local_ai_draft'] as const) {
    const metadata: Passage = { text: '[Source Comment] abc [/] xyz\nMore metadata.' };
    assert.equal(readingText(metadata, origin), metadata.text);
  }
  const passage = spoken(source);
  const snapshot = JSON.stringify(passage);
  const first = readingText(passage, 'talkbank_ai_draft');
  assert.equal(first, 'hello hello [pause] [unintelligible].');
  assert.equal(readingText(passage, 'talkbank_ai_draft'), first);
  assert.equal(JSON.stringify(passage), snapshot);
});
