import unittest
from unittest import mock

from lemo_analyzer import links


class LinksTest(unittest.TestCase):
    def test_kinds(self):
        self.assertEqual(links.kind("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing"), "drive")
        self.assertEqual(links.kind("https://www.dropbox.com/scl/fi/abc/song.mp3?rlkey=x&dl=0"), "dropbox")
        self.assertEqual(links.kind("https://1drv.ms/u/s!abc"), "onedrive")
        self.assertEqual(links.kind("https://example.com/music/song.MP3"), "audio")
        self.assertIsNone(links.kind("https://open.spotify.com/track/123"))
        self.assertIsNone(links.kind("https://www.youtube.com/watch?v=abcdefghijk"))
        self.assertIsNone(links.kind("ftp://example.com/song.mp3"))

    def test_share_links_become_downloads(self):
        self.assertEqual(links.direct("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing"),
                         "https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download&confirm=t")
        self.assertIn("dl=1", links.direct("https://www.dropbox.com/scl/fi/abc/song.mp3?rlkey=x&dl=0"))
        self.assertNotIn("dl=0", links.direct("https://www.dropbox.com/scl/fi/abc/song.mp3?rlkey=x&dl=0"))

    def test_never_fetches_the_servers_own_network(self):
        for host in ("127.0.0.1", "10.0.0.5", "169.254.169.254", "localhost"):
            with self.assertRaises(links.LinkError):
                links.download(f"http://{host}/song.mp3", None, 1000)

    def test_a_name_that_resolves_to_a_private_address_is_refused(self):
        with mock.patch("socket.getaddrinfo", return_value=[(0, 0, 0, "", ("192.168.1.2", 0))]):
            with self.assertRaises(links.LinkError):
                links.download("https://evil.example.com/song.mp3", None, 1000)


if __name__ == "__main__":
    unittest.main()
