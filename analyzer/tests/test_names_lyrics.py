"""Song names from YouTube, and lyrics from a video's description."""

import unittest

from lemo_analyzer.lyrics import auto_caption_lrc, description_lyrics, readable_script
from lemo_analyzer.youtube import clean_title


class CleanTitleTest(unittest.TestCase):
    def test_song_first_when_the_channel_is_the_singer(self):
        m = {"title": "DIL NU - AP DHILLON | SHINDA KAHLON (Official Audio)", "uploader": "APDHILLON"}
        self.assertEqual(clean_title(m), ("Dil Nu", "AP Dhillon"))

    def test_the_usual_singer_first(self):
        self.assertEqual(clean_title({"title": "Arijit Singh - Tum Hi Ho (Official Video)", "uploader": "T-Series"}), ("Tum Hi Ho", "Arijit Singh"))

    def test_description_credits_win(self):
        m = {"title": "whatever - title", "uploader": "x", "description": "SONG : DIL NU\nARTIST : AP DHILLON | SHINDA KAHLON\n"}
        self.assertEqual(clean_title(m), ("Dil Nu", "AP Dhillon"))

    def test_youtube_music_track_wins(self):
        self.assertEqual(clean_title({"title": "x", "track": "Perfect", "artist": "Ed Sheeran, Beyoncé"}), ("Perfect", "Ed Sheeran"))


class DescriptionLyricsTest(unittest.TestCase):
    DESC = """Subscribe: http://bit.ly/x

SONG : DIL NU
WRITTEN BY : SHINDA KAHLON

LYRICS -

Kol hi ee tu tavi lage meinu door
Socha kyon mein eda koi gal te zarur
Zara puch k tu das, ki nahi ki ee sach
Tere dil nu

Raatan nu das meinu neend kyon na ave
Tu theek ae k nahi mera chit ghabrave
Mere dil nu

#apdhillon #song
"""

    def test_takes_the_lyrics_block_only(self):
        text = description_lyrics(self.DESC)
        lines = text.splitlines()
        self.assertEqual(lines[0], "Kol hi ee tu tavi lage meinu door")
        self.assertEqual(lines[-1], "Mere dil nu")
        self.assertEqual(len(lines), 7)

    def test_no_heading_no_lyrics(self):
        self.assertIsNone(description_lyrics("Follow me on instagram\nSONG : X"))


class AutoCaptionsTest(unittest.TestCase):
    def test_rolling_captions_become_clean_lines(self):
        def ev(t, words):
            return {"tStartMs": t, "segs": [{"utf8": w, "tOffsetMs": o} for w, o in words]}
        data = {"events": [
            {"tStartMs": 0, "segs": [{"utf8": "[Music]"}]},
            ev(18000, [("kol", None), (" hi", 400), (" ae", 800), (" tu", 1200)]),
            {"tStartMs": 19500, "aAppend": 1, "segs": [{"utf8": "\n"}]},
            ev(21000, [("sochan", None), (" kyon", 400), (" main", 800)]),
            ev(24000, [("zara", None), (" puchh", 400), (" ke", 800), (" tu", 1200), (" dass", 1600)]),
        ]}
        lines = auto_caption_lrc(data).splitlines()
        self.assertEqual(lines[0], "[00:18.00]kol hi ae tu")
        self.assertEqual(lines[1], "[00:21.00]sochan kyon main")
        self.assertTrue(lines[2].startswith("[00:24.00]zara puchh"))
        self.assertNotIn("Music", auto_caption_lrc(data))

    def test_readable_scripts(self):
        self.assertTrue(readable_script("[00:01.00]Kol hi ae tu"))
        self.assertTrue(readable_script("[00:01.00]कोल ही है तू"))
        self.assertFalse(readable_script("[00:01.00]Whoa\n[00:02.00]ਕੋਲ਼ ਹੀ ਐ ਤੂੰ, ਤਾਂ ਵੀ ਲੱਗੇ ਮੈਨੂੰ ਦੂਰ"))


if __name__ == "__main__":
    unittest.main()
