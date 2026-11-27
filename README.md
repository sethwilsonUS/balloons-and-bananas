# Balloons & Bananas

A quiet, publicly accessible, unlisted reader for a childhood-language archive. Next.js, React,
TypeScript, MiniSearch, private Vercel Blob storage, and Vercel Web Analytics.
No account provider, remote fonts, or external search service.

## Reader experience

- Overview, recording guides, and research reading list.
- Search across summaries, passages, and complete transcript text, with context
  excerpts and clear source attribution.
- Recordings can use Details (18 guides per page) or a compact List (36 per page).
  List rows keep a short AI-written summary, readable age, date and transcript
  source. Search excerpts and linguistic examples remain available in disclosures.
  Switching views keeps active search filters and returns to the first page.
- Positive theme shortcuts lead into existing recording guides; full summaries
  and source transcripts remain available without content redaction.
- A collapsed Linguistics panel offers source CHAT notation and automatic text
  pattern filters, with source passage examples and direct transcript links.
  Its default child scope uses explicit CHI labels in archived research only;
  anonymous AI speakers are never assigned an identity. Marker counts describe
  matching passages, not developmental scores or corpus-wide frequencies.
- Original research, TalkBank AI drafts, local AI drafts, and AI-written guides
  remain separate layers.
- CHAT transcripts offer a simpler reading view and a “Show linguistic notation”
  toggle. The exact reader text, annotation tiers and source downloads are
  preserved. Linguistic passage links start with notation visible for inspection.
- Recognized repetition, retracing and pause symbols link to other source
  occurrences. These searches initially include any speaker; the speaker filter
  can narrow them. Browser Back returns to the clicked source passage.
- Ages use readable years, months and days, preserving the source's precision.
  Original CHAT age codes remain under Source identification.
- Original recordings are stored privately with their source filenames and
  integrity hashes. Playback and transcript seeking use source timestamps, which
  may be approximate or unverified, especially in AI drafts.
- All playback uses MP3. Existing archive MP3s are preserved; WAV-only entries
  receive clearly labelled 128 kbps MP3 listening copies. Original WAVs remain
  available as downloads, and are never replaced by lossy copies.
- Published research links go to universities and publishers; no new PDF mirrors
  without permission.
- Personal reflection briefs and companion interpretation documents are excluded
  from this family-facing web collection and its hosted downloads.

## Unlisted access

The ordinary site URL opens the archive without a password, account or sharing
key. Previously distributed `#access=…` links still work: the obsolete fragment
is removed while preserving recording, passage and document links. Copy share
link produces an ordinary link to the current location. Legacy access/session
endpoints remain compatible with older open tabs but no longer grant privileges.

Anyone who finds the address can read, copy and reshare the published collection.
No-index headers and robots instructions discourage discovery; they are not
access controls. Files remain in private Blob storage, with the app issuing
short-lived download/playback URLs; this protects storage credentials, not the
publicly shared content. Personal reflection documents remain excluded.

BotID Basic invisibly checks search, playback-URL fetches and analytics requests.
Both client and server explicitly select the free Basic level. There are no
visible CAPTCHA challenges, accounts, or paid Deep Analysis fallback. Catalog
and transcript reads, and native download links, remain open so assistive tools
and normal links keep working. SDK/service failures fail open. This is limited
abuse resistance rather than a barrier to copying this public-domain material;
Vercel's platform DDoS mitigation remains in place.

No archive text or tokens belong in this repository, public assets, build-time
page output, source maps, browser storage, or logs. Only nonsensitive theme and
recording-view preferences are saved in persistent browser storage. `private-data/`, `private-workspace/`, and `.env*` are excluded
from both Git and Vercel uploads.

## Development

### Usage analytics

The Vercel Analytics dashboard reports visits on the production
domain. Development, preview deployments and failed archive loads do not send
events. Five virtual pages describe the overview, recordings, recording reader,
research and document reader; query strings and sharing fragments are excluded.

Custom events cover settled searches and result counts, recording reader views,
guide/passage clicks,
theme/source/linguistic filters, Details/List view, transcript notation and find,
research/source downloads, sharing outcomes, and appearance preferences. Audio
events distinguish actual playback start, resume, pause, end, seeks, speed,
file changes, downloads and errors. Listening milestones at 30 seconds, 2, 10
and 30 minutes count observed elapsed playback rather than timestamp position;
skipping ahead, buffering and signed-URL recovery do not count as listening.
An `audio_end` event means the player reached the end, not that every second was
heard. Downloads describe link clicks, not confirmed completed downloads.

No search terms, transcript text, titles, filenames, sharing keys, signed audio
URLs, referrers, visitor identities or arbitrary error messages enter event
properties. Recording and file references use machine IDs. Search events send
query length and result count on the current Pro plan, never the query. The standard Vercel SDK
runs after the archive loads; a small same-origin relay rebuilds
every collector payload from an allowlist. This also removes SDK-added referrer
and stored attribution fields that are attached after its `beforeSend` hook.
The relay passes browser/IP context for Vercel's normal aggregate visitor
metrics, without forwarding the legacy session cookie or storing that context.

Enable Web Analytics for this Vercel project before deploying. The existing Pro
plan supports two custom properties per event; the server prioritizes the most
useful two (for example recording/milestone or result count/query length). When
Web Analytics Plus is enabled for the team, set `ARCHIVE_ANALYTICS_PLUS=1` in the
production environment and redeploy to retain up to eight properties. Events are
best-effort and can be blocked or lost; they are usage signals, not an audit log.
See [Vercel's current pricing](https://vercel.com/docs/analytics/limits-and-pricing).

### Linguistic discovery

Linguistic filters are navigation aids computed at request time from the existing
readable transcripts. They do not rewrite the catalog, recordings, CHAT files or
research annotations, and make no new model calls. Source notation (repetition,
retracing and pauses) is kept distinct from automatically matched question,
pronoun, negation and deictic word forms. A source CHAT symbol does not establish
who added it; the archive contains layers of later annotation.

Only utterance text is examined. Metadata, commentary and dependent analysis
tiers are excluded. The child-only option requires an explicit CHI source label
and archived research provenance. The all-speaker option includes unidentified
speech-recognition segments, whose wording and punctuation may be wrong.
Annotation coverage is uneven; an empty result does not establish that a feature
was absent from the child's speech. Download CHAT sources for formal analysis.
See the [official CHAT manual](https://talkbank.org/0info/manuals/CHAT.html).

Text queries, themes and source filters intersect linguistic filters at the guide
level; a matching query and marker need not appear in the same passage. Examples
link to one-based transcript passage numbers and open in context without starting
audio. No archive excerpts are included in static client assets or test fixtures.

The simpler transcript view is a display transformation, not a corrected
transcription. It preserves repeated/retraced words and partial-word spellings,
keeps uncertainty and nonverbal information in readable labels, and does not
substitute annotation corrections for the recorded word forms. Local AI drafts
are plain text and are not parsed as CHAT. Find-within-transcript searches the
currently displayed view; turn notation on to search annotation codes or notes.

### Local development

Use Node 24.x (matching Vercel) and install dependencies with `npm ci`.

1. **Configure `.env.local`:** Link the Vercel project and pull development environment variables, or copy `.env.example` to `.env.local`:

   ```bash
   vercel link
   vercel env pull .env.local
   ```

   Set `ARCHIVE_LOCAL_DATA=private-data/archive.json` in `.env.local` so local development reads the archive server-side from disk without calling Vercel Blob (and set `ARCHIVE_DATA_PATH=archive/v1/archive.json` as shown in `.env.example`). Never commit `.env.local` or expose server variables as `NEXT_PUBLIC_*`.

2. **Import the local archive catalog:** Place the required workspace inputs (`work/web-app/archive-file-inventory.json`, `work/web-app/RESEARCH-LINKS.md`, and `outputs/Why-some-recordings-lack-archive-transcripts.md`) in the ignored `private-workspace/` directory, then run the importer against the local source library (default `~/dev/sethlang`) to generate `private-data/archive.json`:

   ```bash
   python3 scripts/import-archive.py --workspace private-workspace
   ```

   Confirm the imported counts match the published collection: 391 sessions and 477 original recordings across the three transcript origins (78 archived research, 13 TalkBank AI drafts, and 300 local AI drafts).

3. **Run and verify locally:**

   ```bash
   npm run dev
   npm run typecheck
   npm test
   npm run build
   ```

`.env.local`, `.vercel/`, `private-data/`, and `private-workspace/` are excluded from Git and Vercel uploads.

### Publishing and archive preparation

After publishing, run `node scripts/verify-release.mjs https://balloons-and-bananas.vercel.app`
from this directory. It reads the local private manifest,
exercises public access, and verifies a signed source download. It prints
only check counts and redacted failure details.

The local importer creates a sanitized catalog and an explicit per-file upload
plan. It preserves original source bytes, participant/source labels, uncertain
dates, missing-audio entries, and distinct transcript variants. Do not upload the
whole source library, symlink tree, operational logs, or private review records.

`node scripts/upload-archive.mjs` uploads only the explicit plan. It streams large
recordings, uses multipart uploads, verifies stored bytes with SHA-256, and saves
resumable receipts locally. The catalog is published last, after all referenced
files pass verification.

Listening copies are prepared separately from the canonical import. Their private
manifest records the source WAV hash, encoding settings, output hash, decoded
sample counts and waveform alignment checks. Run
`python3 scripts/prepare-listening-copies.py` with FFmpeg/libmp3lame, ffprobe and
NumPy available. Once conversion is complete,
`node scripts/add-listening-copies.mjs` adds the verified copies to the catalog
and upload plan. Run `node scripts/upload-archive.mjs` afterward to upload new
assets and publish the updated catalog. Never change the catalog or upload plan
while an uploader is running; it verifies the catalog against the plan it loaded
at startup. Copies and their operational manifests stay in ignored `private-data/`.

Production reads a catalog from `ARCHIVE_DATA_PATH` in a private Blob store. Use
the project-linked server credential; never expose it as `NEXT_PUBLIC_*`.
Downloads are allowlisted by opaque ID and receive per-file, short-lived signed
URLs. Set the sharing key in Vercel's encrypted environment variables.

## Publication and verification

Copyright/reuse terms for source material must be evaluated separately from app
code and storage security. A private repository or unlisted URL does not create
redistribution rights. Preserve corpus citations and link to original research
records wherever mirror rights are unclear.

Before release, check the deployed root and every protected endpoint without a
session, valid-link access, headers and cookies, unsigned storage access, actual
search matches, source counts, internal links, keyboard navigation, and both
color themes. Unit tests and static checks alone do not establish full WCAG
conformance or that an archive interpretation is correct.
