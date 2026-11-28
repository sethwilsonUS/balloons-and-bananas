#!/usr/bin/env node
// Run from the app directory: node scripts/verify-release.mjs https://example.vercel.app
// Verifies public access without any sharing key. Output is redacted.
// When checking a local `next start` server, run with NODE_ENV=production.
import { open, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const checks = [];
const counts = {};
let stage = 'configuration';
class VerificationFailure extends Error {
  constructor(check, details = {}) { super(check); this.check = check; this.details = details; }
}
function check(condition, name, details = {}) {
  if (!condition) throw new VerificationFailure(name, details);
  checks.push(name);
}
function privateResponse(response, label) {
  check(/\bno-store\b/i.test(response.headers.get('cache-control') || ''), `${label}:no_store`);
  check(/\bno-store\b/i.test(response.headers.get('cdn-cache-control') || ''), `${label}:cdn_no_store`);
  check(/\bnoindex\b/i.test(response.headers.get('x-robots-tag') || ''), `${label}:noindex`);
  check(response.headers.get('referrer-policy') === 'no-referrer', `${label}:no_referrer`);
}
async function bodyJson(response, label) {
  try { return await response.json(); } catch { throw new VerificationFailure(`${label}:json_response`); }
}
async function boundedBytes(response, limit, label) {
  // Cancel oversized or range-ignoring responses instead of consuming a whole recording.
  const reader = response.body?.getReader();
  check(Boolean(reader), `${label}:body_present`);
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new VerificationFailure(`${label}:response_exceeded_limit`);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}

async function main() {
  const rawBase = process.argv[2];
  check(typeof rawBase === 'string' && rawBase.length > 0, 'base_url_argument');
  let base;
  try { base = new URL(rawBase); } catch { throw new VerificationFailure('base_url_valid'); }
  check(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password && !base.search && !base.hash && base.pathname === '/', 'base_url_origin_only');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  check(base.protocol === 'https:' || local, 'remote_requires_https');
  const data = JSON.parse(await readFile('private-data/archive.json', 'utf8'));
  const uploadPlan = JSON.parse(await readFile('private-data/upload-plan.json', 'utf8'));
  // Private exclusion identifiers live in the git-ignored privacy config, never in this public script.
  let privacy;
  try { privacy = JSON.parse(await readFile(process.env.READER_PRIVACY_CONFIG || 'private-config/reader-privacy.json', 'utf8')); }
  catch { throw new VerificationFailure('privacy_config_present'); }
  const excluded = Object.keys(privacy.excludedDocuments || {});
  check(excluded.length > 0, 'privacy_config_lists_excluded_documents');
  check(data.entries.length === 391, 'local_expected_session_count');
  const sessionSlug = entry => entry.slug || (
    entry.sourceName === 'transcripts-ai/0extra/82-supp/011119d.json'
      ? '011119d-82-supp'
      : entry.sourceName.split(/[\\/]/).pop().replace(/\.[^.]+$/, '').toLowerCase()
  );
  const localSlugs = data.entries.map(sessionSlug);
  check(new Set(localSlugs).size === data.entries.length, 'local_unique_session_slugs');
  check(excluded.every(id => !data.documents.some(document => document.id === id)), 'local_personal_briefs_excluded');
  check(Object.values(data.assets).every(asset => !/^application\/pdf/i.test(asset.contentType) && !/\.pdf$/i.test(asset.name)), 'local_no_pdfs');
  const audioFiles = data.entries.flatMap(entry => entry.audio);
  const originalAudio = audioFiles.filter(audio => audio.kind !== 'listening-copy');
  const listeningCopies = audioFiles.filter(audio => audio.kind === 'listening-copy');
  check(originalAudio.length === 477 && new Set(originalAudio.map(audio => audio.id)).size === 477, 'local_expected_original_audio_count');
  check(listeningCopies.length === 128 && new Set(audioFiles.map(audio => audio.id)).size === 605, 'local_expected_listening_copy_count');
  check(listeningCopies.every(copy => copy.format === 'mp3' && /128 kbps/.test(copy.encoding) &&
    originalAudio.some(source => source.id === copy.derivedFromId && source.format === 'wav')), 'local_listening_copy_provenance');
  check(data.entries.every(entry => !entry.audio.length || entry.audio.some(audio =>
    audio.id === entry.preferredAudioId && audio.format === 'mp3' && audio.available)), 'local_all_playback_prefers_mp3');
  check(audioFiles.every(audio => audio.available === true), 'local_all_audio_available');
  check(Object.values(data.assets).filter(asset => /^audio\//i.test(asset.contentType)).length === 605, 'local_audio_asset_count');
  check(audioFiles.every(audio => {
    const asset = data.assets[audio.id];
    const planned = uploadPlan.assets.find(item => item.id === audio.id);
    return asset && planned && /^audio\//i.test(asset.contentType) && asset.bytes === audio.bytes &&
      planned.bytes === asset.bytes && planned.pathname === asset.pathname && planned.sha256 === asset.sha256 &&
      typeof planned.localPath === 'string';
  }), 'local_audio_manifest_and_upload_plan_match');
  const expected = {
    sessions: data.entries.length,
    recordings: originalAudio.length,
    moments: data.entries.reduce((n, entry) => n + entry.moments.length, 0),
    original: data.entries.filter(entry => entry.origin === 'archived_research').length,
    talkbankAi: data.entries.filter(entry => entry.origin === 'talkbank_ai_draft').length,
    localAi: data.entries.filter(entry => entry.origin === 'local_ai_draft').length,
  };
  check(expected.original === 78 && expected.talkbankAi === 13 && expected.localAi === 300, 'local_expected_provenance_counts');

  async function call(path, label, { cookie, origin, body, range, method = 'GET' } = {}) {
    stage = label;
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (origin !== undefined) headers.Origin = origin;
    if (range) headers.Range = range;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      return await fetch(new URL(path, base), {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual', signal: AbortSignal.timeout(45_000), cache: 'no-store',
      });
    } catch { throw new VerificationFailure(`${label}:request_failed`); }
  }
  async function expectStatus(response, expectedStatus, label, privateHeaders = true) {
    check(response.status === expectedStatus, `${label}:status`, { expectedStatus, actualStatus: response.status });
    if (privateHeaders) privateResponse(response, label);
    return response;
  }

  const root = await call('/', 'public_root');
  await expectStatus(root, 200, 'public_root', true);
  const html = await root.text();
  const markers = ['Seth Wilson', 'An unlisted collection', data.entries[0].title, data.entries[0].sourceName, data.entries[0].overview].filter(Boolean);
  check(markers.every(marker => !html.includes(marker)), 'public_root:no_static_archive');
  check(/<title>\s*The Seth Tapes\s*<\/title>/.test(html), 'public_root:archive_title');
  check(html.includes('action="/search"') && html.includes('href="/sessions"') && html.includes('href="/research"') && html.includes('href="/about"'), 'public_root:entry_points');
  check((root.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"), 'public_root:frame_protection');
  if (!local) check(!(root.headers.get('content-security-policy') || '').includes("'unsafe-eval'"), 'production:no_unsafe_eval');
  const robots = await call('/robots.txt', 'robots');
  await expectStatus(robots, 200, 'robots', false);
  const robotsText = await robots.text();
  check(/User-agent:\s*\*/i.test(robotsText), 'robots:all_agents');
  check(/^Disallow:\s*\/\s*$/im.test(robotsText), 'robots:disallow_all');

  const representative = data.entries.find(entry => entry.sources.length > 0);
  check(Boolean(representative), 'local_source_available');
  const endpoints = [
    ['/api/catalog', 'catalog'], ['/api/session', 'session'], ['/api/share', 'share'],
    [`/api/entries/${encodeURIComponent(representative.id)}`, 'entry'],
    [`/api/assets/${encodeURIComponent(representative.sources[0].id)}`, 'asset'],
    [`/api/assets/${encodeURIComponent(audioFiles[0].id)}`, 'audio_asset'],
  ];
  for (const [path, label] of endpoints) {
    const response = await call(path, `anonymous_${label}`);
    await expectStatus(response, path.startsWith('/api/assets/') ? 307 : 200, `anonymous_${label}`);
    await response.body?.cancel();
  }
  counts.publicEndpoints = endpoints.length;
  await expectStatus(await call('/api/catalog', 'obsolete_cookie_ignored', { cookie: 'archive_session=v1.0.1.invalid' }), 200, 'obsolete_cookie_ignored');
  for (const [label, origin] of [['foreign_origin', 'https://unrelated.invalid'], ['opaque_origin', 'null'], ['missing_origin', undefined]]) {
    await expectStatus(await call('/api/access', label, { method: 'POST', origin, body: { key: 'deliberately-invalid-key' } }), 403, label);
  }
  const access = await call('/api/access', 'legacy_access_compatible', { method: 'POST', origin: base.origin, body: { key: 'obsolete-link-still-works' } });
  await expectStatus(access, 200, 'legacy_access_compatible');
  check(access.headers.getSetCookie().every(value => !/Max-Age=[1-9]/i.test(value)), 'legacy_access:no_new_session');
  const cookie = undefined;

  const catalogResponse = await call('/api/catalog', 'authorized_catalog', { cookie });
  await expectStatus(catalogResponse, 200, 'authorized_catalog');
  const catalog = await bodyJson(catalogResponse, 'authorized_catalog');
  check(Object.entries(expected).every(([name, value]) => catalog.counts[name] === value), 'catalog:counts_match');
  check(catalog.documents.length === data.documents.length, 'catalog:document_count_match');
  check(excluded.every(id => !catalog.documents.some(document => document.id === id)), 'catalog:personal_briefs_excluded');
  Object.assign(counts, expected, { documents: catalog.documents.length, downloadableAssets: Object.keys(data.assets).length });

  const detailResponse = await call(`/api/entries/${encodeURIComponent(representative.id)}`, 'entry_detail', { cookie });
  await expectStatus(detailResponse, 200, 'entry_detail');
  const detail = await bodyJson(detailResponse, 'entry_detail');
  check(detail.id === representative.id && detail.transcript.length === representative.transcript.length && detail.moments.length === representative.moments.length, 'entry_detail:content_counts_match');
  check(detail.recordings.length === representative.audio.length && detail.recordings.every(recording => recording.available === true), 'entry_detail:audio_available');

  // Verify per-request `/sessions` browse page and `/sessions/[id]` SSR pages, private headers, collision slugs, and 404 headers.
  const sessionsBrowseResponse = await call('/sessions', 'sessions_browse');
  await expectStatus(sessionsBrowseResponse, 200, 'sessions_browse');
  const sessionsBrowseHtml = await sessionsBrowseResponse.text();
  check(/<title>\s*Sessions · The Seth Tapes\s*<\/title>/.test(sessionsBrowseHtml), 'sessions_browse:title_format');
  check(sessionsBrowseHtml.includes('Age 1') && sessionsBrowseHtml.includes('Age 2'), 'sessions_browse:age_groups');
  check((sessionsBrowseResponse.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"), 'sessions_browse:frame_protection');

  const agedSession = data.entries.find(entry => entry.ages.length > 0) || representative;
  const agedSlug = sessionSlug(agedSession);
  check(sessionsBrowseHtml.includes(`/sessions/${encodeURIComponent(agedSlug)}`), 'sessions_browse:session_link');
  const sessionPageResponse = await call(`/sessions/${encodeURIComponent(agedSlug)}`, 'session_page');
  await expectStatus(sessionPageResponse, 200, 'session_page');
  const sessionPageHtml = await sessionPageResponse.text();
  check(sessionPageHtml.includes(`Session ${agedSlug}`), 'session_page:slug_in_html');
  check(
    new RegExp(`<title>[^<]*Session ${agedSlug.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}[^<]*The Seth Tapes\\s*</title>`).test(sessionPageHtml),
    'session_page:title_format',
  );
  check((sessionPageResponse.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"), 'session_page:frame_protection');
  for (const [slug, label] of [['011119d', 'session_page_011119d'], ['011119d-82-supp', 'session_page_011119d_supp']]) {
    const res = await call(`/sessions/${encodeURIComponent(slug)}`, label);
    await expectStatus(res, 200, label);
    await res.body?.cancel();
  }
  const missingSessionResponse = await call('/sessions/unknown-release-test-session', 'unknown_session_page');
  await expectStatus(missingSessionResponse, 404, 'unknown_session_page');
  const missingSessionHtml = await missingSessionResponse.text();
  check(/Session not found/i.test(missingSessionHtml), 'unknown_session_page:helpful_message');
  counts.sessionRoutesVerified = 5;

  // Verify per-request `/research`, `/research/[doc]` (200 & 404), and `/about` SSR pages and private headers.
  const researchIndexResponse = await call('/research', 'research_page');
  await expectStatus(researchIndexResponse, 200, 'research_page');
  const researchIndexHtml = await researchIndexResponse.text();
  check(/<title>\s*Research &(?:amp;)? context · The Seth Tapes\s*<\/title>/.test(researchIndexHtml), 'research_page:title_format');
  check((researchIndexResponse.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"), 'research_page:frame_protection');
  const researchDocs = data.documents.filter(doc => doc.category !== 'overview');
  check(researchDocs.every(doc => researchIndexHtml.includes(`/research/${encodeURIComponent(doc.id)}`)), 'research_page:lists_all_documents');
  check(excluded.every(id => !researchIndexHtml.includes(id)), 'research_page:personal_briefs_excluded');

  const representativeDoc = researchDocs.find(doc => doc.id === 'annotation-provenance') || researchDocs[0];
  check(Boolean(representativeDoc), 'local_research_document_available');
  const researchDocResponse = await call(`/research/${encodeURIComponent(representativeDoc.id)}`, 'research_doc_page');
  await expectStatus(researchDocResponse, 200, 'research_doc_page');
  const researchDocHtml = await researchDocResponse.text();
  check(researchDocHtml.includes('· Research · The Seth Tapes</title>'), 'research_doc_page:title_format');
  check(/<h1[\s>]/i.test(researchDocHtml), 'research_doc_page:heading_present');
  check((researchDocResponse.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"), 'research_doc_page:frame_protection');
  check(excluded.every(id => !researchDocHtml.includes(id)), 'research_doc_page:personal_briefs_excluded');

  const missingDocResponse = await call('/research/unknown-release-test-document', 'unknown_research_doc_page');
  await expectStatus(missingDocResponse, 404, 'unknown_research_doc_page');
  const missingDocHtml = await missingDocResponse.text();
  check(/Document not found/i.test(missingDocHtml), 'unknown_research_doc_page:helpful_message');

  const aboutResponse = await call('/about', 'about_page');
  await expectStatus(aboutResponse, 200, 'about_page');
  const aboutHtml = await aboutResponse.text();
  check(/<title>\s*About &(?:amp;)? methods · The Seth Tapes\s*<\/title>/.test(aboutHtml), 'about_page:title_format');
  check((aboutResponse.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"), 'about_page:frame_protection');
  check(aboutHtml.includes('id="inferred-ages"'), 'about_page:inferred_ages_anchor');
  check(aboutHtml.includes('78 of 78'), 'about_page:78_of_78_evidence');
  check(
    aboutHtml.includes(`${expected.sessions.toLocaleString()} sessions`)
      && aboutHtml.includes(`${expected.recordings.toLocaleString()} original recordings`)
      && aboutHtml.includes(`${expected.original.toLocaleString()} archived research`)
      && aboutHtml.includes(`${expected.talkbankAi.toLocaleString()} TalkBank AI`)
      && aboutHtml.includes(`${expected.localAi.toLocaleString()} local AI`),
    'about_page:live_origin_counts',
  );
  counts.researchAndAboutRoutesVerified = 4;

  // Verify per-request `/search` SSR page, private headers, privacy-safe titles, and zero leaked archive text.
  const searchPageResponse = await call('/search', 'search_page');
  await expectStatus(searchPageResponse, 200, 'search_page');
  const searchPageHtml = await searchPageResponse.text();
  check(/<title>\s*Search · The Seth Tapes\s*<\/title>/.test(searchPageHtml), 'search_page:title');
  check((searchPageResponse.headers.get('content-security-policy') || '').includes("frame-ancestors 'none'"), 'search_page:frame_protection');
  check(markers.every(marker => !searchPageHtml.includes(marker)), 'search_page:no_static_archive');

  const filteredSearchPageResponse = await call('/search?q=releasechecktoken&ageMin=18&ageMax=36', 'search_page_filtered');
  await expectStatus(filteredSearchPageResponse, 200, 'search_page_filtered');
  const filteredSearchPageHtml = await filteredSearchPageResponse.text();
  check(/<title>\s*Search results · The Seth Tapes\s*<\/title>/.test(filteredSearchPageHtml), 'search_page_filtered:title');
  check(!/<title>[^<]*releasechecktoken/i.test(filteredSearchPageHtml), 'search_page_filtered:no_query_in_title');

  const concordancePageResponse = await call('/search?q=releasechecktoken&view=concordance', 'search_page_concordance');
  await expectStatus(concordancePageResponse, 200, 'search_page_concordance');
  const concordancePageHtml = await concordancePageResponse.text();
  check(/<title>\s*Concordance · The Seth Tapes\s*<\/title>/.test(concordancePageHtml), 'search_page_concordance:title');
  check(!/<title>[^<]*releasechecktoken/i.test(concordancePageHtml), 'search_page_concordance:no_query_in_title');
  counts.searchRoutesVerified = 3;

  // Verify permanent HTTP 308 legacy link redirects (?entry=, ?passage=, ?document=, ?marker=) and 404s with private headers.
  async function expectLegacyRedirect(path, expectedTarget, label) {
    const res = await call(path, label);
    await expectStatus(res, 308, label);
    const rawLocation = res.headers.get('location');
    check(Boolean(rawLocation), `${label}:location_present`);
    let resolvedLocation;
    try { resolvedLocation = new URL(rawLocation, base); } catch { throw new VerificationFailure(`${label}:location_valid`); }
    check(
      resolvedLocation.origin === base.origin
        && `${resolvedLocation.pathname}${resolvedLocation.search}${resolvedLocation.hash}` === expectedTarget,
      `${label}:location_match`,
      { expectedTarget },
    );
    await res.body?.cancel();
  }

  await expectLegacyRedirect(
    `/?entry=${encodeURIComponent(agedSession.id)}`,
    `/sessions/${encodeURIComponent(agedSlug)}`,
    'legacy_entry_redirect',
  );
  await expectLegacyRedirect(
    `/?entry=${encodeURIComponent(agedSession.id)}&passage=3`,
    `/sessions/${encodeURIComponent(agedSlug)}#p3`,
    'legacy_entry_passage_redirect',
  );
  await expectLegacyRedirect(
    '/?entry=local-0extra-82-supp-011119d',
    '/sessions/011119d-82-supp',
    'legacy_entry_collision_redirect',
  );
  await expectLegacyRedirect(
    `/?document=${encodeURIComponent(representativeDoc.id)}`,
    `/research/${encodeURIComponent(representativeDoc.id)}`,
    'legacy_document_redirect',
  );
  await expectLegacyRedirect(
    '/?document=methods-and-audit',
    data.documents.some(doc => doc.id === 'methods-and-audit') ? '/research/methods-and-audit' : '/about',
    'legacy_methods_document_redirect',
  );
  await expectLegacyRedirect(
    '/?marker=repetition&speaker=any',
    '/search?marker=repetition&speaker=any',
    'legacy_marker_speaker_redirect',
  );
  await expectLegacyRedirect(
    '/?marker=repetition',
    '/search?marker=repetition',
    'legacy_marker_default_redirect',
  );

  for (const [path, label, titleRe] of [
    ['/?entry=unknown-release-test-session', 'legacy_unknown_entry', /Session not found/i],
    ['/?document=unknown-release-test-document', 'legacy_unknown_document', /Document not found/i],
  ]) {
    const missingLegacy = await call(path, label);
    await expectStatus(missingLegacy, 404, label);
    const missingLegacyHtml = await missingLegacy.text();
    check(titleRe.test(missingLegacyHtml), `${label}:not_found_title`);
    check(/href="\/search"|\\"href\\":\\"\/search\\"/.test(missingLegacyHtml), `${label}:search_link_present`);
  }
  counts.legacyRedirectsVerified = 9;

  // Production BotID deliberately rejects this non-browser search client.
  // Exercise search semantics locally; verify real browser search separately.
  if (!local) {
    await expectStatus(await call('/api/search', 'bot_search', { method: 'POST', origin: base.origin, body: { query: 'test' } }), 403, 'bot_search');
    await expectStatus(await call('/api/concordance', 'bot_concordance', { method: 'POST', origin: base.origin, body: { query: 'test' } }), 403, 'bot_concordance');
    counts.botRequestsRejected = 2;
  }
  const origins = local ? ['archived_research', 'talkbank_ai_draft', 'local_ai_draft'] : [];
  for (const [index, origin] of origins.entries()) {
    const entry = data.entries.find(value => value.origin === origin);
    const runSearch = async (body, label) => {
      const response = await call('/api/search', label, { method: 'POST', cookie, origin: base.origin, body });
      await expectStatus(response, 200, label);
      return bodyJson(response, label);
    };
    const titleResult = await runSearch({ query: entry.title }, `guide_search_${index}`);
    const guideMatch = titleResult.results.find(result => result.session.id === entry.id && result.matchedIn === 'guide');
    check(Boolean(guideMatch), `guide_search_${index}:found`);
    check(guideMatch.session.recordings.length === entry.audio.length && guideMatch.session.recordings.every(recording => recording.available === true), `guide_search_${index}:audio_available`);
    const nonTranscript = [entry.title, entry.sourceName, entry.overview, ...entry.topics, ...entry.audio.map(audio => audio.name), ...entry.moments.flatMap(moment => [moment.title, moment.description])].join(' ').toLowerCase();
    const word = entry.transcript.flatMap(passage => passage.text.match(/\b[a-zA-Z]{5,25}\b/g) || []).find(value => !nonTranscript.includes(value.toLowerCase()));
    check(Boolean(word), `transcript_search_${index}:distinct_query_available`);
    const transcriptResult = await runSearch({ query: `${entry.sourceName} ${word}`, origin }, `transcript_search_${index}`);
    check(transcriptResult.results.some(result => result.session.id === entry.id && result.matchedIn === 'transcript'), `transcript_search_${index}:found`);
    const filtered = await runSearch({ query: entry.sourceName, origin, topic: entry.topics[0] }, `filtered_search_${index}`);
    check(filtered.total > 0 && filtered.results.every(result => result.session.origin === origin && result.session.topics.includes(entry.topics[0])), `filtered_search_${index}:filters_hold`);
  }
  if (local) {
    const agedFilterRes = await call('/api/search', 'age_range_search', { method: 'POST', cookie, origin: base.origin, body: { ageMin: 18, ageMax: 36 } });
    await expectStatus(agedFilterRes, 200, 'age_range_search');
    const agedFilterBody = await bodyJson(agedFilterRes, 'age_range_search');
    check(agedFilterBody.total > 0, 'age_range_search:matches_found');
    const invalidAgeRes = await call('/api/search', 'invalid_age_range', { method: 'POST', cookie, origin: base.origin, body: { ageMin: 36, ageMax: 18 } });
    await expectStatus(invalidAgeRes, 400, 'invalid_age_range');
    await invalidAgeRes.body?.cancel();

    const spokenFirstLine = passage => {
      if (!passage.speaker || !passage.speaker.trim()) return '';
      const line = String(passage.text || '').replace(/\[\[LOCAL AI[\s\S]*?END LOCAL AI EDITORIAL COMMENT\]\]/g, '').split(/\r?\n/, 1)[0].trim();
      return /^(?:\[Source\b|Source \(|Note:|Phonetic transcription\b|Speech-act annotation\b|[%@]\w)/i.test(line) ? '' : line;
    };
    const standaloneWord = line => {
      const match = /(?:^|\s)([a-zA-Z]{5,20})(?=\s|[.,!?;:]|$)/.exec(line);
      return match ? match[1] : null;
    };
    const concordanceEntry = data.entries.find(value => value.origin === 'archived_research' && value.transcript.some(p => Boolean(standaloneWord(spokenFirstLine(p)))));
    check(Boolean(concordanceEntry), 'concordance_search:representative_available');
    const concordanceWord = concordanceEntry.transcript
      .map(p => standaloneWord(spokenFirstLine(p)))
      .find(Boolean);
    check(Boolean(concordanceWord), 'concordance_search:query_available');
    const concordanceRes = await call('/api/concordance', 'concordance_search', { method: 'POST', cookie, origin: base.origin, body: { query: concordanceWord, origin: 'archived_research' } });
    await expectStatus(concordanceRes, 200, 'concordance_search');
    const concordanceBody = await bodyJson(concordanceRes, 'concordance_search');
    const foldToken = value => String(value || '').normalize('NFKD').replace(/\p{Mn}/gu, '').toLowerCase();
    check(
      concordanceBody.total > 0
        && Array.isArray(concordanceBody.rows)
        && concordanceBody.rows.length > 0
        && concordanceBody.rows.every(
          row =>
            row.origin === 'archived_research'
            && row.passageNumber >= 1
            && foldToken(row.match) === foldToken(concordanceWord),
        ),
      'concordance_search:exact_rows_found',
    );
    const invalidConcordanceRes = await call('/api/concordance', 'invalid_concordance', { method: 'POST', cookie, origin: base.origin, body: { query: concordanceWord, ageMin: 36, ageMax: 18 } });
    await expectStatus(invalidConcordanceRes, 400, 'invalid_concordance');
    await invalidConcordanceRes.body?.cancel();
  }
  counts.guideSearchExamples = origins.length;
  counts.transcriptSearchExamples = origins.length;
  counts.filteredSearchExamples = origins.length;

  await expectStatus(await call('/api/assets/unknown-release-test-asset', 'unknown_asset', { cookie }), 404, 'unknown_asset');
  const shareResponse = await call('/api/share', 'share_link', { cookie });
  await expectStatus(shareResponse, 200, 'share_link');
  const share = await bodyJson(shareResponse, 'share_link');
  check(share.url === '/', 'share_link:ordinary_relative_url');
  check(new URL(share.url, base).origin === base.origin, 'share_link:actual_origin');

  const sourceId = representative.sources[0].id;
  const expectedAsset = data.assets[sourceId];
  check(Boolean(expectedAsset), 'download:manifest_asset_present');
  const redirectedSource = await call(`/api/assets/${encodeURIComponent(sourceId)}`, 'source_redirect', { cookie });
  await expectStatus(redirectedSource, 307, 'source_redirect');
  let redirectUrl;
  try { redirectUrl = new URL(redirectedSource.headers.get('location')); } catch { throw new VerificationFailure('source_redirect:url_valid'); }
  check(redirectUrl.protocol === 'https:' && /^[a-z0-9-]+\.private\.blob\.vercel-storage\.com$/i.test(redirectUrl.hostname) && decodeURIComponent(redirectUrl.pathname) === '/' + expectedAsset.pathname, 'source_redirect:private_expected_file');
  const signedResponse = await call(`/api/assets/${encodeURIComponent(sourceId)}?json=1`, 'signed_source', { cookie });
  await expectStatus(signedResponse, local ? 200 : 403, 'signed_source');
  const signed = local ? await bodyJson(signedResponse, 'signed_source') : { url: redirectUrl.href };
  let signedUrl;
  try { signedUrl = new URL(signed.url); } catch { throw new VerificationFailure('signed_source:url_valid'); }
  check(signedUrl.protocol === 'https:' && /^[a-z0-9-]+\.private\.blob\.vercel-storage\.com$/i.test(signedUrl.hostname) && !signedUrl.username && !signedUrl.password && !signedUrl.port, 'signed_source:private_storage_origin');
  check(decodeURIComponent(signedUrl.pathname) === '/' + expectedAsset.pathname, 'signed_source:correct_path');
  if (local) check(signed.expiresAt > Date.now() && signed.expiresAt <= Date.now() + 3_660_000, 'signed_source:short_expiry');
  stage = 'signed_source_download';
  const download = await fetch(signedUrl, { redirect: 'manual', signal: AbortSignal.timeout(45_000), cache: 'no-store' });
  check(download.status === 200, 'download:status', { actualStatus: download.status });
  check(expectedAsset.bytes <= 2 * 1024 * 1024, 'download:small_transcript_sample');
  const bytes = await boundedBytes(download, expectedAsset.bytes, 'download');
  check(bytes.length === expectedAsset.bytes, 'download:byte_count');
  check(createHash('sha256').update(bytes).digest('hex') === expectedAsset.sha256, 'download:sha256_match');
  counts.verifiedDownloadBytes = bytes.length;
  const unsignedUrl = new URL(signedUrl);
  unsignedUrl.search = '';
  unsignedUrl.hash = '';
  stage = 'unsigned_source_request';
  const unsigned = await fetch(unsignedUrl, { headers: { Range: 'bytes=0-0' }, redirect: 'manual', signal: AbortSignal.timeout(45_000), cache: 'no-store' });
  await unsigned.body?.cancel();
  check([401, 403].includes(unsigned.status), 'unsigned_source:denied', { actualStatus: unsigned.status });

  // Exercise original MP3 playback, a converted MP3, and original WAV download.
  // Only 6 KiB total: each file's first 1 KiB and a 1 KiB range halfway through it.
  counts.audioVariantsVerified = 0;
  counts.audioRangesVerified = 0;
  counts.verifiedAudioBytes = 0;
  for (const [format, audio] of [
    ['original_mp3', originalAudio.find(value => value.format === 'mp3')],
    ['listening_mp3', listeningCopies[0]],
    ['original_wav', originalAudio.find(value => value.format === 'wav')],
  ]) {
    check(Boolean(audio), `audio_${format}:representative_available`);
    const asset = data.assets[audio.id];
    const planned = uploadPlan.assets.find(value => value.id === audio.id);
    check(asset.bytes >= 4096, `audio_${format}:sufficient_length`);

    const redirect = await call(`/api/assets/${encodeURIComponent(audio.id)}?download=1`, `audio_${format}_redirect`, { cookie, range: 'bytes=0-1023' });
    await expectStatus(redirect, 307, `audio_${format}_redirect`);
    let redirectUrl;
    try { redirectUrl = new URL(redirect.headers.get('location')); } catch { throw new VerificationFailure(`audio_${format}:redirect_valid`); }
    check(redirectUrl.protocol === 'https:' && /^[a-z0-9-]+\.private\.blob\.vercel-storage\.com$/i.test(redirectUrl.hostname) && decodeURIComponent(redirectUrl.pathname) === '/' + asset.pathname, `audio_${format}:redirect_private_expected_file`);
    check(redirectUrl.searchParams.get('download') === '1', `audio_${format}:attachment_requested`);

    const signedResponse = await call(`/api/assets/${encodeURIComponent(audio.id)}?json=1`, `signed_audio_${format}`, { cookie });
    await expectStatus(signedResponse, local ? 200 : 403, `signed_audio_${format}`);
    const signedAudio = local ? await bodyJson(signedResponse, `signed_audio_${format}`) : { url: redirectUrl.href };
    let audioUrl;
    try { audioUrl = new URL(signedAudio.url); } catch { throw new VerificationFailure(`audio_${format}:url_valid`); }
    check(audioUrl.protocol === 'https:' && /^[a-z0-9-]+\.private\.blob\.vercel-storage\.com$/i.test(audioUrl.hostname) && !audioUrl.username && !audioUrl.password && !audioUrl.port, `audio_${format}:private_storage_origin`);
    check(decodeURIComponent(audioUrl.pathname) === '/' + asset.pathname, `audio_${format}:correct_path`);
    if (local) check(signedAudio.expiresAt > Date.now() && signedAudio.expiresAt <= Date.now() + 3_660_000, `audio_${format}:short_expiry`);
    check(!Object.hasOwn(signedAudio, 'localPath'), `audio_${format}:no_local_path`);

    // Read canonical bytes from the local-only upload plan, never a path supplied
    // by an HTTP response. No whole-file reads or repeated whole-file hashing.
    const canonical = await open(planned.localPath, 'r');
    try {
      check((await canonical.stat()).size === asset.bytes, `audio_${format}:local_size_matches`);
      for (const [sample, start] of [['start', 0], ['seek', Math.floor(asset.bytes / 2)]]) {
        const label = `audio_${format}_${sample}`;
        const end = start + 1023;
        stage = label;
        const response = await fetch(audio.format === 'wav' ? redirectUrl : audioUrl, {
          headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
          redirect: 'manual', signal: AbortSignal.timeout(45_000), cache: 'no-store',
        });
        if (response.status !== 206) await response.body?.cancel();
        check(response.status === 206, `${label}:partial_content`, { actualStatus: response.status });
        const validRange = response.headers.get('content-range') === `bytes ${start}-${end}/${asset.bytes}`;
        const validLength = response.headers.get('content-length') === '1024';
        if (!validRange || !validLength) await response.body?.cancel();
        check(validRange, `${label}:content_range`);
        check(validLength, `${label}:content_length`);
        const mediaType = (response.headers.get('content-type') || '').split(';', 1)[0].toLowerCase();
        if (mediaType !== asset.contentType.toLowerCase()) await response.body?.cancel();
        check(mediaType === asset.contentType.toLowerCase(), `${label}:media_type`);
        if (audio.format === 'wav') check(/^attachment(?:;|$)/i.test(response.headers.get('content-disposition') || ''), `${label}:original_download_attachment`);
        const received = await boundedBytes(response, 1024, label);
        check(received.length === 1024, `${label}:byte_count`);
        const expectedBytes = Buffer.alloc(1024);
        const { bytesRead } = await canonical.read(expectedBytes, 0, 1024, start);
        check(bytesRead === 1024, `${label}:local_byte_count`);
        check(createHash('sha256').update(received).digest('hex') === createHash('sha256').update(expectedBytes).digest('hex'), `${label}:canonical_sha256_match`);
        counts.audioRangesVerified++;
        counts.verifiedAudioBytes += received.length;
      }
    } finally { await canonical.close(); }

    const unsignedAudioUrl = new URL(audioUrl);
    unsignedAudioUrl.search = '';
    unsignedAudioUrl.hash = '';
    stage = `unsigned_audio_${format}`;
    const unsignedAudio = await fetch(unsignedAudioUrl, {
      headers: { Range: 'bytes=0-0' }, redirect: 'manual', signal: AbortSignal.timeout(45_000), cache: 'no-store',
    });
    await unsignedAudio.body?.cancel();
    check([401, 403].includes(unsignedAudio.status), `unsigned_audio_${format}:denied`, { actualStatus: unsignedAudio.status });
    counts.audioVariantsVerified++;
  }

  console.log(JSON.stringify({ ok: true, target: local ? 'local' : 'production', checkedAt: new Date().toISOString(), checkCount: checks.length, counts }, null, 2));
}

main().catch(error => {
  console.log(JSON.stringify({ ok: false, stage, failedCheck: error instanceof VerificationFailure ? error.check : 'unexpected_runtime_failure', ...(error instanceof VerificationFailure ? error.details : {}), passedCheckCount: checks.length, counts }, null, 2));
  process.exitCode = 1;
});
