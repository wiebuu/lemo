"""Run: .venv/bin/python -m unittest discover -s tests"""

import unittest

import numpy as np

from lemo_analyzer.melody import contour_json, hz_to_midi, median_filter_voiced, segment_notes
from lemo_analyzer.youtube import clean_title, video_id

HOP = 0.01


def contour(*parts):
    """parts: (seconds, midi or None) — builds a 10 ms contour."""
    out = []
    for dur, m in parts:
        out += [np.nan if m is None else m] * int(round(dur / HOP))
    return np.array(out, dtype=float)


class SegmentationTests(unittest.TestCase):
    def notes(self, c, **kw):
        return segment_notes(c, np.ones_like(c), **kw)

    def test_known_melody(self):
        c = contour((0.5, None), (0.5, 60), (0.5, 62), (0.2, None), (1.0, 64))
        n = self.notes(c)
        self.assertEqual([round(x["midiPitch"]) for x in n], [60, 62, 64])
        self.assertAlmostEqual(n[0]["startTime"], 0.5, places=2)
        self.assertAlmostEqual(n[0]["endTime"], 1.0, places=2)
        self.assertAlmostEqual(n[2]["startTime"], 1.7, places=2)

    def test_vibrato_does_not_split(self):
        t = np.arange(0, 1.5, HOP)
        c = 67 + 0.6 * np.sin(2 * np.pi * 5.5 * t)
        n = self.notes(c)
        self.assertEqual(len(n), 1)
        self.assertAlmostEqual(n[0]["midiPitch"], 67, delta=0.1)

    def test_short_scoop_is_absorbed(self):
        c = contour((0.04, 57), (0.8, 60))
        n = self.notes(c)
        self.assertEqual(len(n), 1)
        self.assertAlmostEqual(n[0]["midiPitch"], 60, delta=0.1)

    def test_preserves_non_a440_tuning(self):
        c = contour((0.5, 60.3))
        self.assertAlmostEqual(self.notes(c)[0]["midiPitch"], 60.3, places=2)

    def test_drops_blips_and_low_confidence(self):
        c = contour((0.05, 70), (0.3, None), (0.5, 60))
        self.assertEqual(len(self.notes(c)), 1)
        self.assertEqual(segment_notes(c, np.full_like(c, 0.2)), [])

    def test_median_filter_never_bridges_gaps(self):
        c = contour((0.05, 60), (0.03, None), (0.05, 72))
        f = median_filter_voiced(c)
        self.assertTrue(np.isnan(f[6]))
        self.assertEqual(f[0], 60)
        self.assertEqual(f[-1], 72)

    def test_hz_to_midi(self):
        self.assertAlmostEqual(float(hz_to_midi(np.array([440.0]))[0]), 69)
        self.assertAlmostEqual(float(hz_to_midi(np.array([261.6256]))[0]), 60, places=3)

    def test_contour_json(self):
        j = contour_json(contour((0.04, 60), (0.04, None)))
        self.assertEqual(j["hop"], 0.02)
        self.assertEqual(j["midi"], [60.0, 60.0, None, None])


class YouTubeTests(unittest.TestCase):
    def test_video_ids(self):
        for u in [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=10",
            "https://youtu.be/dQw4w9WgXcQ?si=abc",
            "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x",
            "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        ]:
            self.assertEqual(video_id(u), "dQw4w9WgXcQ", u)

    def test_rejects_other_urls(self):
        for u in ["https://example.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ", "https://youtube.com/watch?v=short", "file:///etc/passwd"]:
            self.assertIsNone(video_id(u), u)

    def test_clean_title(self):
        self.assertEqual(clean_title({"title": "Adele - Hello (Official Music Video)"}), ("Hello", "Adele"))
        self.assertEqual(clean_title({"title": "x", "track": "Hello", "artist": "Adele, Someone"}), ("Hello", "Adele"))
        self.assertEqual(clean_title({"title": "Song [Lyrics]", "uploader": "Band - Topic"}), ("Song", "Band"))



class ExpressionTests(unittest.TestCase):
    def test_note_loudness_is_relative(self):
        from lemo_analyzer.melody import attach_note_loudness

        rel = np.concatenate([np.full(50, -6.0), np.full(50, 6.0)])
        notes = [{"startTime": 0.0, "endTime": 0.5}, {"startTime": 0.5, "endTime": 1.0}]
        attach_note_loudness(notes, rel)
        self.assertEqual([n["loudness"] for n in notes], [-6.0, 6.0])

    def test_chords_from_chroma(self):
        from lemo_analyzer.melody import chords_from_chroma

        times = np.arange(0, 2, 0.05)
        chroma = np.zeros((12, len(times)))
        chroma[[0, 4, 7], : len(times) // 2] = 1  # C major
        chroma[[9, 0, 4], len(times) // 2 :] = 1  # A minor
        out = chords_from_chroma(chroma, times)
        self.assertEqual(out[0]["pcs"], [0, 4, 7])
        self.assertEqual(out[-1]["pcs"], [0, 4, 9])

    def test_unclear_chroma_claims_no_harmony(self):
        from lemo_analyzer.melody import chords_from_chroma

        times = np.arange(0, 2, 0.05)
        self.assertEqual(chords_from_chroma(np.ones((12, len(times))), times), [])



class LyricAlignTests(unittest.TestCase):
    def test_normalise_keeps_latin_letters_only(self):
        from lemo_analyzer.lyric_align import normalise

        self.assertEqual(normalise("Don't!"), "don't")
        self.assertEqual(normalise("Café,"), "cafe")
        self.assertEqual(normalise("दिल"), "dil")  # Hindi script is aligned through its Hinglish reading
        self.assertEqual(normalise("دل"), "")  # Urdu script can't be read reliably: left to the app

    def test_numbers_are_kept_between_neighbours(self):
        from lemo_analyzer.lyric_align import fill_unaligned

        out = fill_unaligned(["til", "we're", "70"], [(1.0, 1.2), (1.3, 1.6), None], line_end=3.0)
        self.assertEqual([w["text"] for w in out], ["til ", "we're ", "70"])
        self.assertAlmostEqual(out[2]["start"], 1.6)
        self.assertGreater(out[2]["end"], out[2]["start"])
        mid = fill_unaligned(["a", "2", "b"], [(0.0, 0.2), None, (1.0, 1.2)], line_end=2)
        self.assertEqual((mid[1]["start"], mid[1]["end"]), (0.2, 1.0))


if __name__ == "__main__":
    unittest.main()
