"""Weekly play counts: one snapshot a week, only the newest kept, served from memory."""

import json
import tempfile
import time
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

from lemo_analyzer import popularity
from lemo_analyzer.config import CONFIG

WEEK = 7 * 86400


class PopularityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patch = mock.patch.object(popularity, "CONFIG", replace(CONFIG, data_dir=Path(self.tmp.name), remote_store=""))
        self.patch.start()
        popularity._cache.update(key=None, checked=0.0, snap=None)

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def test_a_new_week_replaces_the_old_snapshot(self):
        t = time.time() - 3 * WEEK
        popularity.save({"yt-aaaaaaaaaaa": {"youtube": 10}}, now=t)
        popularity.save({"yt-aaaaaaaaaaa": {"youtube": 20}}, now=t + WEEK)
        last = popularity.save({"yt-aaaaaaaaaaa": {"youtube": 30}}, now=t + 2 * WEEK)
        self.assertEqual(popularity.snapshots(), [last])
        self.assertEqual(last.name, f"{popularity.week_of(t + 2 * WEEK)}.json")
        self.assertEqual(popularity.views("yt-aaaaaaaaaaa"), 30)

    def test_the_same_week_is_overwritten_not_added(self):
        t = time.time()
        popularity.save({"yt-aaaaaaaaaaa": {"youtube": 1}}, now=t)
        popularity.save({"yt-aaaaaaaaaaa": {"youtube": 2}}, now=t + 1)
        self.assertEqual(len(popularity.snapshots()), 1)
        self.assertEqual(popularity.views("yt-aaaaaaaaaaa"), 2)

    def test_due_once_a_week(self):
        self.assertTrue(popularity.due())  # nothing yet
        popularity.save({}, now=time.time() - WEEK + 3600)
        self.assertFalse(popularity.due())
        popularity.save({}, now=time.time() - WEEK - 1)
        self.assertTrue(popularity.due())

    def test_served_from_memory_until_the_file_changes(self):
        popularity.save({"yt-aaaaaaaaaaa": {"youtube": 5}})
        self.assertEqual(popularity.views("yt-aaaaaaaaaaa"), 5)
        with mock.patch.object(Path, "read_text", side_effect=AssertionError("read again")):
            for _ in range(50):
                self.assertEqual(popularity.views("yt-aaaaaaaaaaa"), 5)
        self.assertIsNone(popularity.views("yt-nothere0000"))

    def test_refresh_keeps_last_weeks_number_when_a_page_fails(self):
        popularity.save({"yt-aaaaaaaaaaa": {"youtube": 7}, "yt-bbbbbbbbbbb": {"youtube": 8}}, now=time.time() - WEEK)
        got = {"aaaaaaaaaaa": None, "bbbbbbbbbbb": 9, "ccccccccccc": 1}
        with mock.patch.object(popularity, "youtube_views", side_effect=got.get):
            path = popularity.refresh(push=False, ids=["yt-aaaaaaaaaaa", "yt-bbbbbbbbbbb", "yt-ccccccccccc"], log=lambda *_: None)
        songs = json.loads(path.read_text())["songs"]
        self.assertEqual(songs, {"yt-aaaaaaaaaaa": {"youtube": 7}, "yt-bbbbbbbbbbb": {"youtube": 9}, "yt-ccccccccccc": {"youtube": 1}})
        self.assertEqual(popularity.snapshots(), [path])


if __name__ == "__main__":
    unittest.main()
