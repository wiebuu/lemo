"""Only Google sign-ins of the configured Firebase project get through."""

import time
import unittest
from dataclasses import replace
from unittest import mock

from lemo_analyzer import auth
from lemo_analyzer.config import CONFIG


def claims(provider="google.com", exp_in=3600):
    return {"uid": "u1", "email": "a@b.c", "exp": time.time() + exp_in, "firebase": {"sign_in_provider": provider}}


class AuthTests(unittest.TestCase):
    def setUp(self):
        auth._cache.clear()
        self.cfg = mock.patch.object(auth, "CONFIG", replace(CONFIG, firebase_project_id="lemo-test"))
        self.cfg.start()

    def tearDown(self):
        self.cfg.stop()

    def test_no_token_is_refused(self):
        with self.assertRaises(auth.AuthError):
            auth.verify(None)
        with self.assertRaises(auth.AuthError):
            auth.verify("Basic abc")

    def test_google_sign_in_passes_and_is_remembered(self):
        with mock.patch("google.oauth2.id_token.verify_firebase_token", return_value=claims()) as v:
            self.assertEqual(auth.verify("Bearer t1")["uid"], "u1")
            auth.verify("Bearer t1")
            self.assertEqual(v.call_count, 1)  # second time from the cache
            self.assertEqual(v.call_args.kwargs["audience"], "lemo-test")

    def test_other_sign_in_methods_are_refused(self):
        for provider in ("password", "anonymous", "phone", "github.com"):
            with mock.patch("google.oauth2.id_token.verify_firebase_token", return_value=claims(provider)):
                with self.assertRaises(auth.AuthError):
                    auth.verify(f"Bearer t-{provider}")

    def test_invalid_token_is_refused(self):
        with mock.patch("google.oauth2.id_token.verify_firebase_token", side_effect=ValueError("Token expired")):
            with self.assertRaises(auth.AuthError):
                auth.verify("Bearer old")

    def test_nothing_works_until_set_up(self):
        with mock.patch.object(auth, "CONFIG", replace(CONFIG, firebase_project_id="")):
            with self.assertRaises(auth.AuthError):
                auth.verify("Bearer t1")


if __name__ == "__main__":
    unittest.main()
