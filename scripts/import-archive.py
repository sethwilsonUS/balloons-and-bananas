#!/usr/bin/env python3
"""Build the private app catalog from the reviewed archive, without changing it.

The only outputs are beneath --output (private-data by default). No network,
upload, credentials, or repository mutation is involved. Canonical transcript
and original audio files are hashed and compared with their integrity baselines.
The upload plan includes the original audio files without transcoding them.
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
import mimetypes
import os
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit


SCRIPT = Path(__file__).resolve()
PROJECT = SCRIPT.parent.parent
TIME_RE = re.compile(r"\[time (\d+:\d+:\d+(?:\.\d+)?) to (\d+:\d+:\d+(?:\.\d+)?)\]")
SPEAKER_RE = re.compile(r"^([^\n]+? \([A-Za-z0-9_]+(?:, [^)]*)?\)):\s*(.*)$", re.S)
LINK_RE = re.compile(r"(?<!!)\[([^\]\n]+)\]\((<[^>]+>|[^)\n]+)\)")
AGE_STEM_RE = re.compile(r"\A([0-9]{2})([0-9]{2})([0-9]{2})[A-Za-z]?\Z")
CHAT_AGE_YMD_RE = re.compile(r"\A(\d+);(\d{1,2})\.(\d{1,2})\Z")
SLUG_RE = re.compile(r"\A[a-z0-9]+(?:-[a-z0-9]+)*\Z")
# Seth's approved resolution for the single filename-stem collision (`011119d`).
# Every other filename-stem collision fails the import hard.
APPROVED_SLUG_OVERRIDES: dict[tuple[str, str], str] = {
    ('transcripts-ai/0wav', '011119d'): '011119d',
    ('transcripts-ai/0extra/82-supp', '011119d'): '011119d-82-supp',
}
LEGACY_LOCAL_AGE_LIMIT = 'Recording date and age are not independently verified from this local AI source; filename ages are not calendar dates.'
INFERRED_LOCAL_AGE_LIMIT = 'Recording date is not established in this local AI source, and calendar dates are never inferred. The displayed age is inferred from the filename stem rather than recorded in source metadata (all 78 archived research transcripts with a source age match their filename stem).'
INFERRED_GENERAL_AGE_LIMIT = 'The displayed age is inferred from the filename stem rather than recorded in source transcript metadata (all 78 archived research transcripts with a source age match their filename stem). Calendar dates are never inferred.'
UNESTABLISHED_LOCAL_AGE_LIMIT = 'Recording date and age are not established in this local AI source; calendar dates are never inferred from filenames.'
CONTENT_TYPES = {'.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.cha': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8', '.json': 'application/json', '.pdf': 'application/pdf', '.html': 'text/html; charset=utf-8'}
OFFICIAL_LINK_HOSTS = {'doi.org', 'hdl.handle.net', 'talkbank.org', 'childes.talkbank.org', 'media.talkbank.org', 'scholarspace.manoa.hawaii.edu', 'pubmed.ncbi.nlm.nih.gov', 'www.cambridge.org', 'journals.sagepub.com', 'benjamins.com', 'www.degruyterbrill.com', 'www.jstor.org'}

# Reader documents deliberately exclude a private set of local documents. The
# identifiers, document-specific rewrites and forbidden patterns live in a
# git-ignored privacy config (see load_privacy_config) so that the public
# repository never names or quotes private material.
DEFAULT_PRIVACY_CONFIG = PROJECT / 'private-config' / 'reader-privacy.json'
EXCLUDED_PERSONAL_DOCUMENTS: dict[str, str] = {}
FORBIDDEN_DOCUMENT_PATTERNS: list[re.Pattern[str]] = []
DOCUMENT_REPLACEMENTS: dict[str, list[tuple[str, str]]] = {}


def load_privacy_config(path: Path) -> None:
    """Load private exclusion rules. Refuse to build without them (fail safe)."""
    if not path.is_file():
        raise SystemExit(f'Privacy config not found: {path}. The import refuses to run without it, '
                         'so that excluded private documents can never reach the reader payload.')
    config = json.loads(path.read_text(encoding='utf-8'))
    excluded = config.get('excludedDocuments')
    patterns = config.get('forbiddenDocumentPatterns')
    replacements = config.get('documentReplacements', {})
    if not isinstance(excluded, dict) or not excluded or not all(isinstance(k, str) and isinstance(v, str) and k and v for k, v in excluded.items()):
        raise SystemExit('Privacy config: excludedDocuments must be a non-empty object of id -> basename')
    if not isinstance(patterns, list) or not patterns or not all(isinstance(x, str) and x for x in patterns):
        raise SystemExit('Privacy config: forbiddenDocumentPatterns must be a non-empty list of regular expressions')
    if not isinstance(replacements, dict) or not all(isinstance(pairs, list) and all(isinstance(pair, list) and len(pair) == 2 and all(isinstance(x, str) for x in pair) for pair in pairs) for pairs in replacements.values()):
        raise SystemExit('Privacy config: documentReplacements must map document ids to [old, new] pairs')
    EXCLUDED_PERSONAL_DOCUMENTS.clear(); EXCLUDED_PERSONAL_DOCUMENTS.update(excluded)
    FORBIDDEN_DOCUMENT_PATTERNS[:] = [re.compile(x, re.I) for x in patterns]
    DOCUMENT_REPLACEMENTS.clear(); DOCUMENT_REPLACEMENTS.update({k: [(a, b) for a, b in v] for k, v in replacements.items()})


DOCS = [
    ('research', 'Research connected with the Seth recordings', 'The dissertation, original studies and six later research connections, distinguishing direct reuse from discussion.', 'research', 'workspace', 'work/web-app/RESEARCH-LINKS.md'),
    ('methods-and-audit', 'Sources and methods', 'The transcript sources, recording associations, AI provenance and limits of this collection.', 'guide', 'workspace', 'outputs/Seth-recordings-methods-and-audit.md'),
    ('transcript-coverage-explanation', 'Why some recordings lack archive transcripts', 'The available evidence about the difference between surviving audio and archived transcripts.', 'guide', 'workspace', 'outputs/Why-some-recordings-lack-archive-transcripts.md'),
    ('research-sources', 'Research sources', 'The dissertation and associated papers, with their original source links.', 'research', 'library', 'research/SOURCES.md'),
    ('research-source-quality', 'Research source quality', 'The Peters 1987 scan lacks its final two printed pages; other source-quality notes are retained here.', 'research', 'library', 'research/SOURCE-QUALITY.md'),
    ('annotation-provenance', 'Annotation provenance', 'Research speech, unknown-author archive additions and local AI editorial comments are separate layers.', 'guide', 'library', 'metadata/source-annotation-provenance-guide.md'),
    ('transcript-associations', 'Transcript associations and coverage', 'How transcript sources are associated with recordings and where the associations remain uncertain.', 'guide', 'library', 'metadata/transcript-coverage.md'),
]

WEB_READING_CONTEXT = '''# Sources and methods

## What the collection contains

This web collection contains **391 transcript sources and their recording guides**, associated with **477 original audio files: 262 MP3s and 215 WAV files**. The file counts include alternate audio formats and sources without a confirmed match; they are not counts of distinct recording sessions. The collection also offers 1,082 transcript source and companion files, including CHAT files, readable text, local speech-recognition JSON and WebVTT captions.

Associated audio is available for playback and download in its original file format. MP3 is the preferred playback format where the entry has one; distinct source associations remain separate even when filenames resemble one another. One archived source has no confirmed audio association. Each session records its own association evidence, dates, ages and limitations. Calendar dates are shown only where established by source metadata and are never inferred.

## Ages and dates

- **Source ages:** 78 archived research transcripts record the child's age directly in their CHAT metadata (years;months.days, e.g., `1;06.26`).
- **Inferred ages:** In all 78 archived research transcripts that record the child's age, the six-digit filename stem matches that recorded source age exactly (for example, `010626` corresponds to `1;06.26`, and letter suffixes distinguish sessions from the same age). On that basis, the remaining 313 sessions without a source age (13 TalkBank AI drafts and 300 local AI drafts) display an **inferred age** parsed from their six-digit filename stem, always visibly labelled *(inferred from filename)* and stored separately from source ages.
- **Dates are never inferred:** Calendar dates appear only where recorded in source metadata. Filename stems are never converted into calendar dates.

Transcript timestamps are navigation aids, not independently verified alignments. Automatic speech recognition can mishear words or produce inaccurate timing, and some archived passages lack timestamps. Listening to a linked passage can help check the text; the presence of a playback link does not establish that a transcript covers the full file or that alternate formats are identical recordings.

## Distinct source layers

- **Archived research speech:** 78 CHAT sources that are not marked as automatic speech recognition. Their linguistic annotations may be automated.
- **TalkBank AI drafts:** 13 archive-supplied speech-recognition drafts requiring checking.
- **Local AI drafts:** 300 Whisper-generated transcript sources. Words, speakers and timing remain unverified even where the generated text has been read.
- **Editorial provenance comments:** reading copies visibly delimit local AI-written explanations. Current-only archive markers with unknown authorship are kept distinct from these comments and from historical observations.

The 391 recording guides are AI-written summaries of identified transcript sources. Their overviews, topics and selected passages are an additional editorial layer, separate from the transcripts. A guide's source locators identify the underlying CHAT lines or speech-recognition segments. Reviewing generated text does not verify its words against the audio.

## Preparation and checking

Archived CHAT files and canonical transcript companions are preserved as downloaded or previously prepared in the local archive. The website's readable transcript projection retains source utterances, speaker labels, timestamps, notes and the labelled editorial provenance comments. It does not display the full automated morphology and grammar tiers; the raw CHAT download retains them. Local speech-recognition text is projected from the saved JSON segments without inferred speaker names or nonfinite confidence values.

The import checks all 1,082 canonical transcript-file hashes and all 477 original audio-file hashes against their saved inventories, checks transcript utterance or segment counts, and preserves the 391 recording guides and their source associations. Audio files are provided without transcoding or editing. These checks establish file identity and conversion coverage; they do not establish the accuracy of automatic transcription or timing. Reader-document downloads are separate web copies with links adapted for this collection.

See [annotation provenance](/?document=annotation-provenance), [transcript associations and coverage](/?document=transcript-associations), and [the available evidence about transcript coverage](/?document=transcript-coverage-explanation) for details.

## Corpus acknowledgment

This collection draws on the **Peters/Wilson corpus in CHILDES, part of TalkBank**. [Corpus record and acknowledgments](https://talkbank.org/childes/access/Eng-NA/Peters.html) · [Corpus DOI: 10.21415/T5NS4D](https://doi.org/10.21415/T5NS4D).

Peters, Ann M. (1987). *The role of imitation in the developing syntax of a blind child*. Text, 7(3), 289–311. [Publisher record](https://doi.org/10.1515/text.1.1987.7.3.289).

Wilson, Bob, and Ann M. Peters (1988). *What are you cookin’ on a hot?: Movement constraints in the speech of a three-year-old blind child*. Language, 64(2), 249–273. [Publisher record](https://doi.org/10.2307/415434).

The [research reading list](/?document=research) links to Wilson's dissertation and later academic work. Publications remain at their university or publisher sources.
'''


def load(path: Path):
    # Python deliberately accepts the five raw checkpoints' nonfinite confidence
    # metrics. We project only text and finite timing; never serialize those metrics.
    return json.loads(path.read_text(encoding='utf-8'))


def finite(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def clock_seconds(value: str) -> float:
    hours, minutes, seconds = value.split(':')
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def entry_id(unit_id: str) -> str:
    value = re.sub(r'[^a-z0-9]+', '-', unit_id.lower()).strip('-')
    if not value:
        raise ValueError('Empty entry ID')
    return value


def session_slug(source_name: str) -> str:
    """Derive a lower-case URL slug from a session's canonical filename stem.

    Applies the single approved collision resolution for ``011119d``
    (``transcripts-ai/0wav/`` -> ``011119d``,
    ``transcripts-ai/0extra/82-supp/`` -> ``011119d-82-supp``).
    """
    normalized = source_name.replace('\\', '/')
    while normalized.startswith('./'):
        normalized = normalized[2:]
    normalized = normalized.lstrip('/')
    if not normalized:
        raise SystemExit(f'Cannot derive session slug from empty sourceName: {source_name!r}')
    path = Path(normalized)
    stem = path.stem.lower()
    parent = path.parent.as_posix()
    slug = APPROVED_SLUG_OVERRIDES.get((parent, stem), stem)
    if not SLUG_RE.match(slug):
        raise SystemExit(f'Invalid session slug {slug!r} derived from {source_name!r}')
    return slug


def resolve_session_slugs(units: list[dict]) -> dict[str, str]:
    """Map each unit_id to its unique session slug; fail hard on any collision."""
    slugs_by_unit: dict[str, str] = {}
    seen_slugs: dict[str, str] = {}
    for unit in units:
        unit_id = unit['unit_id']
        source_name = unit['canonical_source']
        slug = session_slug(source_name)
        if slug in seen_slugs:
            raise SystemExit(
                f'Session slug collision for {slug!r}: '
                f'{seen_slugs[slug]} conflicts with {source_name} ({unit_id})'
            )
        seen_slugs[slug] = f'{source_name} ({unit_id})'
        slugs_by_unit[unit_id] = slug
    return slugs_by_unit


def safe_basename(value: str) -> str:
    return re.sub(r'[^A-Za-z0-9._-]+', '-', value).strip('.-') or 'source'


def opaque_id(logical: str) -> str:
    return hashlib.sha256(('sethlang-asset-v1\0' + logical).encode()).hexdigest()[:32]


def hash_file(path: Path) -> tuple[str, int]:
    before = path.stat()
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(4 * 1024 * 1024):
            digest.update(block)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError(f'File changed during hashing: {path.name}')
    return digest.hexdigest(), after.st_size


def atomic_json(path: Path, data) -> None:
    # allow_nan=False is also the final check that raw ASR numeric artifacts were
    # excluded from the app-friendly projection.
    encoded = json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(',', ':')) + '\n'
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(encoded, encoding='utf-8')
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def infer_age_from_stem(stem: str) -> str | None:
    """Parse a 6-digit filename stem (YYMMDD + optional ASCII letter) into CHAT age form.

    Returns canonical CHAT notation such as ``2;03.19`` when months <= 11 and
    days <= 31 (allowing explicit ``00`` days, which appear in archived CHAT ages).
    Dates are never inferred.
    """
    match = AGE_STEM_RE.match(stem)
    if not match:
        return None
    years = int(match.group(1))
    months = int(match.group(2))
    days = int(match.group(3))
    if months > 11 or days > 31:
        return None
    return f'{years};{months:02d}.{days:02d}'


def normalize_chat_age(age: str) -> str:
    cleaned = age.strip()
    match = CHAT_AGE_YMD_RE.match(cleaned)
    if not match:
        return cleaned
    return f'{int(match.group(1))};{int(match.group(2)):02d}.{int(match.group(3)):02d}'


def resolve_session_ages(source_name: str, source_ages: list[str], unit_id: str = '') -> tuple[list[str], str | None, bool]:
    """Keep source ages and filename-inferred ages strictly separate.

    Fails hard with SystemExit if any session with a source age has a filename
    stem whose derived age differs from its recorded source age.
    """
    cleaned_source_ages = [age.strip() for age in source_ages if isinstance(age, str) and age.strip()]
    derived = infer_age_from_stem(Path(source_name).stem)
    if cleaned_source_ages:
        if derived is not None:
            for age in cleaned_source_ages:
                if normalize_chat_age(age) != derived:
                    raise SystemExit(
                        f'Source age mismatch for {unit_id or source_name}: '
                        f'source age {age!r} differs from filename-derived age {derived!r}'
                    )
        return cleaned_source_ages, None, derived is not None
    return [], derived, False


def build_age_limits(origin: str, source_dates: list[str], inferred_age: str | None) -> list[str]:
    if inferred_age is not None:
        if origin == 'local_ai_draft' and not source_dates:
            return [INFERRED_LOCAL_AGE_LIMIT]
        return [INFERRED_GENERAL_AGE_LIMIT]
    if origin == 'local_ai_draft' and not source_dates:
        return [UNESTABLISHED_LOCAL_AGE_LIMIT]
    return []


def preserved_entry_content(entry: dict) -> dict:
    """Ignore only hosting availability and importer-derived age/slug metadata when checking source/guide preservation."""
    derived_notes = {
        'Audio is not hosted in this version. Recording names and transcript timestamps are retained as references to the original collection.',
        'Original audio is available for playback. Transcript timestamps are navigation aids; audio associations, speech recognition and alignment have not been independently verified by listening.',
        'No audio file has a confirmed association with this source.',
        LEGACY_LOCAL_AGE_LIMIT,
        INFERRED_LOCAL_AGE_LIMIT,
        INFERRED_GENERAL_AGE_LIMIT,
        UNESTABLISHED_LOCAL_AGE_LIMIT,
    }
    return {
        **{key: value for key, value in entry.items() if key not in {'inferredAge', 'slug', 'legacyId'}},
        'audio': [{key: value for key, value in audio.items() if key != 'available'} for audio in entry['audio']],
        'limits': [limit for limit in entry['limits'] if limit not in derived_notes],
    }


def archive_segments(path: Path) -> list[dict]:
    """Use the existing mechanical reading copy; retain its provenance and notes.

    Each source utterance is one segment. Indented annotation lines remain with
    their utterance; standalone source metadata and editorial comments remain
    explicit text blocks. We never infer speaker names or rewrite source speech.
    """
    text = path.read_text(encoding='utf-8')
    output = []
    for paragraph in re.split(r'\n\s*\n', text):
        paragraph = paragraph.strip()
        if not paragraph or paragraph == 'TRANSCRIPT':
            continue
        match = SPEAKER_RE.match(paragraph)
        item = {'text': paragraph}
        if match:
            item['speaker'] = match.group(1)
            item['text'] = match.group(2)
            time = TIME_RE.search(item['text'])
            if time:
                item['start'] = clock_seconds(time.group(1))
                item['end'] = clock_seconds(time.group(2))
                item['text'] = TIME_RE.sub('', item['text']).strip()
        output.append(item)
    return output


def local_segments(path: Path) -> list[dict]:
    data = load(path)
    result = []
    for segment in data['result']['segments']:
        text = segment.get('text', '').strip()
        if text:
            result.append({'text': text, 'start': finite(segment.get('start')), 'end': finite(segment.get('end'))})
    return result


def locator_text(locators: list[dict]) -> str:
    parts = []
    for locator in locators:
        if 'line_start' in locator:
            a, b = locator['line_start'], locator['line_end']
            parts.append(f'Source CHAT lines {a}–{b}')
        elif 'segment_start' in locator:
            a, b = locator['segment_start'], locator['segment_end']
            parts.append(f'Source JSON segments {a}–{b} (zero-based)')
        else:
            raise ValueError('Unsupported source locator')
    return '; '.join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library', type=Path, default=Path('/Users/sethwilson/dev/sethlang'))
    parser.add_argument('--workspace', type=Path, default=PROJECT.parent)
    parser.add_argument('--inventory', type=Path)
    parser.add_argument('--output', type=Path, default=PROJECT / 'private-data')
    parser.add_argument('--hash-workers', type=int, default=4)
    parser.add_argument('--privacy-config', type=Path, default=DEFAULT_PRIVACY_CONFIG)
    args = parser.parse_args()
    load_privacy_config(args.privacy_config.resolve())
    library, workspace, output = args.library.resolve(), args.workspace.resolve(), args.output.resolve()
    inventory_path = args.inventory or workspace / 'work/web-app/archive-file-inventory.json'
    inventory = load(inventory_path)
    output.mkdir(parents=True, exist_ok=True)
    os.chmod(output, 0o700)
    exports = output / 'documents'
    exports.mkdir(exist_ok=True)
    generated_at = datetime.now(timezone.utc).isoformat()
    previous_catalog = output / 'archive.json'
    previous_data = load(previous_catalog) if previous_catalog.exists() else None
    previous_entries_digest = None
    if previous_data:
        previous_entries_digest = hashlib.sha256(json.dumps(previous_data['entries'], ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    # Preserve only deletion metadata, never the excluded documents' contents.
    # This manifest is private operational output, not a hosted reader asset.
    removed_assets_path = output / 'removed-personal-document-assets.json'
    prior_removals = load(removed_assets_path) if removed_assets_path.exists() else {'removedAssets': []}
    removed_assets = {asset['id']: asset for asset in prior_removals['removedAssets']}
    excluded_previous_documents = []
    if previous_data:
        for document in previous_data['documents']:
            if document['id'] in EXCLUDED_PERSONAL_DOCUMENTS:
                excluded_previous_documents.append(document)
                for reference in document['assets']:
                    asset = previous_data['assets'][reference['id']]
                    removed_assets[reference['id']] = {'documentId': document['id'], 'id': reference['id'], **asset}
    atomic_json(removed_assets_path, {'generatedAt': generated_at, 'removedDocumentIds': sorted(EXCLUDED_PERSONAL_DOCUMENTS), 'removedAssets': list(removed_assets.values()), 'remoteDeletionPerformed': False})

    # Retain the historical audio integrity observation privately. This build
    # also hashes every original audio file against its saved download baseline.
    previous_report = output / 'import-report.json'
    prior_audio_record = output / 'prior-audio-integrity-record.json'
    if previous_report.exists() and not prior_audio_record.exists():
        previous = load(previous_report)
        if previous.get('allCanonicalAudioAndTranscriptHashesMatch'):
            atomic_json(prior_audio_record, {'observationAt': previous['generatedAt'], 'audioFilesComparedWithSavedBaseline': 477, 'allAudioHashesMatchedSavedBaseline': True, 'audioUploaded': False, 'scope': 'Historical local integrity observation before audio was excluded from the web app; not a claim of rehashing in the current build.'})

    pending: dict[str, dict] = {}
    paths_to_assets: dict[str, str] = {}
    paths_to_entries: dict[str, str] = {}
    paths_to_documents: dict[str, str] = {}
    paths_to_external: dict[str, str] = {}
    expected_hashes: dict[str, str] = {}
    rewritten_link_counts = Counter()
    dropped_local_links = []

    def register(logical: str, path: Path, *, name: str | None = None, expected: str | None = None) -> str:
        # A stable opaque ID names the logical asset, while sha256 records its
        # actual content. Equal basenames in different archive folders stay distinct.
        asset_id = opaque_id(logical)
        resolved = path.resolve(strict=True)
        if not resolved.is_file():
            raise ValueError(f'Not a file: {logical}')
        display = name or path.name
        if asset_id in pending:
            if pending[asset_id]['localPath'] != str(resolved):
                raise ValueError('Asset ID collision')
            return asset_id
        pending[asset_id] = {'id': asset_id, 'localPath': str(resolved), 'pathname': f'archive/v1/files/{asset_id}/{safe_basename(display)}', 'name': display, 'contentType': CONTENT_TYPES.get(path.suffix.lower(), mimetypes.guess_type(path.name)[0] or 'application/octet-stream')}
        paths_to_assets[str(resolved)] = asset_id
        if expected:
            expected_hashes[asset_id] = expected
        return asset_id

    audio_reference_ids = {item['recording_path']: opaque_id('library/' + item['recording_path']) for item in inventory['audio']}
    audio_reference_paths = {str((library / item['recording_path']).resolve()) for item in inventory['audio']}
    for item in inventory['audio']:
        expected = item['sha256_from_download_baseline']
        if not expected:
            raise ValueError(f'Audio lacks an integrity baseline: {item["recording_path"]}')
        aid = register('library/' + item['recording_path'], library / item['recording_path'], expected=expected)
        if aid != audio_reference_ids[item['recording_path']]:
            raise ValueError('Audio asset ID differs from its recording reference')
    for item in inventory['canonical_transcript_assets']:
        register('library/' + item['path'], library / item['path'], expected=item['sha256_from_checked_inventory'])

    slugs_by_unit = resolve_session_slugs(inventory['source_units'])

    # Map all known aliases to their source guide, without copying alias symlinks.
    for unit in inventory['source_units']:
        identifier = entry_id(unit['unit_id'])
        for relative in unit['source_files'] + unit['labelled_sources'] + unit['audio_paths'] + [unit['canonical_source'], unit['summary_html_path'], unit['summary_markdown_path']]:
            path = library / relative
            paths_to_entries[str(path)] = identifier
            paths_to_entries[str(path.resolve())] = identifier

    for identifier, title, description, category, base, relative in DOCS:
        path = (library if base == 'library' else workspace) / relative
        paths_to_documents[str(path.resolve())] = identifier
    # Research publications remain external references. Public access to a copy
    # does not establish permission to mirror that publication in this app.
    research_references = {
        'research/Robert-Benjamin-Wilson-dissertation-1985.pdf': 'https://hdl.handle.net/10125/9926',
        'research/Robert-Benjamin-Wilson-dissertation-1985.txt': 'https://hdl.handle.net/10125/9926',
        'research/Wilson1988.pdf': 'https://doi.org/10.2307/415434',
        'research/peters1987.pdf': 'https://doi.org/10.1515/text.1.1987.7.3.289',
    }
    for relative, url in research_references.items():
        paths_to_external[str((library / relative).resolve())] = url
    for extension in ['pdf', 'txt']:
        alias = workspace / f'outputs/Robert-Benjamin-Wilson-dissertation-1985.{extension}'
        paths_to_external[str(alias.resolve())] = 'https://hdl.handle.net/10125/9926'

    def rewrite_markdown(text: str, source: Path) -> str:
        def rewrite(match):
            label, url = match.group(1), match.group(2).strip('<>')
            split = urlsplit(url)
            if split.scheme in ('http', 'https', 'mailto') or url.startswith('#'):
                return match.group(0)
            if split.scheme and split.scheme != 'file':
                rewritten_link_counts['unsupported_scheme_removed'] += 1
                return label
            target = unquote(split.path)
            target = re.sub(r':\d+(?:-\d+)?$', '', target)
            path = Path(target)
            if not path.is_absolute():
                path = source.parent / path
            resolved = str(path.resolve())
            if resolved in paths_to_external:
                rewritten_link_counts['external_research_reference'] += 1
                return f'[{label}]({paths_to_external[resolved]})'
            if resolved in paths_to_entries:
                rewritten_link_counts['entry'] += 1
                if resolved in audio_reference_paths:
                    rewritten_link_counts['hosted_audio_entry'] += 1
                return f'[{label}](/?entry={paths_to_entries[resolved]})'
            if resolved in paths_to_assets:
                rewritten_link_counts['asset'] += 1
                return f'[{label}](/api/assets/{paths_to_assets[resolved]})'
            if resolved in paths_to_documents:
                rewritten_link_counts['document'] += 1
                return f'[{label}](/?document={paths_to_documents[resolved]})'
            rewritten_link_counts['local_audit_link_removed'] += 1
            dropped_local_links.append({'document': source.name, 'label': label, 'targetBasename': path.name})
            return label
        text = LINK_RE.sub(rewrite, text)
        # Use canonical publication records for the two formerly downloaded
        # article links, including bare URLs in the historical sources note.
        for origin in ['https://talkbank.org', 'https://childes.talkbank.org']:
            text = text.replace(origin + '/childes/access/Eng-NA/0docs/Wilson1988.pdf', 'https://doi.org/10.2307/415434')
            text = text.replace(origin + '/childes/access/Eng-NA/0docs/peters1987.pdf', 'https://doi.org/10.1515/text.1.1987.7.3.289')
        # Narrative code snippets occasionally name local directories. Remove
        # machine-specific roots while retaining meaningful archive-relative names.
        for prefix in [str(library) + '/', str(workspace) + '/']:
            text = text.replace(prefix, '')
        text = text.replace(str(library), 'the local archive').replace(str(workspace), 'the local workspace')
        text = re.sub(r'file://[^\s<>`]+', '[local file]', text)
        text = re.sub(r'/Users/[^\s<>`\])]+', '[local path]', text)
        return text

    def source_file(asset_id: str, label: str) -> dict:
        asset = pending[asset_id]
        return {'id': asset_id, 'name': asset['name'], 'format': Path(asset['name']).suffix.lstrip('.').lower(), 'label': label}

    documents = []
    for identifier, title, description, category, base, relative in DOCS:
        path = (library if base == 'library' else workspace) / relative
        if identifier == 'methods-and-audit':
            # The historical preparation note is not published. Keep it
            # untouched locally and use only factual web methods here.
            markdown = WEB_READING_CONTEXT
        else:
            markdown = rewrite_markdown(path.read_text(encoding='utf-8'), path)
        for old, new in DOCUMENT_REPLACEMENTS.get(identifier, []):
            markdown = markdown.replace(old, new)
        if identifier in {'research-sources', 'research-source-quality'}:
            heading, _, remainder = markdown.partition('\n\n')
            markdown = heading + '\n\nThis note describes the research copies retained in the local archive. This website links to the university and publisher records; it does not host the dissertation, article PDFs or dissertation OCR.\n\n' + remainder
        if identifier == 'research-sources':
            markdown = markdown.replace('Copied from the university-repository PDF previously downloaded for this conversation.', 'The local copy came from the university repository.')
            markdown = markdown.replace('Downloaded directly from https://doi.org/', 'Original download linked by TalkBank; publisher record: https://doi.org/')
        # Sanitized web derivatives are separate assets. Never modify original
        # local documents merely to make their links suitable for the app.
        export = exports / f'{identifier}--WEB-COPY.md'
        export.write_text(markdown, encoding='utf-8')
        asset_id = register('web-document/' + identifier, export)
        document = {'id': identifier, 'title': title, 'description': description, 'category': category, 'markdown': markdown, 'assets': [source_file(asset_id, 'Web reading copy — links adapted for this collection')]}
        documents.append(document)

    removed_generated_copies = []
    for identifier in EXCLUDED_PERSONAL_DOCUMENTS:
        obsolete = exports / f'{identifier}--WEB-COPY.md'
        if obsolete.exists():
            obsolete.unlink()
            removed_generated_copies.append(obsolete.name)

    # Full-byte hashing runs independently of text conversion and has no output
    # until complete. A mismatch fails the import instead of silently accepting it.
    def hash_asset(item):
        identifier, asset = item
        sha256, size = hash_file(Path(asset['localPath']))
        expected = expected_hashes.get(identifier)
        if expected and expected != sha256:
            raise ValueError(f'Canonical checksum mismatch: {asset["name"]}')
        return identifier, sha256, size

    with ThreadPoolExecutor(max_workers=max(1, min(args.hash_workers, 8))) as executor:
        hash_futures = executor.map(hash_asset, list(pending.items()))
        entries = []
        transcript_coverage_checks = []
        source_age_sessions = 0
        source_age_stem_matches = 0
        inferred_age_sessions = 0
        sessions_without_age = 0
        audio_inventory = {x['recording_path']: x for x in inventory['audio']}
        for unit in inventory['source_units']:
            authored = load(library / unit['authored_summary_path'])
            if authored['source_key'] != unit['canonical_source'] or authored['source_sha256'] != unit['source_sha256_current']:
                raise ValueError(f'Source-to-summary mismatch: {unit["unit_id"]}')
            origin = unit['provenance']
            sources = []
            for relative in unit['source_files']:
                aid = paths_to_assets[str((library / relative).resolve())]
                suffix = Path(relative).suffix
                if origin == 'archived_research':
                    label = 'Archived research speech; CHAT includes automated annotations' if suffix == '.cha' else 'Research reading copy; local AI editorial comments are explicitly delimited'
                elif origin == 'talkbank_ai_draft':
                    label = 'TalkBank AI speech draft — unverified' + ('; CHAT includes automated annotations' if suffix == '.cha' else '; reading copy with labelled AI editorial comments')
                else:
                    label = 'Local AI speech draft — unverified ' + suffix.lstrip('.').upper()
                sources.append(source_file(aid, label))
            audio = []
            for relative in unit['audio_paths']:
                metadata = audio_inventory[relative]
                aid = audio_reference_ids[relative]
                audio.append({'id': aid, 'name': relative.removeprefix('audio/'), 'format': metadata['format'], 'duration': finite(metadata['duration_seconds']) or 0, 'bytes': metadata['size_bytes_current'], 'available': True})
            preferred = unit['preferred_audio_path']
            transcript = local_segments(library / unit['canonical_source']) if origin == 'local_ai_draft' else archive_segments(library / next(path for path in unit['source_files'] if path.startswith('transcripts-readable/')))
            if origin == 'local_ai_draft':
                raw_segments = load(library / unit['canonical_source'])['result']['segments']
                expected_segments = sum(bool(segment.get('text', '').strip()) for segment in raw_segments)
                actual_segments = len(transcript)
            else:
                canonical_chat = (library / unit['canonical_source']).read_text(encoding='utf-8')
                expected_segments = sum(line.startswith('*') for line in canonical_chat.splitlines())
                actual_segments = sum('speaker' in segment for segment in transcript)
                reading_path = library / next(path for path in unit['source_files'] if path.startswith('transcripts-readable/'))
                comment_marker = '[[LOCAL AI-GENERATED EDITORIAL PROVENANCE COMMENT'
                if reading_path.read_text(encoding='utf-8').count(comment_marker) != sum(segment['text'].count(comment_marker) for segment in transcript):
                    raise ValueError(f'Editorial provenance comment lost: {unit["unit_id"]}')
            if expected_segments != actual_segments:
                raise ValueError(f'Transcript segment coverage mismatch: {unit["unit_id"]}')
            transcript_coverage_checks.append({'entryId': entry_id(unit['unit_id']), 'sourceSegments': expected_segments, 'exportedSegments': actual_segments})
            limits = list(authored['source_limits'])
            generic_limit = 'AI-written guide based on transcript text. Audio has not been independently listened to for this guide.'
            if generic_limit not in limits:
                limits.insert(0, generic_limit)
            limits.insert(0, 'Original audio is available for playback. Transcript timestamps are navigation aids; audio associations, speech recognition and alignment have not been independently verified by listening.' if audio else 'No audio file has a confirmed association with this source.')
            source_dates = unit['recording_dates_iso_from_source'] or []
            source_ages, inferred_age, stem_matched_source = resolve_session_ages(
                unit['canonical_source'],
                unit['child_ages_chat_from_source'] or [],
                unit['unit_id'],
            )
            if source_ages:
                source_age_sessions += 1
                if stem_matched_source:
                    source_age_stem_matches += 1
            elif inferred_age is not None:
                inferred_age_sessions += 1
            else:
                sessions_without_age += 1
            limits.extend(build_age_limits(origin, source_dates, inferred_age))
            legacy_id = entry_id(unit['unit_id'])
            entry = {
                'id': legacy_id, 'slug': slugs_by_unit[unit['unit_id']], 'legacyId': legacy_id, 'sourceName': unit['canonical_source'],
                'title': authored['title'], 'overview': authored['overview'], 'origin': origin,
                'topics': authored['topics'], 'dates': source_dates, 'ages': source_ages, 'inferredAge': inferred_age,
                'audio': audio, 'preferredAudioId': audio_reference_ids[preferred] if preferred else None,
                'sources': sources,
                'moments': [{'title': m['title'], 'description': m['description'], 'start': finite(m.get('start_seconds')), 'end': finite(m.get('end_seconds')), 'locator': locator_text(m['source_locators'])} for m in authored['moments']],
                'limits': limits, 'transcript': transcript, 'sourceSha256': unit['source_sha256_current'], 'association': unit['association_basis'],
            }
            if not transcript:
                raise ValueError(f'Empty transcript: {unit["unit_id"]}')
            entries.append(entry)
        for identifier, sha256, size in hash_futures:
            pending[identifier]['sha256'] = sha256
            pending[identifier]['bytes'] = size

    assets = {identifier: {key: item[key] for key in ['pathname', 'name', 'contentType', 'bytes', 'sha256']} for identifier, item in pending.items()}
    data = {'version': 1, 'generatedAt': generated_at, 'entries': entries, 'documents': documents, 'assets': assets}
    serialized = json.dumps(data, ensure_ascii=False, allow_nan=False)
    if '/Users/' in serialized or 'file://' in serialized:
        raise ValueError('A local absolute path escaped into reader content')
    if any(key in serialized for key in ['"review_record"', '"prior_review_paths"', '"localPath"', '"backup_directory"']):
        raise ValueError('Operational metadata escaped into reader content')
    ids = {entry['id'] for entry in entries}
    if len(ids) != len(entries) or len(entries) != 391:
        raise ValueError('Source-unit count or ID collision')
    slugs = {entry['slug'] for entry in entries}
    if len(slugs) != len(entries):
        raise SystemExit('Session slug collision in exported entries')
    if any(entry['legacyId'] != entry['id'] for entry in entries):
        raise SystemExit('Session legacyId must match entry id')
    if any(entry['ages'] and entry['inferredAge'] is not None for entry in entries):
        raise SystemExit('Source age and inferredAge must never both be populated on the same session')
    if source_age_sessions != 78 or source_age_stem_matches != source_age_sessions:
        raise SystemExit(
            f'Expected all 78 source-age sessions to match their filename stem '
            f'(got {source_age_stem_matches}/{source_age_sessions})'
        )
    audio_ids = {item['id'] for entry in entries for item in entry['audio']}
    source_ids = {item['id'] for entry in entries for item in entry['sources']}
    if len(audio_ids) != 477 or len(source_ids) != 1082:
        raise ValueError('Incomplete source/audio export')
    if sum(len(entry['moments']) for entry in entries) != 2855:
        raise ValueError('Incomplete summary-landmark export')
    if len([entry for entry in entries if not entry['audio']]) != 1:
        raise ValueError('Missing-audio entry count changed')
    if not all(key in assets for key in source_ids):
        raise ValueError('Unresolved source assets')
    hosted_audio_ids = {identifier for identifier, asset in assets.items() if asset['contentType'].startswith('audio/')}
    if hosted_audio_ids != audio_ids:
        raise ValueError('Audio asset allowlist differs from the recording references')
    if any(asset['contentType'] == 'application/pdf' or Path(asset['localPath']).is_relative_to(library / 'research') for asset in pending.values()):
        raise ValueError('Research PDF/OCR mirrors must not appear among hosted assets')
    if any(audio['available'] is not True for entry in entries for audio in entry['audio']):
        raise ValueError('Hosted audio references must be marked available')
    for entry in entries:
        for audio in entry['audio']:
            if assets[audio['id']]['bytes'] != audio['bytes'] or assets[audio['id']]['contentType'] != CONTENT_TYPES['.' + audio['format']]:
                raise ValueError('Audio reference size or content type differs from the verified original file')
        if any(audio['format'] == 'mp3' for audio in entry['audio']):
            if not any(audio['id'] == entry['preferredAudioId'] and audio['format'] == 'mp3' for audio in entry['audio']):
                raise ValueError('An available associated MP3 must be preferred for playback')
    if not all(entry['preferredAudioId'] is None or entry['preferredAudioId'] in {audio['id'] for audio in entry['audio']} for entry in entries):
        raise ValueError('Preferred audio is not an associated recording')
    entries_by_id = {entry['id']: entry for entry in entries}
    ambiguity_ids = ['archive-011119', 'local-0extra-82-supp-011119d', 'local-0wav-011119d']
    if entries_by_id[ambiguity_ids[0]]['audio'] or entries_by_id[ambiguity_ids[1]]['preferredAudioId'] == entries_by_id[ambiguity_ids[2]]['preferredAudioId']:
        raise ValueError('The orphan or distinct 011119d audio associations changed')
    if entries_by_id['local-0wav-011119d']['slug'] != '011119d' or entries_by_id['local-0extra-82-supp-011119d']['slug'] != '011119d-82-supp':
        raise SystemExit('Approved 011119d slug resolution changed')
    if previous_data:
        if [preserved_entry_content(entry) for entry in previous_data['entries']] != [preserved_entry_content(entry) for entry in entries]:
            raise ValueError('Source, transcript, guide or audio-association content changed beyond hosting availability')
    document_ids = {document['id'] for document in documents}
    if document_ids & EXCLUDED_PERSONAL_DOCUMENTS.keys() or removed_assets.keys() & assets.keys():
        raise ValueError('A removed personal document is still in the reader payload')
    for basename in EXCLUDED_PERSONAL_DOCUMENTS.values():
        if basename in serialized:
            raise ValueError('A reference to a removed personal document remains')
    reader_document_text = '\n\n'.join(document['markdown'] for document in documents)
    if re.search(r'audio (?:is |isn.t )?not hosted|audio is unavailable|audio isn.t hosted', reader_document_text, re.I):
        raise ValueError('Obsolete audio-hosting description remains in reader documents')
    if any(p.search(reader_document_text) for p in FORBIDDEN_DOCUMENT_PATTERNS):
        raise ValueError('A forbidden private pattern remains in the document layer')
    removed_paragraphs_checked = 0
    for removed_document in excluded_previous_documents:
        for paragraph in re.split(r'\n\s*\n', removed_document['markdown']):
            if len(paragraph.strip()) >= 120:
                removed_paragraphs_checked += 1
                if paragraph.strip() in reader_document_text:
                    raise ValueError(f'A paragraph from removed personal document {removed_document["id"]} remains in the document layer')
    for document in documents:
        for match in LINK_RE.finditer(document['markdown']):
            href = match.group(2).strip('<>')
            if href.startswith('/?entry='):
                valid = href.split('=', 1)[1] in ids
            elif href.startswith('/?document='):
                valid = href.split('=', 1)[1] in document_ids
            elif href.startswith('/api/assets/'):
                valid = href.rsplit('/', 1)[1] in assets
            else:
                valid = href.startswith('#') or (urlsplit(href).scheme in {'http', 'https'} and urlsplit(href).hostname in OFFICIAL_LINK_HOSTS)
            if not valid:
                raise ValueError(f'Unresolved reader-document link in {document["id"]}')
    # Every text asset that will be downloadable must also avoid machine paths.
    for asset in pending.values():
        if asset['contentType'].startswith('text/') or asset['contentType'] == 'application/json':
            text = Path(asset['localPath']).read_text(encoding='utf-8')
            if '/Users/' in text or 'file://' in text:
                raise ValueError(f'Local path in downloadable text asset: {asset["name"]}')

    catalog_path = output / 'archive.json'
    entries_digest = hashlib.sha256(json.dumps(entries, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    preserved_entries_digest = hashlib.sha256(json.dumps([preserved_entry_content(entry) for entry in entries], ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    if sum(len(entry['transcript']) for entry in entries) != 199950:
        raise ValueError('Transcript-segment count changed')
    atomic_json(catalog_path, data)
    catalog_sha, catalog_bytes = hash_file(catalog_path)
    upload_plan = {'version': 1, 'generatedAt': generated_at, 'catalog': {'localPath': str(catalog_path), 'pathname': 'archive/v1/archive.json', 'contentType': 'application/json', 'bytes': catalog_bytes, 'sha256': catalog_sha}, 'assets': list(pending.values())}
    atomic_json(output / 'upload-plan.json', upload_plan)
    changed_documents = {item['id']: item for item in prior_removals.get('retainedDocumentAssetsToReplace', [])}
    if previous_data:
        previous_assets = previous_data['assets']
        for document in documents:
            for reference in document['assets']:
                identifier = reference['id']
                if identifier in previous_assets and previous_assets[identifier]['sha256'] != assets[identifier]['sha256']:
                    changed_documents[identifier] = {'documentId': document['id'], 'id': identifier, **assets[identifier]}
    atomic_json(removed_assets_path, {'generatedAt': generated_at, 'removedDocumentIds': sorted(EXCLUDED_PERSONAL_DOCUMENTS), 'removedAssets': list(removed_assets.values()), 'retainedDocumentAssetsToReplace': list(changed_documents.values()), 'catalogToReplace': {'pathname': upload_plan['catalog']['pathname'], 'sha256': catalog_sha, 'bytes': catalog_bytes}, 'remoteDeletionPerformed': False})
    report = {
        'generatedAt': generated_at, 'sourceUnits': len(entries), 'audio': len(audio_ids), 'canonicalTranscriptAssets': len(source_ids),
        'documents': len(documents), 'rawResearchAssets': 0, 'externalResearchReferences': len(research_references), 'noResearchPdfOrOcrMirrorsAssertionPassed': True, 'sanitizedDocumentAssets': len(DOCS), 'totalAssetCount': len(assets),
        'originCounts': dict(Counter(entry['origin'] for entry in entries)), 'moments': sum(len(entry['moments']) for entry in entries),
        'transcriptSegments': sum(len(entry['transcript']) for entry in entries), 'catalogBytes': catalog_bytes, 'assetBytes': sum(asset['bytes'] for asset in assets.values()),
        'checksumsComparedWithPriorBaseline': len(expected_hashes), 'canonicalTranscriptChecksumsCompared': len(source_ids), 'allCanonicalTranscriptHashesMatch': True,
        'audioChecksumsComparedWithDownloadBaseline': len(audio_ids), 'allCanonicalAudioHashesMatch': True, 'allCanonicalAudioAndTranscriptHashesMatch': True,
        'audioReferences': len(audio_ids), 'hostedAudioAssets': len(hosted_audio_ids), 'allAudioHostedAssertionPassed': True, 'audioRehashedThisBuild': True,
        'audioBytes': sum(assets[identifier]['bytes'] for identifier in hosted_audio_ids), 'audioFormatCounts': dict(Counter(item['format'] for item in inventory['audio'])),
        'audioReferencesResolveToAssetAllowlist': True, 'originalAudioTranscodedOrModified': False, 'associatedMp3PreferredWhenAvailable': True,
        'ambiguousAudioAssociationsPreserved': [{'entryId': identifier, 'sourceName': entries_by_id[identifier]['sourceName'], 'preferredAudioId': entries_by_id[identifier]['preferredAudioId'], 'audioIds': [item['id'] for item in entries_by_id[identifier]['audio']]} for identifier in ambiguity_ids],
        'priorAudioIntegrityRecord': prior_audio_record.name if prior_audio_record.exists() else None,
        'allAssetsFreshlyHashed': True, 'missingAssets': [], 'localAbsolutePathsInReaderContent': 0, 'operationalMetadataInReaderContent': False,
        'allTranscriptUtteranceCountsPreserved': True, 'transcriptCoverageChecks': transcript_coverage_checks,
        'readerDocumentLinksVerified': True, 'downloadableTextHasNoLocalAbsolutePaths': True,
        'externalDocumentLinksRestrictedToOfficialHosts': True, 'visibleCorpusAcknowledgmentIncluded': True,
        'entryContentSha256': entries_digest, 'entryContentUnchangedFromPreviousBuild': previous_entries_digest == entries_digest if previous_entries_digest else None,
        'sourceGuideAndAssociationContentSha256': preserved_entries_digest, 'sourceGuideAndAssociationContentUnchangedExceptHostingAvailability': True if previous_data else None,
        'transcriptsUnchangedFromPreviousBuild': True if previous_data else None,
        'excludedPersonalDocumentIds': sorted(EXCLUDED_PERSONAL_DOCUMENTS), 'excludedPersonalDocumentAssetsPresent': 0,
        'excludedDocumentReferencesAbsent': True, 'readerDocumentsPassForbiddenPatternCheck': True,
        'removedPersonalDocumentParagraphsChecked': removed_paragraphs_checked, 'removedPersonalDocumentParagraphsInRetainedDocuments': 0,
        'removedGeneratedPersonalDocumentCopies': removed_generated_copies, 'personalDocumentRemovalManifest': removed_assets_path.name,
        'retainedDocumentAssetPathnamesToReplace': [asset['pathname'] for asset in changed_documents.values()],
        'linkRewrites': dict(rewritten_link_counts), 'unshippedLocalAuditLinksRenderedAsText': dropped_local_links,
        'onlySourceKnownDates': True, 'datesNeverInferred': True, 'sourceAgeAndInferredAgeStoredSeparately': True,
        'uniqueSessionSlugs': len(slugs), 'allSessionSlugsUnique': len(slugs) == len(entries),
        'sourceAgeSessions': source_age_sessions, 'sourceAgesMatchedFilenameStem': source_age_stem_matches,
        'allSourceAgesMatchFilenameStem': source_age_stem_matches == source_age_sessions,
        'inferredAgeSessions': inferred_age_sessions, 'sessionsWithoutAnyAge': sessions_without_age,
        'sessionsWithAgeTotal': source_age_sessions + inferred_age_sessions,
        'originalSourcesModified': False, 'uploadsPerformed': False,
        'limitations': ['Original audio is hosted without transcoding; transcript timestamps remain navigation aids rather than independently verified alignments.', 'Audio content, speech recognition and timing were not independently reviewed by listening.', 'Unknown-author archive notes and local AI editorial comments remain visibly distinguished in the existing readable transcript text.', 'Sessions without a CHAT source age carry a separately stored inferred age parsed from their six-digit filename stem (validated against all 78 archived research transcripts with source ages); calendar dates are never inferred.', 'All original audio hashes were freshly verified against the saved download baseline in this build.'],
    }
    atomic_json(output / 'import-report.json', report)
    print(json.dumps({key: report[key] for key in ['sourceUnits', 'uniqueSessionSlugs', 'allSessionSlugsUnique', 'audioReferences', 'hostedAudioAssets', 'audioBytes', 'canonicalTranscriptAssets', 'documents', 'totalAssetCount', 'moments', 'transcriptSegments', 'catalogBytes', 'sourceAgeSessions', 'sourceAgesMatchedFilenameStem', 'allSourceAgesMatchFilenameStem', 'inferredAgeSessions', 'sessionsWithoutAnyAge', 'sessionsWithAgeTotal', 'checksumsComparedWithPriorBaseline', 'allCanonicalAudioAndTranscriptHashesMatch', 'sourceGuideAndAssociationContentUnchangedExceptHostingAvailability', 'missingAssets']}, indent=2))


if __name__ == '__main__':
    main()
