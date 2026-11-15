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
        userdata._q("TRUNCATE lemo_likes, lemo_song_stats, lemo_top, lemo_daily, lemo_requests, lemo_prefs, lemo_songs, lemo_users")
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

    def test_a_private_voice_plays_only_for_its_singer(self):
        take = self.submit(0.8, voice=False).json()["id"]
        send = lambda who, private, voice=True: self.c.post(
            f"/api/top/{take}/{'private-voice' if private == '1' else 'voice'}", headers={"Authorization": f"Bearer {who}"},
            files={"voice": ("voice.wav", _wav(), "audio/wav")} if voice else None)
        self.assertEqual(send("b", "1").status_code, 422)  # not their take
        self.assertEqual(send("a", "1").status_code, 200)
        mine, theirs = self.get("/api/top", who="a").json()["entries"][0], self.get("/api/top", who="b").json()["entries"][0]
        self.assertEqual((mine["hasVoice"], mine["voicePrivate"]), (True, True))
        self.assertEqual((theirs["hasVoice"], theirs["voicePrivate"]), (False, True))
        self.assertTrue(self.get(f"/api/top/{take}", who="a").json()["hasVoice"])
        self.assertFalse(self.get(f"/api/top/{take}", who="b").json()["hasVoice"])
        self.assertEqual(self.get(f"/api/top/{take}/voice", who="a").status_code, 200)
        self.assertEqual(self.get(f"/api/top/{take}/voice", who="b").status_code, 404)
        self.assertEqual(self.c.get(f"/api/top/{take}/voice").status_code, 404)  # a guest
        self.assertIsNotNone(top.voice(take, None))  # Lemody's admin
        # later shared with everyone, without sending the recording again
        self.assertEqual(send("a", "0", voice=False).status_code, 200)
        self.assertEqual(self.get(f"/api/top/{take}/voice", who="b").status_code, 200)

    def test_the_singer_downloads_their_cover_as_the_whole_song(self):
        import re
        import subprocess

        from lemo_analyzer import jobs
        from lemo_analyzer.config import FFMPEG

        songs = self.root / "songs"
        d = songs / SONG
        d.mkdir(parents=True)
        for stem, hz in (("backing", 220), ("vocals", 440)):  # a 90-second song
            subprocess.run([FFMPEG, "-v", "error", "-f", "lavfi", "-i", f"sine=frequency={hz}:duration=90",
                            "-c:a", "aac", str(d / f"{stem}.m4a")], check=True)
        with mock.patch.object(jobs, "song_dir", side_effect=lambda sid: songs / sid):
            take = self.submit(0.8, seconds=50.0, voice=False).json()["id"]
            self.assertEqual(self.get(f"/api/top/{take}/cover", who="a").status_code, 404)  # no voice yet
            self.c.post(f"/api/top/{take}/private-voice", headers={"Authorization": "Bearer a"},
                        files={"voice": ("voice.wav", _wav(), "audio/wav")})
            self.assertEqual(self.get(f"/api/top/{take}/cover", who="b").status_code, 404)  # not their take
            self.assertEqual(self.c.get(f"/api/top/{take}/cover").status_code, 401)  # a guest
            r = self.get(f"/api/top/{take}/cover", who="a")
            self.assertEqual(r.status_code, 200, r.text)
            self.assertIn("attachment", r.headers["content-disposition"])
            self.assertIn("Song%20-%20my%20Lemody%20cover.m4a", r.headers["content-disposition"])
            got = self.root / "got.m4a"
            got.write_bytes(r.content)
            info = subprocess.run([FFMPEG, "-i", str(got)], capture_output=True, text=True).stderr
            h, m, s = re.search(r"Duration: (\d+):(\d+):([\d.]+)", info).groups()
            self.assertAlmostEqual(int(h) * 3600 + int(m) * 60 + float(s), 90.0, delta=0.5)  # the whole song
            self.assertIsNotNone(top.cover_file(take, None))  # Lemody's admin

    def test_easy_needs_at_least_50_and_the_level_is_shown(self):
        meta = {"songId": SONG, "score": 0.49, "seconds": 70.0, "from": 0, "to": 70, "start": 0, "toleranceCents": 100}
        post = lambda: self.c.post("/api/top/submit", headers={"Authorization": "Bearer a"}, data={"meta": json.dumps(meta)},
                                   files={"frames": ("frames.json", FRAMES, "application/json")})
        self.assertEqual(post().status_code, 422)
        meta["score"] = 0.5
        self.assertEqual(post().json()["rank"], 1)
        self.assertEqual(self.get("/api/top").json()["entries"][0]["toleranceCents"], 100)
        meta["score"], meta["toleranceCents"] = 0.9, 25
        r = post()
        self.assertEqual(r.json()["rank"], 1)
        self.assertEqual(self.get("/api/top").json()["entries"][0]["toleranceCents"], 25)

    def test_less_than_45_seconds_does_not_count(self):
        self.assertEqual(self.submit(0.9, seconds=44).status_code, 422)
        self.assertEqual(self.get("/api/top").json()["entries"], [])
        self.assertEqual(self.submit(0.9, seconds=45).status_code, 200)
        self.assertEqual(len(self.get("/api/top").json()["entries"]), 1)

    def test_one_place_per_singer_their_best(self):
        self.submit(0.6)
        self.assertEqual(self.c.post("/api/top/check", headers={"Authorization": "Bearer a"}, json={"score": 0.5}).json()["rank"], None)
        self.assertEqual(self.submit(0.5).json()["rank"], None)  # not better: nothing changes
        self.assertEqual(self.submit(0.7).json()["rank"], 1)
        entries = self.get("/api/top").json()["entries"]
        self.assertEqual([round(e["score"], 2) for e in entries], [0.7])
        self.assertEqual(sorted(p.name for p in self.root.iterdir()), [entries[0]["id"]])  # the old take's files are gone

    def test_one_place_per_singer_per_song_several_songs_allowed(self):
        OTHER = "yt-zyxwvutsrqp"
        check = lambda score, song: self.c.post("/api/top/check", headers={"Authorization": "Bearer a"},
                                                json={"score": score, "songId": song}).json()["rank"]
        self.assertEqual(self.submit(0.6).json()["rank"], 1)
        self.assertEqual(self.submit(0.5, who="b").json()["rank"], 2)  # the same song, another singer: both stay
        # another song of Alice's goes on too, even with a lower score than her first
        self.assertEqual(check(0.4, OTHER), 3)
        self.assertEqual(self.submit(0.4, song=OTHER).json()["rank"], 3)
        # the same song again: only a better take replaces it
        self.assertIsNone(check(0.55, SONG))
        self.assertIsNone(self.submit(0.55).json()["rank"])
        self.assertEqual(self.submit(0.45, song=OTHER).json()["rank"], 3)
        board = self.get("/api/top").json()["entries"]
        self.assertEqual([(e["name"], e["songId"], round(e["score"], 2)) for e in board],
                         [("Alice", SONG, 0.6), ("Bob", SONG, 0.5), ("Alice", OTHER, 0.45)])
        self.assertEqual(len(list(self.root.iterdir())), 3)  # the replaced take's files are gone
        self.assertEqual(self.get("/api/stats").json()["singers"], 2)  # singers, not takes

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
        self.assertEqual(self.c.get("/api/top").status_code, 200)  # a guest can look
        self.assertEqual(self.c.get("/api/stats").status_code, 200)  # the numbers are public
        self.assertEqual(self.c.post("/api/top/check", json={"score": 0.9}).status_code, 200)  # …and learn their rank
        self.assertEqual(self.c.post("/api/top/1234abcd/voice", files={"voice": ("v.wav", _wav(), "audio/wav")}).status_code, 401)
        self.assertEqual(self.c.get("/api/me").status_code, 401)

    def guest(self, score, ip, voice=False, song=SONG):
        meta = {"songId": song, "title": "Song", "score": score, "seconds": 75.0, "from": 10.0, "to": 85.0, "start": 9.5, "keyOffset": 0}
        files = {"frames": ("frames.json", FRAMES, "application/json")}
        if voice:
            files["voice"] = ("voice.wav", _wav(), "audio/wav")
        return self.c.post("/api/top/submit", headers={"x-real-ip": ip}, data={"meta": json.dumps(meta)}, files=files)

    def test_a_guest_goes_on_the_top_as_a_guest_singer_one_place_per_address(self):
        self.submit(0.8)
        r = self.guest(0.9, "1.2.3.4")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["rank"], 1)
        self.assertEqual(self.guest(0.85, "1.2.3.4").json()["rank"], None)  # the same guest: their best stays
        self.assertEqual(self.guest(0.85, "1.2.3.4", song="yt-zyxwvutsrqp").json()["rank"], None)  # one place in all, any song
        self.assertEqual(self.guest(0.7, "5.6.7.8").json()["rank"], 3)  # someone else
        self.assertEqual(self.guest(0.95, "9.9.9.9", voice=True).status_code, 401)  # a voice needs a sign-in
        board = self.c.get("/api/top", headers={"x-real-ip": "1.2.3.4"}).json()["entries"]
        self.assertEqual([(e["name"], e["mine"]) for e in board], [("a guest singer", True), ("Alice", False), ("a guest singer", False)])
        self.assertEqual(self.get("/api/stats").json()["singers"], 1)  # guests aren't counted as singers


if __name__ == "__main__":
    unittest.main()
