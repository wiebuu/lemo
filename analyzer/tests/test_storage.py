"""Disk budget: featured songs stay, other songs and renders are trimmed oldest first."""

import json
import os
import tempfile
import time
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

from lemo_analyzer import storage
from lemo_analyzer.config import CONFIG


def make_song(root: Path, sid: str, mb: float, used_ago: float) -> Path:
    d = root / "songs" / sid
    d.mkdir(parents=True)
    (d / "reference.json").write_text(json.dumps({"id": sid}))
    (d / "backing.m4a").write_bytes(b"x" * int(mb * 1048576))
    t = time.time() - used_ago
    (d / ".used").touch()
    os.utime(d / ".used", (t, t))
    os.utime(d / "reference.json", (t, t))
    return d


class TrimTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        cfg = replace(CONFIG, data_dir=self.root, user_cache_mb=3, user_keep_days=14, variant_cache_mb=1)
        featured = self.root / "featured.json"
        featured.write_text(json.dumps([{"title": "f", "artist": "a", "videoId": "FEATURED000"}]))
        self.patches = [
            mock.patch.object(storage, "CONFIG", cfg),
            mock.patch.object(storage, "FEATURED_FILE", featured),
            mock.patch("lemo_analyzer.remote.enabled", return_value=False),  # songs on this machine only
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def test_drops_least_recently_used_songs_over_budget(self):
        make_song(self.root, "yt-FEATURED000", 5, used_ago=10 * 86400)
        make_song(self.root, "up-old0000000", 2, used_ago=3600)
        make_song(self.root, "up-new0000000", 2, used_ago=60)
        self.assertEqual(storage.trim(), ["up-old0000000"])
        self.assertTrue((self.root / "songs" / "yt-FEATURED000").exists())  # never dropped, however big or old

    def test_drops_songs_unused_for_too_long(self):
        make_song(self.root, "up-stale000000", 0.1, used_ago=30 * 86400)
        make_song(self.root, "up-fresh000000", 0.1, used_ago=60)
        self.assertEqual(storage.trim(), ["up-stale000000"])

    def test_trims_renders_oldest_first_and_skips_ones_in_progress(self):
        d = make_song(self.root, "yt-FEATURED000", 0.1, used_ago=0)
        v = d / "variants"
        v.mkdir()
        for i, name in enumerate(["backing_1x_+1.m4a", "backing_1x_+2.m4a", "vocals_1x_+3.tmp.m4a"]):
            (v / name).write_bytes(b"x" * 600_000)
            os.utime(v / name, (time.time() - 100 + i, time.time() - 100 + i))
        storage.trim()
        self.assertEqual(sorted(p.name for p in v.iterdir()), ["backing_1x_+2.m4a", "vocals_1x_+3.tmp.m4a"])


if __name__ == "__main__":
    unittest.main()
