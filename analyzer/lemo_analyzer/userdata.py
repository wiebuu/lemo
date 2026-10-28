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
CREATE TABLE IF NOT EXISTS lemo_requests (
  uid          text NOT NULL REFERENCES lemo_users(uid) ON DELETE CASCADE,
  song_id      text NOT NULL,
  url          text NOT NULL,
  title        text,
  artist       text,
  requested_at double precision NOT NULL,
  done_at      double precision,
  PRIMARY KEY (uid, song_id)
);
-- a link from a site we can't use (Spotify, …): the song it becomes, set when it's added
ALTER TABLE lemo_requests ADD COLUMN IF NOT EXISTS target_id text;
-- today's top: each singer's best take of the day (only the best 100 are kept, with their voice)
CREATE TABLE IF NOT EXISTS lemo_top (
  id         text PRIMARY KEY,
  day        text NOT NULL,
  uid        text NOT NULL REFERENCES lemo_users(uid) ON DELETE CASCADE,
  song_id    text NOT NULL,
  title      text,
  artist     text,
  score      double precision NOT NULL,
  seconds    double precision NOT NULL,
  created_at double precision NOT NULL,
  meta       jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS lemo_top_day_uid ON lemo_top (day, uid);
-- the stats page: tests started / finished and time sung, per day
CREATE TABLE IF NOT EXISTS lemo_daily (
  day      text PRIMARY KEY,
  started  integer NOT NULL DEFAULT 0,
  finished integer NOT NULL DEFAULT 0,
  seconds  double precision NOT NULL DEFAULT 0
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


# ---- songs a singer asked Lemody to add (analysed later, by hand) ------------------------------


def request_song(uid: str, song_id: str, url: str, title: str | None, artist: str | None) -> None:
    _ensure_user(uid)
    _q(
        """INSERT INTO lemo_requests (uid, song_id, url, title, artist, requested_at) VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (uid, song_id) DO UPDATE SET done_at = NULL""",
        (uid, song_id, url, title, artist, time.time()),
    )


def my_requests(uid: str) -> list[dict]:
    rows = _q("SELECT song_id, url, title, artist, requested_at FROM lemo_requests WHERE uid = %s AND done_at IS NULL ORDER BY requested_at DESC", (uid,))
    return [{"songId": r["song_id"], "url": r["url"], "title": r["title"], "artist": r["artist"], "requestedAt": r["requested_at"]} for r in rows]


def cancel_request(uid: str, song_id: str) -> None:
    _q("DELETE FROM lemo_requests WHERE uid = %s AND song_id = %s AND done_at IS NULL", (uid, song_id))


def pending_requests() -> list[dict]:
    """Every song still waiting, most asked-for first."""
    rows = _q(
        """SELECT song_id, MIN(url) AS url, MAX(title) AS title, MAX(artist) AS artist, COUNT(*) AS people,
                  MIN(requested_at) AS first_at, MAX(target_id) AS target_id
           FROM lemo_requests WHERE done_at IS NULL GROUP BY song_id ORDER BY COUNT(*) DESC, MIN(requested_at)""")
    return [{"songId": r["song_id"], "url": r["url"], "title": r["title"], "artist": r["artist"],
             "people": int(r["people"]), "firstAt": r["first_at"],
             # the song it becomes: a YouTube link's own id, or what was picked for another link
             "target": r["target_id"] or (r["song_id"] if r["song_id"].startswith("yt-") else None)} for r in rows]


def set_target(song_id: str, target_id: str) -> int:
    """A request from a site we can't use is added as this song."""
    return _q("UPDATE lemo_requests SET target_id = %s WHERE song_id = %s AND done_at IS NULL", (target_id, song_id))


def deliver(song_id: str, target: str, meta: dict[str, Any]) -> int:
    """The song is ready: it goes into the song list of everyone who asked. Returns how many."""
    rows = _q("SELECT uid FROM lemo_requests WHERE song_id = %s AND done_at IS NULL", (song_id,))
    now = time.time()
    for r in rows:
        save_song(r["uid"], target, {**meta, "addedAt": now * 1000})
    _q("UPDATE lemo_requests SET done_at = %s WHERE song_id = %s AND done_at IS NULL", (now, song_id))
    return len(rows)


# ---- today's top (see top.py) and the stats page --------------------------------------------

TOP_SIZE = 100
# best first; a tie goes to whoever sang it first
_RANKED = "SELECT id, uid, score, created_at, row_number() OVER (ORDER BY score DESC, created_at) AS rank FROM lemo_top WHERE day = %s"


def top_rank(day: str, uid: str, score: float) -> dict:
    """Where this score would land today. Each singer has one place: their best take."""
    mine = _q("SELECT score FROM lemo_top WHERE day = %s AND uid = %s", (day, uid), one=True)
    if mine and mine["score"] >= score:
        return {"rank": None, "reason": "you have a better take today"}
    above = _q("SELECT COUNT(*) AS n FROM lemo_top WHERE day = %s AND uid <> %s AND score >= %s", (day, uid, score), one=True)["n"]
    rank = int(above) + 1
    return {"rank": rank if rank <= TOP_SIZE else None, "reason": None if rank <= TOP_SIZE else "not in the top 100"}


def top_add(entry: dict) -> tuple[int | None, list[str]]:
    """Save a take (replacing the singer's earlier one today). Returns its rank and the ids
    of takes that are no longer kept (their files are deleted by the caller)."""
    _ensure_user(entry["uid"])
    old = _q("SELECT id FROM lemo_top WHERE day = %s AND uid = %s", (entry["day"], entry["uid"]), one=True)
    _q("DELETE FROM lemo_top WHERE day = %s AND uid = %s", (entry["day"], entry["uid"]))
    _q("""INSERT INTO lemo_top (id, day, uid, song_id, title, artist, score, seconds, created_at, meta)
          VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
       (entry["id"], entry["day"], entry["uid"], entry["songId"], entry.get("title"), entry.get("artist"),
        entry["score"], entry["seconds"], time.time(), _json(entry.get("meta") or {})))
    gone = top_prune(entry["day"])
    if old:
        gone.append(old["id"])
    row = _q(f"SELECT rank FROM ({_RANKED}) r WHERE id = %s", (entry["day"], entry["id"]), one=True)
    return (int(row["rank"]) if row else None), gone


def top_prune(day: str) -> list[str]:
    """Only today's best 100 are kept: earlier days and anything below 100th go."""
    rows = _q(f"DELETE FROM lemo_top WHERE day <> %s OR id IN (SELECT id FROM ({_RANKED}) r WHERE rank > {TOP_SIZE}) RETURNING id", (day, day))
    return [r["id"] for r in rows]


def top_ids() -> set[str]:
    return {r["id"] for r in _q("SELECT id FROM lemo_top")}


def top_list(day: str) -> list[dict]:
    rows = _q(f"""SELECT r.rank, t.id, t.uid, t.song_id, t.title, t.artist, t.score, t.seconds, t.created_at, u.name, u.photo
                  FROM ({_RANKED}) r JOIN lemo_top t ON t.id = r.id JOIN lemo_users u ON u.uid = t.uid ORDER BY r.rank""", (day,))
    return [{"rank": int(r["rank"]), "id": r["id"], "uid": r["uid"], "songId": r["song_id"], "title": r["title"], "artist": r["artist"],
             "score": r["score"], "seconds": r["seconds"], "at": r["created_at"], "name": r["name"] or "a singer", "photo": r["photo"]} for r in rows]


def top_get(take_id: str) -> dict | None:
    row = _q(f"""SELECT r.rank, t.*, u.name, u.photo FROM lemo_top t JOIN lemo_users u ON u.uid = t.uid
                 LEFT JOIN ({_RANKED}) r ON r.id = t.id WHERE t.id = %s""", (_today_for(take_id), take_id), one=True)
    if not row:
        return None
    return {"id": row["id"], "rank": int(row["rank"]) if row["rank"] else None, "day": row["day"], "songId": row["song_id"],
            "title": row["title"], "artist": row["artist"], "score": row["score"], "seconds": row["seconds"],
            "name": row["name"] or "a singer", "photo": row["photo"], "meta": row["meta"]}


def _today_for(take_id: str) -> str:
    row = _q("SELECT day FROM lemo_top WHERE id = %s", (take_id,), one=True)
    return row["day"] if row else ""


def count_test(day: str, finished: bool, seconds: float = 0.0) -> None:
    col = "finished" if finished else "started"
    _q(f"""INSERT INTO lemo_daily (day, {col}, seconds) VALUES (%s, 1, %s)
           ON CONFLICT (day) DO UPDATE SET {col} = lemo_daily.{col} + 1, seconds = lemo_daily.seconds + EXCLUDED.seconds""",
       (day, max(0.0, min(seconds, 3600.0))))


def stats(day: str) -> dict:
    users = _q("SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE last_seen > %s) AS today FROM lemo_users", (time.time() - 86400,), one=True)
    tot = _q("SELECT COALESCE(SUM(started), 0) AS started, COALESCE(SUM(finished), 0) AS finished, COALESCE(SUM(seconds), 0) AS seconds FROM lemo_daily", one=True)
    today = _q("SELECT started, finished, seconds FROM lemo_daily WHERE day = %s", (day,), one=True) or {"started": 0, "finished": 0, "seconds": 0}
    return {"singers": int(users["n"]), "singersToday": int(users["today"]),
            "testsStarted": int(tot["started"]), "testsFinished": int(tot["finished"]), "secondsSung": float(tot["seconds"]),
            "today": {"testsStarted": int(today["started"]), "testsFinished": int(today["finished"]), "secondsSung": float(today["seconds"])}}
