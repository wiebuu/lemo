"""Per-user data in local PostgreSQL, tested against a separate lemo_test database
(same server and credentials as DATABASE_URL). Skipped when PostgreSQL isn't running."""

import os
import time
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from lemo_analyzer import auth, server, userdata

TEST_DSN = os.environ.get("DATABASE_URL", "").rsplit("/", 1)[0] + "/lemo_test"


def _reachable() -> bool:
    try:
        import psycopg

        psycopg.connect(TEST_DSN, connect_timeout=3).close()
        return True
    except Exception:
        return False


ALICE = {"uid": "alice", "email": "alice@example.com", "name": "Alice", "exp": time.time() + 3600, "firebase": {"sign_in_provider": "google.com"}}
BOB = {**ALICE, "uid": "bob", "email": "bob@example.com", "name": "Bob"}


@unittest.skipUnless(os.environ.get("DATABASE_URL") and _reachable(), "local PostgreSQL (lemo_test) not available")
class UserDataTests(unittest.TestCase):
    def setUp(self):
        userdata.use(TEST_DSN)
        userdata.status()  # connect + create tables
        userdata._q("TRUNCATE lemo_requests, lemo_prefs, lemo_songs, lemo_users")
        tokens = {"Bearer a": ALICE, "Bearer b": BOB}

        def verify(header):
            if header not in tokens:
                raise auth.AuthError("sign in with Google first")
            return tokens[header]

        self.patch = mock.patch.object(auth, "verify", side_effect=verify)
        self.patch.start()
        self.c = TestClient(server.app)

    def tearDown(self):
        self.patch.stop()
        userdata.use(None)

    def call(self, method, path, who="a", **kw):
        return self.c.request(method, path, headers={"Authorization": f"Bearer {who}"} if who else {}, **kw)

    def test_a_save_before_the_profile_exists_still_works(self):
        r = self.call("PUT", "/api/me/songs/yt-abcdefghijk", json={"title": "First", "addedAt": 1})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.call("GET", "/api/me").json()["songs"][0]["title"], "First")

    def test_needs_sign_in(self):
        self.assertEqual(self.call("GET", "/api/me", who=None).status_code, 401)

    def test_settings_round_trip_and_newer_wins(self):
        self.assertEqual(self.call("GET", "/api/me").json()["settings"], None)
        self.assertTrue(self.call("PUT", "/api/me/settings", json={"settings": {"theme": "ink"}, "updatedAt": 2000}).json()["saved"])
        # an older write (another device that was offline) doesn't overwrite it
        self.assertFalse(self.call("PUT", "/api/me/settings", json={"settings": {"theme": "sage"}, "updatedAt": 1000}).json()["saved"])
        me = self.call("GET", "/api/me").json()
        self.assertEqual(me["settings"], {"theme": "ink"})
        self.assertEqual(me["settingsUpdatedAt"], 2000)

    def test_each_user_only_sees_their_own_data(self):
        self.call("PUT", "/api/me/prefs/yt-abcdefghijk", json={"prefs": {"offsetMs": 40}, "updatedAt": 1})
        self.call("PUT", "/api/me/songs/yt-abcdefghijk", json={"title": "Song", "artist": "A", "duration": 200, "addedAt": 5})
        self.assertEqual(self.call("GET", "/api/me/prefs/yt-abcdefghijk").json()["prefs"], {"offsetMs": 40})
        self.assertEqual(self.call("GET", "/api/me/prefs/yt-abcdefghijk", who="b").status_code, 404)
        self.assertEqual(len(self.call("GET", "/api/me").json()["songs"]), 1)
        self.assertEqual(self.call("GET", "/api/me", who="b").json()["songs"], [])

    def test_prefs_newer_wins(self):
        self.call("PUT", "/api/me/prefs/demo-kettle-morning", json={"prefs": {"offsetMs": 1}, "updatedAt": 10})
        self.assertFalse(self.call("PUT", "/api/me/prefs/demo-kettle-morning", json={"prefs": {"offsetMs": 2}, "updatedAt": 5}).json()["saved"])
        self.assertEqual(self.call("GET", "/api/me/prefs/demo-kettle-morning").json()["prefs"], {"offsetMs": 1})

    def test_removing_a_song_removes_its_data(self):
        self.call("PUT", "/api/me/songs/up-1234567890abcdef", json={"title": "Mine", "addedAt": 1})
        self.call("PUT", "/api/me/prefs/up-1234567890abcdef", json={"prefs": {"x": 1}, "updatedAt": 1})
        self.call("DELETE", "/api/me/songs/up-1234567890abcdef")
        self.assertEqual(self.call("GET", "/api/me").json()["songs"], [])
        self.assertEqual(self.call("GET", "/api/me/prefs/up-1234567890abcdef").status_code, 404)

    def test_requested_song_reaches_everyone_who_asked_when_ready(self):
        url = "https://www.youtube.com/watch?v=AbCdEfGhIjK"
        with mock.patch.object(server, "_oembed", return_value=("Song", "Singer")):
            r = self.call("POST", "/api/requests", data={"url": url})
            self.call("POST", "/api/requests", who="b", data={"url": url})
        self.assertEqual(r.json()["state"], "requested")
        self.assertEqual([x["songId"] for x in self.call("GET", "/api/requests").json()], ["yt-AbCdEfGhIjK"])
        self.assertEqual(userdata.pending_requests()[0]["people"], 2)
        server.deliver_requests()  # not analysed yet: still waiting
        self.assertEqual(len(self.call("GET", "/api/requests").json()), 1)
        with mock.patch.object(server.remote, "has", return_value=True):
            server.deliver_requests()
        for who in ("a", "b"):
            self.assertEqual(self.call("GET", "/api/requests", who=who).json(), [])
            self.assertEqual([s["songId"] for s in self.call("GET", "/api/me", who=who).json()["songs"]], ["yt-AbCdEfGhIjK"])

    def test_a_request_can_be_cancelled(self):
        with mock.patch.object(server, "_oembed", return_value=(None, None)):
            self.call("POST", "/api/requests", data={"url": "https://youtu.be/AbCdEfGhIjK"})
        self.call("DELETE", "/api/requests/yt-AbCdEfGhIjK")
        self.assertEqual(self.call("GET", "/api/requests").json(), [])

    def test_database_down_is_a_clear_error_not_a_crash(self):
        with mock.patch.object(userdata, "pool", side_effect=userdata.Unavailable("database unreachable: test")):
            r = self.call("GET", "/api/me")
        self.assertEqual(r.status_code, 503)
        self.assertIn("unreachable", r.json()["detail"])


if __name__ == "__main__":
    unittest.main()
