import { cache } from 'react';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { connection } from 'next/server';
import { archive } from '@/lib/archive';
import { resolveServerRequestOrigin } from '@/lib/print';
import { summarizeArchiveForAbout } from '@/lib/research';
import { ARCHIVE_NAME, formatDocumentTitle } from '@/lib/site';
import ArchiveAnalytics from '@/components/ArchiveAnalytics';
import HowToCiteSection from '@/components/HowToCiteSection';
import RouteHeader from '@/components/RouteHeader';
import SiteFooter from '@/components/SiteFooter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: formatDocumentTitle({ kind: 'about' }),
  description: `Sources, transcript origins, inferred ages, privacy policy, and citation guidance for ${ARCHIVE_NAME}.`,
};

const loadAboutSummary = cache(async () => {
  await connection();
  const data = await archive();
  return summarizeArchiveForAbout(data);
});

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;
}

export default async function AboutPage() {
  const [stats, headerList] = await Promise.all([loadAboutSummary(), headers()]);
  const requestOrigin = resolveServerRequestOrigin(headerList);
  const accessDate = new Date().toISOString().slice(0, 10);

  return (
    <div className="archive-shell">
      <ArchiveAnalytics ready section="about" sessionId={null} documentId={null} />
      <RouteHeader activeSection="about" showShare sharePath="/about" shareTargetLabel="page" />
      <main id="main" tabIndex={-1} className="reading-layout">
        <article className="about-page reading-column">
          <header className="detail-header">
            <p className="eyebrow">Collection guide &amp; methods</p>
            <h1>About &amp; methods</h1>
            <p className="section-intro">
              {ARCHIVE_NAME} is a childhood-language archive from the Peters/Wilson corpus — an unlisted special-collections reader for family members and researchers alike. This page explains where every transcript, guide, age, and recording comes from, and how to verify and cite what you read.
            </p>
          </header>

          <nav className="about-toc" aria-label="On this page">
            <p className="eyebrow">On this page</p>
            <ul>
              <li><a href="#transcript-origins">Transcript origins</a></li>
              <li><a href="#ai-guides">AI-written guides</a></li>
              <li><a href="#inferred-ages">Inferred ages and dates</a></li>
              <li><a href="#timestamps">Approximate timestamps</a></li>
              <li><a href="#access-and-analytics">Unlisted access and analytics</a></li>
              <li><a href="#search-privacy">Search privacy</a></li>
              <li><a href="#how-to-cite">How to cite</a></li>
            </ul>
          </nav>

          <section className="about-section" aria-labelledby="transcript-origins">
            <h2 id="transcript-origins">What is in the collection &amp; the three transcript origins</h2>
            <p>
              This collection currently holds <strong>{plural(stats.sessions, 'session', 'sessions')}</strong> paired with{' '}
              <strong>{plural(stats.recordings, 'original recording', 'original recordings')}</strong>
              {stats.listeningCopies > 0
                ? ` (plus ${plural(stats.listeningCopies, 'labelled MP3 listening copy', 'labelled MP3 listening copies')})`
                : ''}
              , <strong>{plural(stats.moments, 'curated guide moment', 'curated guide moments')}</strong>, and{' '}
              <strong>{plural(stats.documents, 'research and context document', 'research and context documents')}</strong>.
              Each <strong>session</strong> bundles one transcript source with its AI-written guide and associated recordings; uniqueness as distinct real-world recording events is not independently verified.
            </p>
            <p>
              Every session, excerpt, and search hit visibly names its <strong>transcript origin</strong> so you can tell immediately where the speech text came from:
            </p>
            <dl className="catalog-record catalog-record--full about-origins-record">
              <div className="catalog-record-row">
                <dt>Archived research</dt>
                {' '}
                <dd className="about-origin-detail">
                  <span className="origin-badge archived_research">
                    {plural(stats.original, 'archived research session', 'archived research sessions')}
                  </span>
                  {' '}
                  <p>
                    The original study transcripts from the Peters/Wilson corpus in CHAT format. Their speech text comes from the archived research transcripts; linguistic annotation tiers may include later automated additions.
                  </p>
                </dd>
              </div>
              {' '}
              <div className="catalog-record-row">
                <dt>TalkBank AI drafts</dt>
                {' '}
                <dd className="about-origin-detail">
                  <span className="origin-badge talkbank_ai_draft">
                    {plural(stats.talkbankAi, 'TalkBank AI draft', 'TalkBank AI drafts')}
                  </span>
                  {' '}
                  <p>
                    Unreviewed machine speech-recognition drafts supplied by TalkBank. Wording, speaker labels, and timings require checking against the recording.
                  </p>
                </dd>
              </div>
              {' '}
              <div className="catalog-record-row">
                <dt>Local AI drafts</dt>
                {' '}
                <dd className="about-origin-detail">
                  <span className="origin-badge local_ai_draft">
                    {plural(stats.localAi, 'local AI draft', 'local AI drafts')}
                  </span>
                  {' '}
                  <p>
                    Unreviewed machine speech-recognition drafts generated locally with Whisper for this collection so recordings without archived transcripts can still be searched and browsed. Words, speakers, and timing remain unverified.
                  </p>
                </dd>
              </div>
            </dl>
            <p>
              For deeper archival notes on annotation layers, recording coverage, and associated scholarship, browse <a href="/research">Research &amp; context</a>.
            </p>
          </section>

          <section className="about-section" aria-labelledby="ai-guides">
            <h2 id="ai-guides">What AI-written guides are — and are not</h2>
            <p>
              Every session includes an AI-written <strong>guide</strong>: an overview, curated themes, and highlighted <strong>moments</strong> generated from that session’s transcript text. Guides act like a librarian’s finding aid so serious readers can orient themselves quickly across hundreds of recordings.
            </p>
            <div className="provenance-note">
              <p>
                <strong>Guides are never evidence of what was said.</strong> A guide is an editorial companion layered on top of a transcript — it is not part of the source transcript, and no one listened to the audio independently to verify the guide’s summaries.
              </p>
            </div>
            <p>
              When you want to quote, verify, or analyze speech, always follow the guide back to the underlying numbered transcript <strong>passages</strong> and, wherever available, listen to the recording itself.
            </p>
          </section>

          <section className="about-section" aria-labelledby="inferred-ages">
            <h2 id="inferred-ages">Source ages, inferred ages, and calendar dates</h2>
            <p>
              Child age is the primary way to browse the collection longitudinally. Because source ages and inferred ages carry different levels of evidence, the archive stores and displays them separately and never merges them:
            </p>
            <ul>
              <li>
                <strong>Source ages ({plural(stats.sourceAgeSessions, 'session', 'sessions')}):</strong> The child’s age recorded directly inside a transcript’s own CHAT metadata, using standard <code>years;months.days</code> notation (for example, <code>1;06.26</code> for 1 year, 6 months, 26 days).
              </li>
              <li>
                <strong>Inferred ages ({plural(stats.inferredAgeSessions, 'session', 'sessions')}):</strong> When a session has no recorded source age — primarily machine drafts — the reader parses the six-digit filename stem using the same years–months–days pattern (for example, <code>010626</code> corresponds to <code>1;06.26</code>, with optional letter suffixes distinguishing sessions from the same age). Inferred ages are always visibly labelled <em>(inferred from filename)</em>.
              </li>
              {stats.unagedSessions > 0 && (
                <li>
                  <strong>Without recorded or inferred age ({plural(stats.unagedSessions, 'session', 'sessions')}):</strong> Sessions with neither CHAT age metadata nor a parseable six-digit filename stem are displayed without an age and appear at the end of age-sorted lists.
                </li>
              )}
            </ul>
            <p>
              <strong>Why we trust the filename pattern (78-of-78 evidence):</strong> Across all <strong>78 archived research transcripts</strong> in the corpus that record the child’s source age in CHAT metadata, <strong>78 of 78</strong> match their six-digit filename stem exactly. Even with that 78-of-78 match, inferred ages remain explicitly labelled and stored separately from source ages so provenance stays transparent.
            </p>
            <p>
              <strong>Calendar dates are never inferred.</strong> Recording dates appear only where established directly by source metadata. Filename stems are never converted into calendar dates.
            </p>
          </section>

          <section className="about-section" aria-labelledby="timestamps">
            <h2 id="timestamps">Approximate timestamps and original recordings</h2>
            <p>
              Transcript <strong>timestamps</strong> and guide moment time spans are <strong>approximate navigation aids</strong>, not independently verified alignments. Automatic speech recognition can drift, merge utterances, or misplace boundaries, and some archived research passages carry no timestamps at all.
            </p>
            <p>
              Transcript timestamps are shown as plain text for orientation and citation; they do not control the recording. A link ending in a time, such as <code>#t=12:34</code>, jumps to the transcript passage nearest that time and highlights it. It never starts, moves or loads the recording, which plays only from its own controls.
            </p>
            <p>
              Original recordings (MP3 and WAV) are preserved byte-for-byte without transcoding or editing and remain downloadable in their original format. Where a session has only a WAV original, a clearly labelled MP3 listening copy may be provided alongside it for smoother browser playback without replacing the original WAV.
            </p>
          </section>

          <section className="about-section" aria-labelledby="access-and-analytics">
            <h2 id="access-and-analytics">Unlisted access and analytics policy</h2>
            <p>
              <strong>Unlisted access:</strong> {ARCHIVE_NAME} is publicly reachable to anyone with the URL — there are no accounts, passwords, or sharing keys. Search-engine exclusion headers (<code>X-Robots-Tag: noindex</code>), <code>Referrer-Policy: no-referrer</code>, and <code>robots.txt</code> discourage indexing, but they are not access controls. Recordings and source downloads live in private storage and are delivered through short-lived signed URLs. Personal reflection briefs and companion interpretation documents are excluded from this web collection.
            </p>
            <p>
              <strong>Privacy-preserving analytics:</strong> Lightweight usage analytics run on production only and pass through a strict server-side allowlist. The reader never sends search query text, transcript text, session titles, filenames, signed asset URLs, referrers, or reader identity to analytics — only coarse screen paths, machine IDs, and aggregate numeric signals (such as query length or result count, never the query itself). Persistent browser storage (<code>localStorage</code>) saves only your chosen appearance theme (light, dark, or system) and Details/List view preference; your browser’s tab session history temporarily retains active search filters (including query text) so the Back button can return to your results.
            </p>
          </section>

          <section className="about-section" aria-labelledby="search-privacy">
            <h2 id="search-privacy">Search privacy</h2>
            <p>
              <strong>Exact search</strong> runs entirely inside this application on Vercel against the server-loaded archive index. Exact search queries never leave Vercel for an external search service and are never recorded in analytics.
            </p>
            <p className="muted">
              <em>Upcoming update:</em> When hybrid and semantic search (retrieval by meaning alongside exact search) is introduced in a future update, this section will be updated with full details on how semantic query text is processed while keeping exact search strictly within Vercel.
            </p>
          </section>

          <HowToCiteSection origin={requestOrigin} accessDate={accessDate} />
        </article>
      </main>
      <SiteFooter />
    </div>
  );
}
