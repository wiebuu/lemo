"""Finding a song by a bit of its lyrics, typed any way."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from lemo_analyzer import lyricsearch

SONGS = {
    "yt-tumhiho": ("Tum Hi Ho", "Hum tere bin ab reh nahi sakte\nTere bina kya wajood mera"),
    "yt-dekha": ("Dekha Hazaro Dafaa", "Dekha hazaaron dafa aap ko\nPhir beqaraari kaisi hai"),
    "yt-punjabi": ("Ajj Din Chadheya", "ਅੱਜ ਦਿਨ ਚੜ੍ਹਿਆ ਤੇਰੇ ਰੰਗ ਵਰਗਾ"),
    "yt-perfect": ("Perfect", "I found a love, for me\nDarling, just dive right in"),
}


class SkeletonTest(unittest.TestCase):
    def test_spellings_meet(self):
        for a, b in [("mohabbat", "mohobat"), ("zaroori", "jaruri"), ("hai", "he"), ("bheegi", "bhigi")]:
            self.assertEqual(lyricsearch.skel(a), lyricsearch.skel(b), (a, b))


class SearchTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        for sid, (_, text) in SONGS.items():
            (root / sid).mkdir()
            (root / sid / "lyrics.json").write_text(json.dumps({"plain": text}))
        cat = {sid: {"id": sid, "title": t} for sid, (t, _) in SONGS.items()}
        for p in [
            mock.patch.object(lyricsearch.catalog, "load", lambda: cat),
            mock.patch.object(lyricsearch.catalog, "all_songs", lambda: list(cat.values())),
            mock.patch.object(lyricsearch, "_lyrics_file", lambda sid: root / sid / "lyrics.json"),
            mock.patch.object(lyricsearch, "_index", {}),
            mock.patch.object(lyricsearch, "_built", {"at": 0.0}),
        ]:
            p.start()
            self.addCleanup(p.stop)

    def ids(self, q):
        return [r["id"] for r in lyricsearch.search(q)]

    def test_misspelt_words_in_order(self):
        self.assertEqual(self.ids("hum tere bin ab reh nai sakte")[0], "yt-tumhiho")
        self.assertEqual(self.ids("dekha hazaro dafa")[0], "yt-dekha")

    def test_punjabi_script_is_read_as_hinglish(self):
        self.assertEqual(self.ids("aaj din chadeya")[0], "yt-punjabi")

    def test_half_typed_last_word(self):
        self.assertEqual(self.ids("i found a lov")[0], "yt-perfect")

    def test_shows_the_matching_line(self):
        self.assertEqual(lyricsearch.search("phir bekarari kaisi")[0]["line"], "Phir beqaraari kaisi hai")

    def test_words_far_apart_or_unrelated_dont_match(self):
        self.assertEqual(self.ids("darling mohabbat zindagi"), [])
        self.assertEqual(self.ids("tere"), [])  # one word: that's for the name search
