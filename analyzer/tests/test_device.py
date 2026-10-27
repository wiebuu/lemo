"""A song analysed on someone's device is only kept if it really belongs to the song."""

import tempfile
import unittest
from pathlib import Path

import numpy as np
import soundfile as sf

from lemo_analyzer import device

SR = device.SR


def tone(f, secs, amp=0.3):
    t = np.arange(int(secs * SR)) / SR
    x = sum(amp / k * np.sin(2 * np.pi * f * k * t) for k in (1, 2, 3))
    return np.stack([x, x]).astype(np.float32)


class CheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        rng = np.random.default_rng(1)
        self.voc = tone(220, 12)
        self.bak = (rng.standard_normal(self.voc.shape) * 0.1).astype(np.float32)
        self.write("mix", self.voc + self.bak)
        n = self.voc.shape[1]
        frames = 1 + int(round(n * 16000 / SR)) // 160
        self.f0 = np.full(frames, 220, np.float32)
        self.per = np.full(frames, 0.95, np.float32)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, x):
        sf.write(self.dir / f"{name}.wav", x.T, SR, subtype="PCM_16")
        return self.dir / f"{name}.wav"

    def check(self, voc=None, bak=None, f0=None):
        device.check(self.dir / "mix.wav", self.write("v", self.voc if voc is None else voc),
                     self.write("b", self.bak if bak is None else bak), self.f0 if f0 is None else f0, self.per)

    def test_a_good_result_passes_even_a_little_late_or_early(self):
        for shift in (1105, -900):
            v = np.roll(self.voc, shift, 1)
            b = np.roll(self.bak, shift, 1)
            voc, bak, f0, per = device.check(self.dir / "mix.wav", self.write("v", v), self.write("b", b), self.f0, self.per)
            self.assertEqual(voc.shape, self.voc.shape)
            mid = slice(SR, SR * 10)
            self.assertLess(float(np.abs(voc[:, mid] - self.voc[:, mid]).max()), 1e-3)  # lined up again
            self.assertEqual(len(f0), len(self.f0))

    def test_octave_slips_are_fine(self):
        self.check(f0=self.f0 * 2)

    def test_wrong_pitch_is_rejected(self):
        with self.assertRaisesRegex(device.Rejected, "pitch"):
            self.check(f0=self.f0 * 1.2)

    def test_music_from_elsewhere_is_rejected(self):
        with self.assertRaisesRegex(device.Rejected, "add back up"):
            self.check(bak=np.roll(self.bak, SR, 1))

    def test_no_voice_is_rejected(self):
        with self.assertRaises(device.Rejected):
            self.check(voc=np.zeros_like(self.voc), bak=self.voc + self.bak)

    def test_wrong_length_is_rejected(self):
        with self.assertRaisesRegex(device.Rejected, "long"):
            self.check(voc=self.voc[:, : SR * 5])

    def test_pitch_track_must_cover_the_song(self):
        with self.assertRaisesRegex(device.Rejected, "frames"):
            self.check(f0=self.f0[:100])


if __name__ == "__main__":
    unittest.main()
