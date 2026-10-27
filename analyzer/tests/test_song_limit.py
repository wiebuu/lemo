"""At the song storage limit new songs are refused; stored songs keep working."""

import json
import tempfile
import time
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from lemo_analyzer import auth, jobs, server, storage
from lemo_analyzer.config import CONFIG

USER = {"uid": "u", "email": "u@example.com", "exp": time.time() + 3600, "firebase": {"sign_in_provider": "google.com"}}


class SongLimitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        cfg = replace(CONFIG, data_dir=root, song_limit_gb=1 / 1024, enable_youtube=True)  # 1 MB
        self.patches = [
            mock.patch.object(storage, "CONFIG", cfg),
            mock.patch.object(server, "CONFIG", cfg),
            mock.patch.object(jobs, "CONFIG", cfg),
            mock.patch.object(auth, "verify", return_value=USER),
            mock.patch.object(jobs.MANAGER, "submit", return_value={"id": "x", "stage": "queued"}),
            mock.patch("lemo_analyzer.remote.enabled", return_value=False),  # songs on this machine only
        ]
        for p in self.patches:
            p.start()
        storage._size_cache["at"] = 0
        self.root = root
        self.c = TestClient(server.app)

    def tearDown(self):
        for p in self.patches:
            p.stop()
        storage._size_cache["at"] = 0
        self.tmp.cleanup()

    def add_song(self, sid: str, mb: float):
        d = self.root / "songs" / sid
        d.mkdir(parents=True)
        (d / "reference.json").write_text(json.dumps({"id": sid}))
        (d / "backing.m4a").write_bytes(b"x" * int(mb * 1048576))
        storage._size_cache["at"] = 0

    def analyze(self, vid: str):
        return self.c.post("/api/songs/analyze", data={"url": f"https://www.youtube.com/watch?v={vid}"}, headers={"Authorization": "Bearer t"})

    def test_room_left_means_new_songs_are_accepted(self):
        self.assertEqual(self.analyze("aaaaaaaaaaa").status_code, 200)

    def test_full_storage_refuses_new_songs_with_a_clear_message(self):
        self.add_song("yt-bbbbbbbbbbb", 1.2)
        r = self.analyze("aaaaaaaaaaa")
        self.assertEqual(r.status_code, 507)
        detail = r.json()["detail"]
        self.assertEqual(detail["code"], "storage_full")
        self.assertIn("full", detail["message"])

    def test_a_song_already_stored_still_works_when_full(self):
        self.add_song("yt-bbbbbbbbbbb", 1.2)
        self.assertEqual(self.analyze("bbbbbbbbbbb").status_code, 200)

    def test_health_reports_usage(self):
        self.add_song("yt-bbbbbbbbbbb", 1.2)
        s = self.c.get("/api/health").json()["storage"]
        self.assertTrue(s["full"])
        self.assertGreater(s["usedMb"], 1)


if __name__ == "__main__":
    unittest.main()
