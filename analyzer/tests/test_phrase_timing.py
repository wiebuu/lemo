import unittest

from lemo_analyzer.phrase_timing import phrases, time_lines


def sung(*spans):
    """notes covering each (start, end) span, one every 0.25 s"""
    out = []
    for s, e in spans:
        t = s
        while t < e:
            out.append({"startTime": t, "endTime": min(e, t + 0.25), "sung": True})
            t += 0.25
    return out


class PhraseTimingTest(unittest.TestCase):
    def test_breaths_split_phrases(self):
        self.assertEqual(len(phrases(sung((10, 14), (15.5, 19), (40, 44)))), 3)

    def test_one_line_per_phrase_lands_on_each_phrase(self):
        notes = sung((10, 14), (15.5, 19.5), (40, 44), (45.5, 49.5))
        lines = time_lines(["one two three", "four five six", "seven eight nine", "ten eleven twelve"], notes, 60)
        self.assertEqual([round(l["start"], 1) for l in lines], [10.0, 15.5, 40.0, 45.5])
        for l in lines:
            self.assertGreater(l["end"], l["start"])

    def test_skips_the_instrumental_gap(self):
        notes = sung((10, 20), (60, 70))
        lines = time_lines(["a b c d", "e f g h", "i j k l", "m n o p"], notes, 80)
        self.assertTrue(all(not (21 < l["start"] < 59) for l in lines))

    def test_always_in_order(self):
        notes = sung((10, 11))
        lines = time_lines([f"line {i}" for i in range(12)], notes, 30)
        starts = [l["start"] for l in lines]
        self.assertEqual(starts, sorted(starts))
        self.assertEqual(len(set(starts)), len(starts))

    def test_no_notes_spreads_over_the_song(self):
        lines = time_lines(["a", "b"], [], 100)
        self.assertEqual(len(lines), 2)
        self.assertLess(lines[0]["start"], lines[1]["start"])


if __name__ == "__main__":
    unittest.main()
