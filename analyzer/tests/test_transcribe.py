import unittest

from lemo_analyzer import transcribe


def seg(t, text, words=()):
    return {"start": t, "end": t + 1, "text": text, "words": [{"start": t, "end": t + 0.5, "word": w} for w in words]}


class TranscribeTests(unittest.TestCase):
    def test_lines_keep_their_words_and_timing(self):
        out = transcribe.clean([seg(3, " तुम ही हो", [" तुम", " ही", " हो"])])
        self.assertEqual(out[0]["text"], "तुम ही हो")
        self.assertEqual([w["text"] for w in out[0]["words"]], ["तुम ", "ही ", "हो"])
        self.assertEqual(transcribe.as_lrc(out), "[00:03.000]तुम ही हो")

    def test_what_nobody_sang_is_dropped(self):
        out = transcribe.clean([seg(1, " Subscribe to my channel"), seg(2, " ♪"), seg(3, " ."), seg(4, " dil")])
        self.assertEqual([o["text"] for o in out], ["dil"])

    def test_a_line_repeated_on_and_on_is_cut_short(self):
        out = transcribe.clean([seg(i, " la la") for i in range(10)])
        self.assertEqual(len(out), 4)

    def test_languages_whisper_does_not_know_are_written_as_hindi(self):
        self.assertEqual(transcribe.language_for("gw"), "hi")
        self.assertEqual(transcribe.language_for("pa"), "hi")
        self.assertIsNone(transcribe.language_for("xx"))


if __name__ == "__main__":
    unittest.main()
