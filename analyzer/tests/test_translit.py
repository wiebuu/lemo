"""Hinglish / Hindi / Urdu lyrics conversion (the offline parts)."""

import unittest

from lemo_analyzer.translit import convert_line, deva_to_latin, script_of


class TranslitTests(unittest.TestCase):
    def test_hinglish_spellings(self):
        cases = {
            "मुझको इतना बताए कोई": "Mujhko itna bataye koi",
            "कैसे तुझसे दिल ना लगाए कोई": "Kaise tujhse dil na lagaye koi",
            "मैं हूँ तेरा": "Main hoon tera",
            "वो प्यार क्या है": "Wo pyaar kya hai",
            "रब्बा ने तुझको बनाने में": "Rabba ne tujhko banaane mein",
        }
        for deva, latin in cases.items():
            self.assertEqual(deva_to_latin(deva), latin)

    def test_script_detection(self):
        self.assertEqual(script_of("tum hi ho"), "latin")
        self.assertEqual(script_of("तुम ही हो"), "deva")
        self.assertEqual(script_of("تم ہی ہو"), "urdu")

    def test_mixed_caption_lines_keep_the_wanted_part(self):
        line = "ایسا دیکھا نہیں خوبصورت کوئی aisa dekha naheen khoob-soorat koi"
        self.assertEqual(convert_line(line, "latin"), "aisa dekha naheen khoob-soorat koi")
        self.assertEqual(convert_line(line, "urdu"), "ایسا دیکھا نہیں خوبصورت کوئی")

    def test_english_translation_after_the_lyric_is_dropped(self):
        line = "ایسا دیکھا نہیں خوبصورت کوئی aisa dekha naheen khoob-soorat koyi We have never seen one with such beauty as she"
        self.assertEqual(convert_line(line, "latin"), "aisa dekha naheen khoob-soorat koyi")
        line2 = "جسم جیسے اجنتا کی مورت کوئی jism jaise ajanta ki moorat koyi Hers is the beauty of the sculptured idols of Ajanta"
        self.assertEqual(convert_line(line2, "latin"), "jism jaise ajanta ki moorat koyi")

    def test_urdu_only_is_not_guessed(self):
        self.assertIsNone(convert_line("ایسا دیکھا نہیں", "latin"))
        self.assertIsNone(convert_line("ایسا دیکھا نہیں", "deva"))

    def test_same_script_is_unchanged(self):
        self.assertEqual(convert_line("tum hi ho", "latin"), "tum hi ho")


if __name__ == "__main__":
    unittest.main()
