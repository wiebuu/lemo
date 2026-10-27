"""Search catalog and 10-second previews."""

import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

from lemo_analyzer import catalog
from lemo_analyzer.config import CONFIG


def note(t0, t1, loud=-20.0):
    return {"startTime": t0, "endTime": t1, "midiPitch": 60, "sung": True, "loudness": loud}


class PreviewStartTest(unittest.TestCase):
    def test_picks_the_busiest_loudest_stretch(self):
        verse = [note(t, t + 0.5, -30) for t in range(10, 20, 2)]  # sparse, soft
        chorus = [note(t / 2, t / 2 + 0.45, -12) for t in range(120, 140)]  # dense, loud: 60–70 s
        start = catalog.preview_start({"duration": 200, "notes": verse + chorus})
        self.assertTrue(59 <= start <= 60.5, start)

    def test_never_runs_past_the_end(self):
        start = catalog.preview_start({"duration": 30, "notes": [note(28, 29.5)]})
        self.assertLessEqual(start, 20)

    def test_no_notes_falls_back_to_a_third_in(self):
        self.assertAlmostEqual(catalog.preview_start({"duration": 90, "notes": []}), 27)


class CatalogTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.patch = mock.patch.object(catalog, "CONFIG", replace(CONFIG, data_dir=root))
        self.patch.start()
        self.root = root

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def song(self, sid, title, artist):
        d = self.root / "songs" / sid
        d.mkdir(parents=True)
        (d / "reference.json").write_text(json.dumps({"id": sid, "title": title, "artist": artist, "duration": 100, "createdAt": 5}))
        return d

    def test_add_and_remove(self):
        catalog.add(self.song("yt-aaaaaaaaaaa", "Tum Hi Ho", "Arijit Singh"))
        self.assertEqual([e["title"] for e in catalog.all_songs()], ["Tum Hi Ho"])
        catalog.remove("yt-aaaaaaaaaaa")
        self.assertEqual(catalog.all_songs(), [])

    def test_entries_survive_when_the_song_leaves_this_machine(self):
        d = self.song("yt-bbbbbbbbbbb", "Perfect", "Ed Sheeran")
        catalog.add(d)
        (d / "reference.json").unlink()  # now only on the VPS
        with mock.patch.object(catalog.storage, "songs_root", return_value=self.root / "songs"):
            catalog.rebuild()
        self.assertEqual(len(catalog.all_songs()), 1)

    def test_plays_count_once_per_person_per_ten_minutes(self):
        catalog.add(self.song("yt-ccccccccccc", "Dhana", "Priyanka Meher"))
        with mock.patch.object(catalog, "_last_play", {}):
            self.assertEqual(catalog.played("yt-ccccccccccc", "ana"), 1)
            self.assertIsNone(catalog.played("yt-ccccccccccc", "ana"))  # straight away again: not counted
            self.assertEqual(catalog.played("yt-ccccccccccc", "ben"), 2)
            catalog.add(self.root / "songs" / "yt-ccccccccccc")  # re-listing keeps the count
            self.assertEqual(catalog.all_songs()[0]["plays"], 2)
            self.assertIsNone(catalog.played("yt-unknown000", "ana"))

    def test_uploads_are_not_searchable(self):
        self.assertTrue(catalog.is_public("yt-abcdefghijk"))
        self.assertFalse(catalog.is_public("up-abcdefghijk"))


if __name__ == "__main__":
    unittest.main()
