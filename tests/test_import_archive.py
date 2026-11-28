#!/usr/bin/env python3
"""Unit tests for filename-inferred age logic in scripts/import-archive.py."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


IMPORTER_PATH = Path(__file__).resolve().parent.parent / 'scripts' / 'import-archive.py'
SPEC = importlib.util.spec_from_file_location('import_archive', IMPORTER_PATH)
assert SPEC and SPEC.loader
IMPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)


class InferredAgeImporterTests(unittest.TestCase):
    def test_valid_stems_parse_to_chat_age(self) -> None:
        cases = {
            '010626': '1;06.26',
            '020319b': '2;03.19',
            '020319B': '2;03.19',
            '010600': '1;06.00',
            '000000': '0;00.00',
            '001131a': '0;11.31',
            '041130z': '4;11.30',
        }
        for stem, expected in cases.items():
            with self.subTest(stem=stem):
                self.assertEqual(IMPORTER.infer_age_from_stem(stem), expected)

    def test_invalid_stems_are_rejected(self) -> None:
        invalid_stems = [
            '',
            '01062',
            '0106260',
            '010626ab',
            '010626-a',
            '011201',
            '011201a',
            '010632',
            '010699',
            '010626\n',
            ' 010626',
            'notes',
            '010626é',
            '٠١٠٦٢٦',
        ]
        for stem in invalid_stems:
            with self.subTest(stem=stem):
                self.assertIsNone(IMPORTER.infer_age_from_stem(stem))

    def test_source_age_and_inferred_age_remain_separate(self) -> None:
        ages, inferred, matched = IMPORTER.resolve_session_ages('transcripts/010626.cha', ['1;06.26'], 'archive/010626')
        self.assertEqual(ages, ['1;06.26'])
        self.assertIsNone(inferred)
        self.assertTrue(matched)

        ages2, inferred2, matched2 = IMPORTER.resolve_session_ages('transcripts-ai/0extra/83/020319b.json', [], 'local/020319b')
        self.assertEqual(ages2, [])
        self.assertEqual(inferred2, '2;03.19')
        self.assertFalse(matched2)

        ages3, inferred3, matched3 = IMPORTER.resolve_session_ages('transcripts-ai/notes.json', [], 'local/notes')
        self.assertEqual(ages3, [])
        self.assertIsNone(inferred3)
        self.assertFalse(matched3)

    def test_mismatched_source_age_fails_hard(self) -> None:
        with self.assertRaises(SystemExit) as ctx:
            IMPORTER.resolve_session_ages('transcripts/010627.cha', ['1;06.26'], 'archive/010627')
        self.assertIn('Source age mismatch', str(ctx.exception))

        with self.assertRaises(SystemExit) as ctx2:
            IMPORTER.resolve_session_ages('transcripts/010626a.cha', ['1;06'], 'archive/010626a')
        self.assertIn('Source age mismatch', str(ctx2.exception))

    def test_age_limits_describe_inferred_ages_and_never_infer_dates(self) -> None:
        local_limits = IMPORTER.build_age_limits('local_ai_draft', [], '2;03.19')
        self.assertEqual(len(local_limits), 1)
        self.assertIn('inferred from the filename stem', local_limits[0])
        self.assertIn('78 archived research transcripts', local_limits[0])
        self.assertIn('calendar dates are never inferred', local_limits[0].lower())

        tb_limits = IMPORTER.build_age_limits('talkbank_ai_draft', [], '2;01.03')
        self.assertEqual(len(tb_limits), 1)
        self.assertIn('inferred from the filename stem', tb_limits[0])
        self.assertIn('calendar dates are never inferred', tb_limits[0].lower())

        source_limits = IMPORTER.build_age_limits('archived_research', ['1983-01-15'], None)
        self.assertEqual(source_limits, [])

    def test_web_reading_context_keeps_listening_copy_anchors_and_explains_inferred_ages(self) -> None:
        ctx = IMPORTER.WEB_READING_CONTEXT
        self.assertIn('78 archived research transcripts', ctx)
        self.assertIn('(inferred from filename)', ctx)
        self.assertIn('Dates are never inferred', ctx)
        self.assertNotIn('/?document=', ctx)
        self.assertIn('](/research/annotation-provenance)', ctx)
        self.assertIn('](/research/transcript-associations)', ctx)
        self.assertIn('](/research/transcript-coverage-explanation)', ctx)
        self.assertIn('](/research/research)', ctx)
        # Preserve exact anchor phrases expected by scripts/add-listening-copies.mjs.
        self.assertIn('Associated audio is available for playback and download in its original file format. MP3 is the preferred playback format where the entry has one;', ctx)
        self.assertIn('Audio files are provided without transcoding or editing.', ctx)


class ResearchDocumentLinkImporterTests(unittest.TestCase):
    def test_rewrite_document_markdown_emits_research_routes_for_internal_documents(self) -> None:
        library = Path('/tmp/fake-library')
        workspace = Path('/tmp/fake-workspace')
        source = library / 'research' / 'SOURCES.md'
        quality = (library / 'research' / 'SOURCE-QUALITY.md').resolve()
        methods = (workspace / 'outputs' / 'methods.md').resolve()

        markdown = (
            'See [quality notes](SOURCE-QUALITY.md), '
            '[quality details](SOURCE-QUALITY.md#notes), '
            'and [methods](../../fake-workspace/outputs/methods.md).'
        )
        counts = IMPORTER.Counter()
        rewritten = IMPORTER.rewrite_document_markdown(
            markdown,
            source,
            library=library,
            workspace=workspace,
            paths_to_external={},
            paths_to_entries={},
            paths_to_assets={},
            paths_to_documents={
                str(quality): 'research-source-quality',
                str(methods): 'methods-and-audit',
            },
            rewritten_link_counts=counts,
        )
        self.assertIn('[quality notes](/research/research-source-quality)', rewritten)
        self.assertIn('[quality details](/research/research-source-quality#notes)', rewritten)
        self.assertIn('[methods](/research/methods-and-audit)', rewritten)
        self.assertNotIn('/?document=', rewritten)
        self.assertEqual(counts['document'], 3)

    def test_validate_reader_document_href_accepts_research_routes_and_rejects_legacy_document_links(self) -> None:
        entry_ids = {'archive-010626'}
        document_ids = {'research', 'annotation-provenance', 'research-source-quality'}
        asset_ids = {'a' * 32}

        for valid_href in [
            '/research',
            '/research/research',
            '/research/annotation-provenance',
            '/research/research-source-quality#section-1',
            '/about',
            '/about#inferred-ages',
            '/?entry=archive-010626',
            f'/api/assets/{"a" * 32}',
            '#local-anchor',
            'https://doi.org/10.21415/T5NS4D',
        ]:
            with self.subTest(valid_href=valid_href):
                self.assertTrue(
                    IMPORTER.validate_reader_document_href(
                        valid_href,
                        entry_ids=entry_ids,
                        document_ids=document_ids,
                        asset_ids=asset_ids,
                    )
                )

        for invalid_href in [
            '/?document=research',
            '/?document=annotation-provenance',
            '/research/',
            '/research/unknown-doc',
            '/research/research/extra',
            '/research/research?foo=bar',
            '/?entry=unknown-entry',
            'https://untrusted.example.invalid/doc',
        ]:
            with self.subTest(invalid_href=invalid_href):
                self.assertFalse(
                    IMPORTER.validate_reader_document_href(
                        invalid_href,
                        entry_ids=entry_ids,
                        document_ids=document_ids,
                        asset_ids=asset_ids,
                    )
                )


class SessionSlugImporterTests(unittest.TestCase):
    def test_slug_uses_lowercase_filename_stem(self) -> None:
        self.assertEqual(IMPORTER.session_slug('transcripts/010626.cha'), '010626')
        self.assertEqual(IMPORTER.session_slug('transcripts-ai/0extra/83/020319B.json'), '020319b')
        self.assertEqual(IMPORTER.session_slug('010815.cha'), '010815')

    def test_approved_011119d_collision_resolution(self) -> None:
        units = [
            {'unit_id': 'local/0wav/011119d', 'canonical_source': 'transcripts-ai/0wav/011119d.json'},
            {'unit_id': 'local/0extra/82-supp/011119d', 'canonical_source': 'transcripts-ai/0extra/82-supp/011119d.json'},
            {'unit_id': 'archive/010626', 'canonical_source': 'transcripts/010626.cha'},
        ]
        resolved = IMPORTER.resolve_session_slugs(units)
        self.assertEqual(resolved['local/0wav/011119d'], '011119d')
        self.assertEqual(resolved['local/0extra/82-supp/011119d'], '011119d-82-supp')
        self.assertEqual(resolved['archive/010626'], '010626')

    def test_any_other_slug_collision_fails_hard(self) -> None:
        with self.assertRaises(SystemExit) as ctx:
            IMPORTER.resolve_session_slugs([
                {'unit_id': 'archive/010626', 'canonical_source': 'transcripts/010626.cha'},
                {'unit_id': 'local/0wav/010626', 'canonical_source': 'transcripts-ai/0wav/010626.json'},
            ])
        self.assertIn('Session slug collision', str(ctx.exception))

        # Case-insensitive stem collision fails hard.
        with self.assertRaises(SystemExit) as ctx_case:
            IMPORTER.resolve_session_slugs([
                {'unit_id': 'local/a', 'canonical_source': 'transcripts-ai/0wav/020319a.json'},
                {'unit_id': 'local/b', 'canonical_source': 'transcripts-ai/0extra/83/020319A.json'},
            ])
        self.assertIn('Session slug collision', str(ctx_case.exception))

        # A third 011119d outside the two approved folders also fails hard.
        with self.assertRaises(SystemExit) as ctx_third:
            IMPORTER.resolve_session_slugs([
                {'unit_id': 'local/0wav/011119d', 'canonical_source': 'transcripts-ai/0wav/011119d.json'},
                {'unit_id': 'local/0extra/82-supp/011119d', 'canonical_source': 'transcripts-ai/0extra/82-supp/011119d.json'},
                {'unit_id': 'local/0extra/83/011119d', 'canonical_source': 'transcripts-ai/0extra/83/011119d.json'},
            ])
        self.assertIn('Session slug collision', str(ctx_third.exception))

    def test_invalid_slug_stem_fails_hard(self) -> None:
        for bad in ['', 'transcripts/bad stem.cha', 'transcripts/foo_bar.cha', 'transcripts/---.cha']:
            with self.subTest(source=bad):
                with self.assertRaises(SystemExit):
                    IMPORTER.session_slug(bad)

    def test_preserved_entry_content_ignores_slug_and_legacy_id(self) -> None:
        old_entry = {
            'id': 'archive-010626',
            'sourceName': 'transcripts/010626.cha',
            'audio': [{'id': 'a1', 'available': True}],
            'limits': [],
        }
        new_entry = {
            **old_entry,
            'slug': '010626',
            'legacyId': 'archive-010626',
            'inferredAge': None,
        }
        self.assertEqual(IMPORTER.preserved_entry_content(old_entry), IMPORTER.preserved_entry_content(new_entry))


if __name__ == '__main__':
    unittest.main()
