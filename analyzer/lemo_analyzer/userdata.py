"""Small per-user data in a local PostgreSQL database (DATABASE_URL): settings, the
list of your songs, and per-song data — lyric edits, breath marks, timing tweaks,
attempt history.

No audio and no song analyses live here (those stay on disk / in the browser).
Every row belongs to one signed-in Google user (Firebase uid); a user can only ever
read or write their own. Newer writes win, by the client's updatedAt."""

from __future__ import annotations

import os
import threading
import time
from typing import Any

from . import config  # noqa: F401  (loads analyzer/.env into the environment)

MAX_DOC_BYTES = 1_000_000  # one song's data — attempts are capped at 200 by the app

SCHEMA = """
CREATE TABLE IF NOT EXISTS lemo_users (
  uid                 text PRIMARY KEY,
  email               text,
  name                text,
  photo               text,
  created_at          double precision NOT NULL,
  last_seen           double precision NOT NULL,
  settings            jsonb,
  settings_updated_at double precision NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lemo_prefs (
  uid        text NOT NULL REFERENCES lemo_users(uid) ON DELETE CASCADE,
  song_id    text NOT NULL,
  prefs      jsonb NOT NULL,
  updated_at double precision NOT NULL,
  PRIMARY KEY (uid, song_id)
);
CREATE TABLE IF NOT EXISTS lemo_songs (
  uid      text NOT NULL REFERENCES lemo_users(uid) ON DELETE CASCADE,
  song_id  text NOT NULL,
  title    text,
  artist   text,
  duration double precision,
  added_at double precision,
  PRIMARY KEY (uid, song_id)
);
"""

_lock = threading.Lock()
_pool = None
_error: str | None = None
_next_try = 0.0
_dsn_override: str | None = None


class Unavailable(Exception):
    pass


def _connect():
    global _pool, _error
    with _lock:
        if _pool is not None:
            return _pool
        dsn = _dsn_override or os.environ.get("DATABASE_URL", "").strip()
        if not dsn:
            _error = "DATABASE_URL is not set in analyzer/.env"
            return None
        try:
            from psycopg_pool import ConnectionPool

            pool = ConnectionPool(dsn, min_size=1, max_size=4, timeout=5, open=False, kwargs={"connect_timeout": 5})
            pool.open(wait=True, timeout=5)
            with pool.connection() as c:
                c.execute(SCHEMA)
            import atexit

            atexit.register(pool.close)  # close cleanly on exit (no shutdown warnings)
            _pool, _error = pool, None
        except Exception as e:  # server not running, wrong password …
            _error = f"database unreachable: {str(e).splitlines()[0][:200]}"
            return None
        return _pool


def use(dsn: str | None) -> None:
    """Tests: point at another database (None: back to DATABASE_URL)."""
    global _pool, _dsn_override, _next_try
    if _pool is not None:
        _pool.close()
    _pool, _dsn_override, _next_try = None, dsn, 0.0


def pool():
    """The connection pool, or Unavailable. After a failed connect it waits a minute
    before trying again, so requests don't each hang on a stopped server."""
    global _next_try
    if _pool is not None:
        return _pool
    now = time.time()
    if now < _next_try:
        raise Unavailable(_error or "database unavailable")
    _next_try = now + 60
    p = _connect()
    if p is None:
        raise Unavailable(_error or "database unavailable")
    return p


def status() -> dict:
    """For /api/health (tries to connect at most once a minute)."""
    try:
        pool()
    except Unavailable:
        pass
    return {"ok": _pool is not None, "error": None if _pool is not None else _error}


def _q(sql: str, args: tuple = (), one: bool = False) -> Any:
    from psycopg.rows import dict_row

    try:
        with pool().connection() as c, c.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, args)
            if cur.description is None:
                return cur.rowcount
            return cur.fetchone() if one else cur.fetchall()
    except Unavailable:
        raise
    except Exception as e:
        import psycopg

        if isinstance(e, psycopg.OperationalError):  # the server went away
            raise Unavailable(f"database unreachable: {str(e).splitlines()[0][:200]}") from e
        raise


def _json(v: Any):
    from psycopg.types.json import Jsonb

    return Jsonb(v)


# ---- users -----------------------------------------------------------------------------


def touch_user(claims: dict) -> dict:
    """Create / refresh the user's profile; returns their stored settings (if any)."""
    uid = claims.get("uid") or claims["user_id"]
    now = time.time()
    row = _q(
        """INSERT INTO lemo_users (uid, email, name, photo, created_at, last_seen) VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (uid) DO UPDATE SET email = COALESCE(EXCLUDED.email, lemo_users.email), name = COALESCE(EXCLUDED.name, lemo_users.name),
             photo = COALESCE(EXCLUDED.photo, lemo_users.photo), last_seen = EXCLUDED.last_seen
           RETURNING settings, settings_updated_at""",
        (uid, claims.get("email"), claims.get("name"), claims.get("picture"), now, now),
        one=True,
    )
    return {"settings": row["settings"], "settingsUpdatedAt": row["settings_updated_at"]}


def _ensure_user(uid: str) -> None:
    """A save can arrive before the profile does (e.g. right at sign-in): make the row first."""
    now = time.time()
    _q("INSERT INTO lemo_users (uid, created_at, last_seen) VALUES (%s, %s, %s) ON CONFLICT (uid) DO NOTHING", (uid, now, now))


def save_settings(uid: str, settings: dict, updated_at: float) -> dict:
    _ensure_user(uid)
    # only if newer than what's stored (another device may have written since)
    n = _q("UPDATE lemo_users SET settings = %s, settings_updated_at = %s WHERE uid = %s AND settings_updated_at < %s",
           (_json(settings), updated_at, uid, updated_at))
    return {"saved": n == 1}


# ---- per-song data -----------------------------------------------------------------------


def get_prefs(uid: str, song_id: str) -> dict | None:
    row = _q("SELECT prefs, updated_at FROM lemo_prefs WHERE uid = %s AND song_id = %s", (uid, song_id), one=True)
    return {"prefs": row["prefs"], "updatedAt": row["updated_at"]} if row else None


def save_prefs(uid: str, song_id: str, prefs: dict, updated_at: float) -> dict:
    _ensure_user(uid)
    n = _q(
        """INSERT INTO lemo_prefs (uid, song_id, prefs, updated_at) VALUES (%s, %s, %s, %s)
           ON CONFLICT (uid, song_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = EXCLUDED.updated_at
           WHERE lemo_prefs.updated_at < EXCLUDED.updated_at""",
        (uid, song_id, _json(prefs), updated_at),
    )
    return {"saved": n == 1}


# ---- your song list (names only — the audio isn't stored here) --------------------------------


def list_songs(uid: str) -> list[dict]:
    rows = _q("SELECT song_id, title, artist, duration, added_at FROM lemo_songs WHERE uid = %s ORDER BY added_at DESC NULLS LAST", (uid,))
    return [{"songId": r["song_id"], "title": r["title"], "artist": r["artist"], "duration": r["duration"], "addedAt": r["added_at"]} for r in rows]


def save_song(uid: str, song_id: str, meta: dict[str, Any]) -> None:
    _ensure_user(uid)
    _q(
        """INSERT INTO lemo_songs (uid, song_id, title, artist, duration, added_at) VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (uid, song_id) DO UPDATE SET title = COALESCE(EXCLUDED.title, lemo_songs.title),
             artist = COALESCE(EXCLUDED.artist, lemo_songs.artist), duration = COALESCE(EXCLUDED.duration, lemo_songs.duration),
             added_at = COALESCE(lemo_songs.added_at, EXCLUDED.added_at)""",
        (uid, song_id, meta.get("title"), meta.get("artist"), meta.get("duration"), meta.get("addedAt")),
    )


def remove_song(uid: str, song_id: str) -> None:
    _q("DELETE FROM lemo_songs WHERE uid = %s AND song_id = %s", (uid, song_id))
    _q("DELETE FROM lemo_prefs WHERE uid = %s AND song_id = %s", (uid, song_id))
