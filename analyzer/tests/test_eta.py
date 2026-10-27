"""Time-left estimates for an analysis."""

import json
import tempfile
import time
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

from lemo_analyzer import jobs
from lemo_analyzer.config import CONFIG


class EtaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.p = mock.patch.object(jobs, "CONFIG", replace(CONFIG, data_dir=Path(self.tmp.name)))
        self.p.start()

    def tearDown(self):
        self.p.stop()
        self.tmp.cleanup()

    def test_a_four_minute_song_is_about_six_minutes(self):
        total = jobs.estimate_total(240)
        self.assertGreater(total, 5 * 60)
        self.assertLess(total, 7 * 60)

    def test_time_left_shrinks_and_progress_is_time_based(self):
        j = jobs.Job(id="x", stage="melody", duration=200)
        j.started = time.time() - 100
        j.stage_started = time.time() - 50
        j.update_eta(0.25)
        # 50 s in and a quarter done → the stage looks like ~200 s; blended with the plan
        self.assertGreater(j.eta, 100)
        self.assertLess(j.eta, 250)
        self.assertAlmostEqual(j.progress, 100 / (100 + j.eta), places=2)

    def test_learns_from_finished_songs(self):
        before = jobs.rates()["melody"]
        jobs.learn({"melody": 400.0}, 200.0)  # this machine: 2 s per second of audio
        after = jobs.rates()["melody"]
        self.assertGreater(after, before)
        self.assertTrue(json.loads((Path(self.tmp.name) / "timing.json").read_text())["melody"] > before)


if __name__ == "__main__":
    unittest.main()
