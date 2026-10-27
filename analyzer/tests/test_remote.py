"""Song files on the VPS: signed links nginx accepts, and the limit counting VPS space."""

import base64
import hashlib
import time
import unittest
from dataclasses import replace
from unittest import mock
from urllib.parse import parse_qs, urlparse

from lemo_analyzer import remote, storage
from lemo_analyzer.config import CONFIG

CFG = replace(
    CONFIG,
    remote_store="me@vps:/var/www/lemo-songs",
    remote_url="https://api.example.com/lemo-songs",
    remote_secret="s3cret",
    remote_min_free_gb=1.5,
    song_limit_gb=10,
)


class RemoteTests(unittest.TestCase):
    def setUp(self):
        self.patches = [mock.patch.object(remote, "CONFIG", CFG), mock.patch.object(storage, "CONFIG", CFG)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_signed_link_matches_nginx_secure_link_md5(self):
        url = remote.signed_url("yt-abcdefghijk", "backing.m4a", ttl=60)
        u = urlparse(url)
        self.assertEqual(u.path, "/lemo-songs/yt-abcdefghijk/backing.m4a")
        q = parse_qs(u.query)
        e = q["e"][0]
        # nginx: secure_link_md5 "$secure_link_expires$uri SECRET" → base64url(md5), no padding
        want = base64.urlsafe_b64encode(hashlib.md5(f"{e}{u.path} s3cret".encode()).digest()).decode().rstrip("=")
        self.assertEqual(q["s"][0], want)
        self.assertGreater(int(e), time.time())

    def test_limit_counts_space_on_the_vps(self):
        with mock.patch.object(remote, "usage", return_value={"used": 11 * 1024**3, "free": 5 * 1024**3}):
            self.assertTrue(storage.full())
        with mock.patch.object(remote, "usage", return_value={"used": 2 * 1024**3, "free": 5 * 1024**3}):
            self.assertFalse(storage.full())

    def test_never_fills_the_vps_disk(self):
        # well under 10 GB for lemo, but the server itself is nearly out of space
        with mock.patch.object(remote, "usage", return_value={"used": 1 * 1024**3, "free": 1 * 1024**3}):
            self.assertTrue(storage.full())


if __name__ == "__main__":
    unittest.main()
