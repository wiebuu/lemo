import unittest

from lemo_analyzer.text_align import time_lines


def song(lines):
    """Timed lyrics: each line's words one second apart, lines 10 s apart."""
    out = []
    for i, text in enumerate(lines):
        ws = text.split()
        words = [{"start": i * 10 + k, "end": i * 10 + k + 0.8, "text": w} for k, w in enumerate(ws)]
        out.append({"start": words[0]["start"], "end": words[-1]["end"], "text": text, "words": words})
    return out


TIMED = song(["तुम ही हो", "अब तुम ही हो", "ज़िंदगी अब तुम ही हो", "चैन भी मेरा दर्द भी"])


class TextAlignTests(unittest.TestCase):
    def test_same_words_in_hinglish_take_the_songs_timing(self):
        got = time_lines(["tum hi ho", "ab tum hi ho", "zindagi ab tum hi ho", "chain bhi mera dard bhi"], TIMED)
        self.assertEqual([g["start"] for g in got], [0, 10, 20, 30])
        self.assertEqual(got[2]["words"][1]["start"], 21)

    def test_spelling_and_line_breaks_may_differ(self):
        got = time_lines(["tum hee ho ab tum hi", "ho zindagee ab tum hi ho"], TIMED)
        self.assertEqual([g["start"] for g in got], [0, 13])  # "ho" is the 4th word of "अब तुम ही हो"

    def test_a_missing_word_is_placed_between_its_neighbours(self):
        got = time_lines(["chain bhi mera pyaara dard bhi"], TIMED)
        w = got[0]["words"]
        self.assertTrue(w[2]["start"] < w[3]["start"] < w[4]["start"])

    def test_other_lyrics_are_not_trusted(self):
        self.assertIsNone(time_lines(["kal ho na ho", "har ghadi badal rahi hai roop zindagi"], TIMED))


if __name__ == "__main__":
    unittest.main()
