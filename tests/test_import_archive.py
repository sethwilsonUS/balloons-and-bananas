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
        # Preserve exact anchor phrases expected by scripts/add-listening-copies.mjs.
        self.assertIn('Associated audio is available for playback and download in its original file format. MP3 is the preferred playback format where the entry has one;', ctx)
        self.assertIn('Audio files are provided without transcoding or editing.', ctx)


if __name__ == '__main__':
    unittest.main()
