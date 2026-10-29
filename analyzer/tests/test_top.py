"""Today's top and the stats page, against the lemo_test database (skipped without PostgreSQL)."""

import io
import json
import os
import struct
import tempfile
import unittest
import wave
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from lemo_analyzer import auth, catalog, server, top, userdata
from tests.test_userdata import ALICE, BOB, TEST_DSN, _reachable

SONG = "yt-abcdefghijk"


def _wav(seconds=1.0, rate=8000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", (i * 37) % 2000 - 1000) for i in range(int(seconds * rate))))
    return buf.getvalue()


FRAMES = json.dumps({"t": [i / 100 for i in range(50)], "m": [60.0] * 50, "c": [0.9] * 50, "l": [-20.0] * 50})


@unittest.skipUnless(os.environ.get("DATABASE_URL") and _reachable(), "local PostgreSQL (lemo_test) not available")
class TopTests(unittest.TestCase):
    def setUp(self):
        userdata.use(TEST_DSN)
        userdata.status()
        userdata._q("TRUNCATE lemo_top, lemo_daily, lemo_requests, lemo_prefs, lemo_songs, lemo_users")
        tokens = {"Bearer a": ALICE, "Bearer b": BOB}

        def verify(header):
            if header not in tokens:
                raise auth.AuthError("sign in with Google first")
            return tokens[header]

        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.patches = [mock.patch.object(auth, "verify", side_effect=verify),
                        mock.patch.object(top, "root", return_value=root),
                        mock.patch.object(catalog, "is_public", return_value=True)]
        for p in self.patches:
            p.start()
        self.root = root
        self.c = TestClient(server.app)

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()
        userdata.use(None)

    def submit(self, score, who="a", seconds=75.0, song=SONG, voice=True):
        meta = {"songId": song, "title": "Song", "artist": "Singer", "score": score, "seconds": seconds,
                "from": 10.0, "to": 10.0 + seconds, "start": 9.5, "keyOffset": 0, "scores": {"overall": score}}
        files = {"frames": ("frames.json", FRAMES, "application/json")}
        if voice:
            files["voice"] = ("voice.wav", _wav(), "audio/wav")
        return self.c.post("/api/top/submit", headers={"Authorization": f"Bearer {who}"}, data={"meta": json.dumps(meta)}, files=files)

    def fill(self, n, score=0.5):
        """n other singers already in today's top."""
        day = top.today()
        for i in range(n):
            uid = f"u{i}"
            userdata._q("INSERT INTO lemo_users (uid, name, created_at, last_seen) VALUES (%s, %s, 0, 0)", (uid, f"Singer {i}"))
            take = f"t{i:04d}"
            (self.root / take).mkdir()
            userdata.top_add({"id": take, "day": day, "uid": uid, "songId": SONG, "score": score - i * 0.001, "seconds": 70.0, "meta": {}})

    def get(self, path, who="a"):
        return self.c.get(path, headers={"Authorization": f"Bearer {who}"})

    def test_a_take_is_kept_with_its_voice_and_can_be_opened(self):
        r = self.submit(0.8)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["rank"], 1)
        board = self.get("/api/top", who="b").json()
        self.assertEqual(len(board["entries"]), 1)
        e = board["entries"][0]
        self.assertEqual((e["name"], e["mine"], e["rank"]), ("Alice", False, 1))
        self.assertTrue(self.get("/api/top", who="a").json()["entries"][0]["mine"])
        take = self.get(f"/api/top/{e['id']}", who="b").json()
        self.assertEqual(take["frames"]["m"][0], 60.0)
        self.assertEqual(take["meta"]["from"], 10.0)
        v = self.get(f"/api/top/{e['id']}/voice", who="b")
        self.assertEqual(v.status_code, 200)
        self.assertGreater(len(v.content), 100)

    def test_the_voice_is_only_kept_when_the_singer_shares_it(self):
        r = self.submit(0.8, voice=False).json()
        self.assertEqual(r["rank"], 1)
        take = r["id"]
        self.assertFalse(self.get("/api/top", who="b").json()["entries"][0]["hasVoice"])
        self.assertFalse(self.get(f"/api/top/{take}", who="b").json()["hasVoice"])
        self.assertEqual(self.get(f"/api/top/{take}/voice", who="b").status_code, 404)
        share = lambda who: self.c.post(f"/api/top/{take}/voice", headers={"Authorization": f"Bearer {who}"},
                                        files={"voice": ("voice.wav", _wav(), "audio/wav")})
        self.assertEqual(share("b").status_code, 422)  # only the singer can share it
        self.assertEqual(share("a").status_code, 200)
        self.assertTrue(self.get("/api/top", who="b").json()["entries"][0]["hasVoice"])
        self.assertEqual(self.get(f"/api/top/{take}/voice", who="b").status_code, 200)

    def test_less_than_a_minute_does_not_count(self):
        self.assertEqual(self.submit(0.9, seconds=40).status_code, 422)
        self.assertEqual(self.get("/api/top").json()["entries"], [])

    def test_one_place_per_singer_their_best(self):
        self.submit(0.6)
        self.assertEqual(self.c.post("/api/top/check", headers={"Authorization": "Bearer a"}, json={"score": 0.5}).json()["rank"], None)
        self.assertEqual(self.submit(0.5).json()["rank"], None)  # not better: nothing changes
        self.assertEqual(self.submit(0.7).json()["rank"], 1)
        entries = self.get("/api/top").json()["entries"]
        self.assertEqual([round(e["score"], 2) for e in entries], [0.7])
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), [entries[0]["id"]])  # the old take's files are gone

    def test_only_the_best_100_are_kept_and_the_rest_deleted(self):
        self.fill(100)
        self.assertIsNone(self.c.post("/api/top/check", headers={"Authorization": "Bearer a"}, json={"score": 0.3}).json()["rank"])
        self.assertEqual(self.submit(0.3).json()["rank"], None)
        r = self.submit(0.9).json()
        self.assertEqual(r["rank"], 1)
        entries = self.get("/api/top").json()["entries"]
        self.assertEqual(len(entries), 100)
        self.assertNotIn("t0099", [e["id"] for e in entries])  # the 100th dropped out …
        self.assertFalse((self.root / "t0099").exists())  # … with its files
        self.assertEqual(len(list(self.root.iterdir())), 100)

    def test_earlier_days_are_cleared(self):
        self.fill(3)
        userdata._q("UPDATE lemo_top SET day = '2000-01-01' WHERE id = 't0000'")
        entries = self.get("/api/top").json()["entries"]
        self.assertEqual([e["id"] for e in entries], ["t0001", "t0002"])
        self.assertFalse((self.root / "t0000").exists())

    def test_stats(self):
        self.submit(0.8)
        h = {"Authorization": "Bearer a"}
        self.c.post("/api/stats/test", headers=h, json={})
        self.c.post("/api/stats/test", headers=h, json={})
        self.c.post("/api/stats/test", headers=h, json={"finished": True, "seconds": 90})
        s = self.get("/api/stats").json()
        self.assertEqual((s["testsStarted"], s["testsFinished"], s["secondsSung"]), (2, 1, 90.0))
        self.assertEqual(s["today"]["testsStarted"], 2)
        self.assertEqual((s["singers"], s["inTop"]), (1, 1))
        self.assertIn("songs", s)

    def test_needs_sign_in(self):
        self.assertEqual(self.c.get("/api/top").status_code, 401)
        self.assertEqual(self.c.get("/api/stats").status_code, 200)  # the numbers are public


if __name__ == "__main__":
    unittest.main()
