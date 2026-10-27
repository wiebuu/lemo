"""Only signed-in Google users may use the analyzer.

The web app sends the user's Firebase ID token with every request. It's checked
against Google's public keys (signature, expiry, issuer and audience = this
Firebase project) and must come from a Google sign-in — any other Firebase sign-in
method is refused. Verified tokens are remembered until they expire, so Google's
keys aren't fetched on every request."""

from __future__ import annotations

import threading
import time

from .config import CONFIG

_cache: dict[str, dict] = {}
_lock = threading.Lock()
_request = None


class AuthError(Exception):
    pass


def configured() -> bool:
    return bool(CONFIG.firebase_project_id)


def verify(header: str | None) -> dict:
    """The token's claims (uid, email …) or AuthError."""
    if not configured():
        raise AuthError("sign-in isn't set up on the analyzer: set LEMO_FIREBASE_PROJECT_ID in analyzer/.env")
    if not header or not header.startswith("Bearer "):
        raise AuthError("sign in with Google first")
    token = header[7:].strip()
    now = time.time()
    with _lock:
        hit = _cache.get(token)
    if hit and hit["exp"] > now + 5:
        return hit

    global _request
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    if _request is None:
        _request = google_requests.Request()
    try:
        claims = id_token.verify_firebase_token(token, _request, audience=CONFIG.firebase_project_id)
    except Exception as e:  # bad signature, expired, wrong project …
        raise AuthError(f"sign-in not valid ({e})") from e
    if not claims or (claims.get("firebase") or {}).get("sign_in_provider") != "google.com":
        raise AuthError("only Google sign-in is allowed")
    with _lock:
        if len(_cache) > 500:
            for k, v in list(_cache.items()):
                if v["exp"] <= now:
                    _cache.pop(k, None)
        _cache[token] = claims
    return claims
