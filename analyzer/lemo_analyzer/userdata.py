"""Small per-user data in a local PostgreSQL database (DATABASE_URL): settings, the
list of your songs, and per-song data — lyric edits, breath marks, timing tweaks,
attempt history.

No audio and no song analyses live here (those stay on disk / in the browser).
Every row belongs to one signed-in Google user (Firebase uid); a user can only ever
read or write their own. Newer writes win, by the client's updatedAt."""

from __future__ import annotations

import os
import re
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
-- who analysed it on their own device, for everyone who asked (the "coming soon" page)
ALTER TABLE lemo_requests ADD COLUMN IF NOT EXISTS helper_uid text;
-- when Lemody's owner was emailed about it (requests from before this count as told)
ALTER TABLE lemo_requests ADD COLUMN IF NOT EXISTS told_at double precision DEFAULT 0;
ALTER TABLE lemo_requests ALTER COLUMN told_at DROP DEFAULT;
-- today's top: each singer's best take of each song today (only the best 100 are kept, with their voice)
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
-- one place per singer per song (a singer can be on it with several songs)
DROP INDEX IF EXISTS lemo_top_day_uid;
CREATE UNIQUE INDEX IF NOT EXISTS lemo_top_day_uid_song ON lemo_top (day, uid, song_id);
-- the stats page: tests started / finished and time sung, per day
CREATE TABLE IF NOT EXISTS lemo_daily (
  day      text PRIMARY KEY,
  started  integer NOT NULL DEFAULT 0,
  finished integer NOT NULL DEFAULT 0,
  seconds  double precision NOT NULL DEFAULT 0
);
-- songs a singer liked (the "liked" tab)
CREATE TABLE IF NOT EXISTS lemo_likes (
  uid      text NOT NULL REFERENCES lemo_users(uid) ON DELETE CASCADE,
  song_id  text NOT NULL,
  liked_at double precision NOT NULL,
  PRIMARY KEY (uid, song_id)
);
-- tests started / finished on each song (the library's "most sung on Lemody")
-- a singer's name on Lemody (their profile is /u/<username>); unique ignoring case
ALTER TABLE lemo_users ADD COLUMN IF NOT EXISTS username text;
CREATE UNIQUE INDEX IF NOT EXISTS lemo_users_username ON lemo_users (lower(username));
-- every test a signed-in singer starts and finishes (their profile: activity, time sung, history)
CREATE TABLE IF NOT EXISTS lemo_tests (
  id        bigserial PRIMARY KEY,
  uid       text NOT NULL REFERENCES lemo_users(uid) ON DELETE CASCADE,
  day       text NOT NULL,
  at        double precision NOT NULL,
  finished  boolean NOT NULL,
  song_id   text,
  title     text,
  artist    text,
  seconds   double precision NOT NULL DEFAULT 0,
  score     double precision,
  scores    jsonb
);
CREATE INDEX IF NOT EXISTS lemo_tests_uid_at ON lemo_tests (uid, at DESC);
CREATE TABLE IF NOT EXISTS lemo_song_stats (
  song_id  text PRIMARY KEY,
  started  integer NOT NULL DEFAULT 0,
  finished integer NOT NULL DEFAULT 0
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
           RETURNING settings, settings_updated_at, username""",
        (uid, claims.get("email"), claims.get("name"), claims.get("picture"), now, now),
        one=True,
    )
    if row.get("username") is None:
        _give_username(uid, claims.get("email"), claims.get("name"))
    return {"settings": row["settings"], "settingsUpdatedAt": row["settings_updated_at"]}


GUEST = "guest-"  # uid prefix of someone not signed in (their take on today's top)


def _ensure_user(uid: str) -> None:
    """A save can arrive before the profile does (e.g. right at sign-in): make the row first.
    A guest gets a row too (today's top needs one), never counted as a singer."""
    now = time.time()
    _q("INSERT INTO lemo_users (uid, name, created_at, last_seen) VALUES (%s, %s, %s, %s) ON CONFLICT (uid) DO NOTHING",
       (uid, "a guest singer" if uid.startswith(GUEST) else None, now, now))


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


def untold_requests() -> list[dict]:
    """Requests Lemody's owner hasn't been emailed about yet, oldest first, each with who
    asked and how many singers are waiting for that song."""
    rows = _q(
        """SELECT r.uid, r.song_id, r.url, r.title, r.artist, u.name, u.email,
                  (SELECT COUNT(*) FROM lemo_requests w WHERE w.song_id = r.song_id AND w.done_at IS NULL) AS waiting
           FROM lemo_requests r LEFT JOIN lemo_users u ON u.uid = r.uid
           WHERE r.told_at IS NULL ORDER BY r.requested_at""")
    return [{"uid": r["uid"], "songId": r["song_id"], "url": r["url"], "title": r["title"], "artist": r["artist"],
             "name": r["name"], "email": r["email"], "waiting": int(r["waiting"])} for r in rows]


def mark_told(requests: list[dict]) -> None:
    now = time.time()
    for r in requests:
        _q("UPDATE lemo_requests SET told_at = %s WHERE uid = %s AND song_id = %s", (now, r["uid"], r["songId"]))


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


def public_requests(uid: str, since: float) -> dict:
    """The "coming soon" page: every song still waiting (who asked, when), and the ones
    added since `since`."""
    pending = _q(
        """SELECT r.song_id, MIN(r.url) AS url, MAX(r.title) AS title, MAX(r.artist) AS artist, COUNT(*) AS people,
                  MIN(r.requested_at) AS first_at, array_agg(COALESCE(u.name, 'a singer') ORDER BY r.requested_at) AS names,
                  bool_or(r.uid = %s) AS mine
           FROM lemo_requests r JOIN lemo_users u ON u.uid = r.uid
           WHERE r.done_at IS NULL GROUP BY r.song_id ORDER BY COUNT(*) DESC, MIN(r.requested_at)""", (uid,))
    added = _q(
        """SELECT r.song_id, MAX(COALESCE(r.target_id, CASE WHEN r.song_id LIKE 'yt-%%' THEN r.song_id END)) AS target,
                  MAX(r.title) AS title, MAX(r.artist) AS artist, COUNT(*) AS people, MAX(r.done_at) AS done_at,
                  array_agg(COALESCE(u.name, 'a singer') ORDER BY r.requested_at) AS names, MAX(h.name) AS helper
           FROM lemo_requests r JOIN lemo_users u ON u.uid = r.uid LEFT JOIN lemo_users h ON h.uid = r.helper_uid
           WHERE r.done_at > %s GROUP BY r.song_id ORDER BY MAX(r.done_at) DESC""", (since,))
    return {
        "pending": [{"songId": r["song_id"], "url": r["url"], "title": r["title"], "artist": r["artist"], "people": int(r["people"]),
                     "firstAt": r["first_at"], "names": r["names"], "mine": r["mine"]} for r in pending],
        "added": [{"songId": r["song_id"], "target": r["target"], "title": r["title"], "artist": r["artist"], "people": int(r["people"]),
                   "doneAt": r["done_at"], "names": r["names"], "helper": r["helper"]} for r in added],
    }


def fulfil(song_id: str, target_id: str, helper_uid: str) -> int:
    """Someone analysed a requested song on their own device: it becomes this song."""
    return _q("UPDATE lemo_requests SET target_id = %s, helper_uid = %s WHERE song_id = %s AND done_at IS NULL",
              (target_id, helper_uid, song_id))


def set_target(song_id: str, target_id: str) -> int:
    """A request from a site we can't use is added as this song."""
    return _q("UPDATE lemo_requests SET target_id = %s WHERE song_id = %s AND done_at IS NULL", (target_id, song_id))


def deliver(song_id: str, target: str, meta: dict[str, Any]) -> list[dict]:
    """The song is ready: it goes into the song list of everyone who asked. Returns who
    ({uid, email, name}), so they can be told."""
    rows = _q("""SELECT r.uid, u.email, u.name FROM lemo_requests r LEFT JOIN lemo_users u ON u.uid = r.uid
                 WHERE r.song_id = %s AND r.done_at IS NULL""", (song_id,))
    now = time.time()
    for r in rows:
        save_song(r["uid"], target, {**meta, "addedAt": now * 1000})
    _q("UPDATE lemo_requests SET done_at = %s WHERE song_id = %s AND done_at IS NULL", (now, song_id))
    return [{"uid": r["uid"], "email": r["email"], "name": r["name"]} for r in rows]


# ---- today's top (see top.py) and the stats page --------------------------------------------

TOP_SIZE = 100
# best first; a tie goes to whoever sang it first
_RANKED = "SELECT id, uid, score, created_at, row_number() OVER (ORDER BY score DESC, created_at) AS rank FROM lemo_top WHERE day = %s"


def _same_place(uid: str, song_id: str | None) -> tuple[str, tuple]:
    """The take a new one would replace: the singer's take of this song. A guest (known only by
    their address) has one place in all, so nobody can fill the board without signing in."""
    if uid.startswith(GUEST) or not song_id:
        return "uid = %s", (uid,)
    return "uid = %s AND song_id = %s", (uid, song_id)


def top_rank(day: str, uid: str, score: float, song_id: str | None = None) -> dict:
    """Where this score would land today. Each singer has one place per song: their best take
    of it (other songs they sing can be on it too)."""
    where, args = _same_place(uid, song_id)
    mine = _q(f"SELECT score FROM lemo_top WHERE day = %s AND {where} ORDER BY score DESC LIMIT 1", (day, *args), one=True)
    if mine and mine["score"] >= score:
        return {"rank": None, "reason": "you have a better take of this song today"}
    above = _q(f"SELECT COUNT(*) AS n FROM lemo_top WHERE day = %s AND NOT ({where}) AND score >= %s", (day, *args, score), one=True)["n"]
    rank = int(above) + 1
    return {"rank": rank if rank <= TOP_SIZE else None, "reason": None if rank <= TOP_SIZE else "not in the top 100"}


def top_add(entry: dict) -> tuple[int | None, list[str]]:
    """Save a take (replacing the singer's earlier take of this song today). Returns its rank
    and the ids of takes that are no longer kept (their files are deleted by the caller)."""
    _ensure_user(entry["uid"])
    where, args = _same_place(entry["uid"], entry["songId"])
    old = _q(f"DELETE FROM lemo_top WHERE day = %s AND {where} RETURNING id", (entry["day"], *args))
    _q("""INSERT INTO lemo_top (id, day, uid, song_id, title, artist, score, seconds, created_at, meta)
          VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
       (entry["id"], entry["day"], entry["uid"], entry["songId"], entry.get("title"), entry.get("artist"),
        entry["score"], entry["seconds"], time.time(), _json(entry.get("meta") or {})))
    gone = top_prune(entry["day"]) + [r["id"] for r in old]
    row = _q(f"SELECT rank FROM ({_RANKED}) r WHERE id = %s", (entry["day"], entry["id"]), one=True)
    return (int(row["rank"]) if row else None), gone


def top_prune(day: str) -> list[str]:
    """Only today's best 100 are kept: earlier days and anything below 100th go."""
    rows = _q(f"DELETE FROM lemo_top WHERE day <> %s OR id IN (SELECT id FROM ({_RANKED}) r WHERE rank > {TOP_SIZE}) RETURNING id", (day, day))
    return [r["id"] for r in rows]


def top_ids() -> set[str]:
    return {r["id"] for r in _q("SELECT id FROM lemo_top")}


def top_list(day: str) -> list[dict]:
    rows = _q(f"""SELECT r.rank, t.id, t.uid, t.song_id, t.title, t.artist, t.score, t.seconds, t.created_at, u.name, u.photo,
                         (t.meta->>'toleranceCents')::int AS tolerance, t.meta->>'scoringMode' AS mode
                  FROM ({_RANKED}) r JOIN lemo_top t ON t.id = r.id JOIN lemo_users u ON u.uid = t.uid ORDER BY r.rank""", (day,))
    return [{"rank": int(r["rank"]), "id": r["id"], "uid": r["uid"], "songId": r["song_id"], "title": r["title"], "artist": r["artist"],
             "score": r["score"], "seconds": r["seconds"], "at": r["created_at"], "name": r["name"] or "a singer", "photo": r["photo"],
             "toleranceCents": r["tolerance"], "scoringMode": r["mode"]} for r in rows]


def top_get(take_id: str) -> dict | None:
    row = _q(f"""SELECT r.rank, t.*, u.name, u.photo FROM lemo_top t JOIN lemo_users u ON u.uid = t.uid
                 LEFT JOIN ({_RANKED}) r ON r.id = t.id WHERE t.id = %s""", (_today_for(take_id), take_id), one=True)
    if not row:
        return None
    return {"id": row["id"], "rank": int(row["rank"]) if row["rank"] else None, "day": row["day"], "songId": row["song_id"],
            "title": row["title"], "artist": row["artist"], "score": row["score"], "seconds": row["seconds"],
            "name": row["name"] or "a singer", "photo": row["photo"], "meta": row["meta"]}


def top_owner(take_id: str) -> str | None:
    row = _q("SELECT uid FROM lemo_top WHERE id = %s", (take_id,), one=True)
    return row["uid"] if row else None


def _today_for(take_id: str) -> str:
    row = _q("SELECT day FROM lemo_top WHERE id = %s", (take_id,), one=True)
    return row["day"] if row else ""


def count_test(day: str, finished: bool, seconds: float = 0.0, song_id: str | None = None) -> None:
    col = "finished" if finished else "started"
    _q(f"""INSERT INTO lemo_daily (day, {col}, seconds) VALUES (%s, 1, %s)
           ON CONFLICT (day) DO UPDATE SET {col} = lemo_daily.{col} + 1, seconds = lemo_daily.seconds + EXCLUDED.seconds""",
       (day, max(0.0, min(seconds, 3600.0))))
    if song_id:
        _q(f"""INSERT INTO lemo_song_stats (song_id, {col}) VALUES (%s, 1)
               ON CONFLICT (song_id) DO UPDATE SET {col} = lemo_song_stats.{col} + 1""", (song_id,))


_sung: dict = {"at": 0.0, "by": {}}


def tests_started(max_age: float = 60) -> dict[str, int]:
    """Tests started on each song, {song_id: n}: one query, kept for a minute (the library
    asks for every song at once)."""
    if time.time() - _sung["at"] > max_age:
        _sung["by"] = {r["song_id"]: int(r["started"]) for r in _q("SELECT song_id, started FROM lemo_song_stats WHERE started > 0")}
        _sung["at"] = time.time()
    return _sung["by"]


# ---- liked songs ---------------------------------------------------------------------------------


def list_likes(uid: str) -> list[str]:
    """Song ids you liked, the newest first."""
    return [r["song_id"] for r in _q("SELECT song_id FROM lemo_likes WHERE uid = %s ORDER BY liked_at DESC", (uid,))]


def like(uid: str, song_id: str) -> None:
    _ensure_user(uid)
    _q("INSERT INTO lemo_likes (uid, song_id, liked_at) VALUES (%s, %s, %s) ON CONFLICT (uid, song_id) DO NOTHING",
       (uid, song_id, time.time()))


def unlike(uid: str, song_id: str) -> None:
    _q("DELETE FROM lemo_likes WHERE uid = %s AND song_id = %s", (uid, song_id))


def stats(day: str) -> dict:
    users = _q("SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE last_seen > %s) AS today FROM lemo_users WHERE uid NOT LIKE %s",
               (time.time() - 86400, GUEST + "%"), one=True)
    tot = _q("SELECT COALESCE(SUM(started), 0) AS started, COALESCE(SUM(finished), 0) AS finished, COALESCE(SUM(seconds), 0) AS seconds FROM lemo_daily", one=True)
    today = _q("SELECT started, finished, seconds FROM lemo_daily WHERE day = %s", (day,), one=True) or {"started": 0, "finished": 0, "seconds": 0}
    return {"singers": int(users["n"]), "singersToday": int(users["today"]),
            "testsStarted": int(tot["started"]), "testsFinished": int(tot["finished"]), "secondsSung": float(tot["seconds"]),
            "today": {"testsStarted": int(today["started"]), "testsFinished": int(today["finished"]), "secondsSung": float(today["seconds"])}}


# ---- profiles: usernames, tests, activity --------------------------------------------------------

USERNAME = re.compile(r"^[A-Za-z0-9_.-]{3,20}$")
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _base_username(email: str | None, name: str | None) -> str:
    """The first name a singer gets: their Gmail name (before the @), tidied to the allowed letters."""
    raw = (email or "").split("@")[0] or (name or "")
    base = re.sub(r"[^A-Za-z0-9_.-]+", "", raw.replace(" ", "_"))[:20].strip("._-")
    return base if len(base) >= 3 else (base + "singer")[:20]


def _give_username(uid: str, email: str | None, name: str | None) -> str | None:
    if uid.startswith(GUEST):
        return None
    base = _base_username(email, name)
    for k in range(50):
        cand = base if k == 0 else f"{base[:20 - len(str(k))]}{k}"
        try:
            n = _q("UPDATE lemo_users SET username = %s WHERE uid = %s AND username IS NULL", (cand, uid))
            return cand if n else None
        except Exception as e:  # taken (unique index): try the next number
            if "lemo_users_username" not in str(e):
                raise
    return None


def username_of(uid: str) -> str | None:
    row = _q("SELECT username FROM lemo_users WHERE uid = %s", (uid,), one=True)
    return row["username"] if row else None


def set_username(uid: str, name: str) -> str:
    """Change your username. Raises ValueError with the reason when it can't be used."""
    name = name.strip()
    if not USERNAME.match(name):
        raise ValueError("3 to 20 letters, numbers, dots, dashes or underscores")
    row = _q("SELECT uid FROM lemo_users WHERE lower(username) = lower(%s)", (name,), one=True)
    if row and row["uid"] != uid:
        raise ValueError("that name is taken")
    _ensure_user(uid)
    _q("UPDATE lemo_users SET username = %s WHERE uid = %s", (name, uid))
    return name


def log_test(uid: str, entry: dict) -> None:
    """One test started or finished, for the singer's own profile."""
    if uid.startswith(GUEST):
        return
    _ensure_user(uid)
    _q("""INSERT INTO lemo_tests (uid, day, at, finished, song_id, title, artist, seconds, score, scores)
          VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
       (uid, entry["day"], time.time(), entry["finished"], entry.get("songId"), entry.get("title"), entry.get("artist"),
        entry.get("seconds") or 0.0, entry.get("score"), _json(entry["scores"]) if entry.get("scores") else None))


def _days(uid: str) -> list[dict]:
    """Each day the singer sang in the last year: tests finished and seconds sung."""
    rows = _q("""SELECT day, COUNT(*) FILTER (WHERE finished) AS tests, COALESCE(SUM(seconds), 0) AS seconds
                 FROM lemo_tests WHERE uid = %s AND at > %s GROUP BY day ORDER BY day""",
              (uid, time.time() - 400 * 86400))
    return [{"day": r["day"], "tests": int(r["tests"]), "seconds": round(float(r["seconds"]), 1)} for r in rows]


def profile(uid: str) -> dict:
    """Your own profile: name, totals, activity and every finished test (newest first)."""
    u = _q("SELECT username, name, photo, created_at FROM lemo_users WHERE uid = %s", (uid,), one=True) or {}
    tot = _q("""SELECT COUNT(*) FILTER (WHERE NOT finished) AS started, COUNT(*) FILTER (WHERE finished) AS finished,
                       COALESCE(SUM(seconds), 0) AS seconds, AVG(score) FILTER (WHERE finished) AS avg
                FROM lemo_tests WHERE uid = %s""", (uid,), one=True)
    hist = _q("""SELECT id, day, at, song_id, title, artist, seconds, score, scores FROM lemo_tests
                 WHERE uid = %s AND finished ORDER BY at DESC LIMIT 1000""", (uid,))
    return {
        "username": u.get("username"), "photo": u.get("photo"), "joined": u.get("created_at"),
        "testsStarted": int(tot["started"]), "testsFinished": int(tot["finished"]), "seconds": float(tot["seconds"]),
        "average": float(tot["avg"]) if tot["avg"] is not None else None,
        "days": _days(uid),
        "history": [{"id": r["id"], "day": r["day"], "at": r["at"], "songId": r["song_id"], "title": r["title"], "artist": r["artist"],
                     "seconds": r["seconds"], "score": r["score"], "scores": r["scores"]} for r in hist],
    }


def public_profile(username: str) -> dict | None:
    """What anyone can see of a singer: their name, picture, when they joined and the days they sang."""
    u = _q("SELECT uid, username, photo, created_at FROM lemo_users WHERE lower(username) = lower(%s)", (username,), one=True)
    if not u:
        return None
    return {"username": u["username"], "photo": u["photo"], "joined": u["created_at"], "days": _days(u["uid"])}


def find_users(q: str, limit: int = 10) -> list[dict]:
    """Singers whose name has q in it (names that start with it first)."""
    q = re.sub(r"[^A-Za-z0-9_.-]+", "", q)[:20]
    if not q:
        return []
    like = "%" + q.replace("_", "\\_").replace("%", "") + "%"
    rows = _q("""SELECT username, photo FROM lemo_users WHERE username ILIKE %s
                 ORDER BY (lower(username) LIKE lower(%s)) DESC, last_seen DESC LIMIT %s""",
              (like, q.replace("_", "\\_") + "%", limit))
    return [{"username": r["username"], "photo": r["photo"]} for r in rows]


def backfill_tests() -> int:
    """Once: earlier finished tests (kept per song in the singer's data) into their history.
    How long each one was isn't known, so those count no time sung."""
    from datetime import datetime, timezone

    n = 0
    rows = _q("""SELECT p.uid, p.song_id, p.prefs, s.title, s.artist FROM lemo_prefs p
                 LEFT JOIN lemo_songs s ON s.uid = p.uid AND s.song_id = p.song_id
                 WHERE NOT EXISTS (SELECT 1 FROM lemo_tests t WHERE t.uid = p.uid)""")
    for r in rows:
        if r["uid"].startswith(GUEST):
            continue
        for a in (r["prefs"] or {}).get("attempts") or []:
            sc = a.get("scores") or {}
            at = a.get("at")
            if a.get("phrase") is not None or not isinstance(at, (int, float)) or sc.get("overall") is None:
                continue
            t = at / 1000
            _q("""INSERT INTO lemo_tests (uid, day, at, finished, song_id, title, artist, seconds, score, scores)
                  VALUES (%s, %s, %s, true, %s, %s, %s, 0, %s, %s)""",
               (r["uid"], datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d"), t, r["song_id"], r["title"], r["artist"],
                sc["overall"], _json(sc)))
            n += 1
    return n
