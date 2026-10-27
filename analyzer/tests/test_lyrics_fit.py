"""Timed lyrics are checked against when the singer actually sings."""

import unittest

from lemo_analyzer import lyrics_fit

# a song: 8 sung phrases of 3 s, every 6 s from 10 s
NOTES = [{"startTime": 10 + 6 * k + 0.5 * i, "endTime": 10 + 6 * k + 0.5 * i + 0.45, "sung": True} for k in range(8) for i in range(6)]
DUR = 70.0


def lrc(starts):
    return "\n".join(f"[{int(t // 60):02d}:{t % 60:05.2f}]line {i}" for i, t in enumerate(starts))


class FitTest(unittest.TestCase):
    def test_lyrics_of_this_recording_fit(self):
        f, off, _ = lyrics_fit.fit(lrc([10 + 6 * k for k in range(8)]), NOTES, DUR)
        self.assertGreater(f, 0.8)
        self.assertEqual(off, 0.0)

    def test_another_song_doesnt(self):
        f, _, _ = lyrics_fit.fit(lrc([2, 5.5, 9, 20.5, 31, 33.5, 47, 60]), NOTES, DUR)
        self.assertLess(f, lyrics_fit.MATCHES)

    def test_shifted_lyrics_are_found_and_shifted_back(self):
        f, off, f0 = lyrics_fit.fit(lrc([10 + 6 * k + 3 for k in range(8)]), NOTES, DUR)
        self.assertGreater(f, 0.8)
        self.assertAlmostEqual(off, -3.0, places=1)
        self.assertLess(f0, f)
        moved = lyrics_fit.shift_lrc("[00:13.00]a\n[01:02.50]b", -3.0)
        self.assertEqual(moved, "[00:10.00]a\n[00:59.50]b")

    def test_length_rules(self):
        self.assertTrue(lyrics_fit.matches(0.65, 262, 260))
        self.assertFalse(lyrics_fit.matches(0.65, 275, 134))  # a full-song version on a short edit
        self.assertTrue(lyrics_fit.matches(0.8, 254, 233))
        self.assertGreater(lyrics_fit.rank(0.78, 233, 233), lyrics_fit.rank(0.80, 254, 233))


if __name__ == "__main__":
    unittest.main()
