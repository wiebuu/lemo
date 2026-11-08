"""How famous each song is outside Lemody: its YouTube view count, refreshed once a week.

Never looked up while someone is browsing. The machine that analyses songs (YouTube on)
reads every song's views in the background once a week and stores them as one snapshot,
data/popularity/<year>-W<week>.json; only the newest snapshot is kept. It's copied to the
VPS (remote.push_popularity), whose API serves the numbers from it (kept in memory).

Spotify is left out: its play counts aren't in the free Web API (only a 0–100
"popularity"), and reading them off its own app needs an unofficial token.

Run once by hand:  python -m lemo_analyzer.popularity [--no-push]"""

from __future__ import annotations

import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from .config import CONFIG

WEEK = 7 * 86400
WORKERS = 3  # gentle on YouTube: ~700 songs take 10–15 minutes
STALE_RUN_ANYWAY = 6 * 3600  # waits for the analyzer to be idle, but not longer than this


def snap_dir() -> Path:
    return CONFIG.data_dir / "popularity"


def week_of(t: float) -> str:
    y, w, _ = datetime.fromtimestamp(t, timezone.utc).isocalendar()
    return f"{y}-W{w:02d}"


def _dirs() -> list[Path]:
    """Where snapshots can be: this machine's, and on the VPS the copy pushed into the
    song store (when the store is on this machine)."""
    out = [snap_dir()]
    if CONFIG.remote_store and ":" not in CONFIG.remote_store:
        out.append(Path(CONFIG.remote_store) / "_popularity")
    return out


def snapshots(d: Path | None = None) -> list[Path]:
    """Snapshot files, the oldest first (names sort by week)."""
    dirs = [d] if d else _dirs()
    return sorted((p for x in dirs if x.exists() for p in x.glob("*-W*.json")), key=lambda p: p.name)


def save(songs: dict[str, dict], now: float | None = None, d: Path | None = None) -> Path:
    """Store this week's snapshot and delete every older one."""
    now = time.time() if now is None else now
    d = d or snap_dir()
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{week_of(now)}.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"week": week_of(now), "at": now, "sources": ["youtube"], "songs": songs}, separators=(",", ":")))
    tmp.replace(path)
    for old in snapshots(d):
        if old != path:
            old.unlink(missing_ok=True)
    _cache["key"] = None
    return path


_cache: dict = {"key": None, "checked": 0.0, "snap": None}


def latest(max_age: float = 60) -> dict | None:
    """The newest snapshot, read once and kept in memory (the folder is looked at again at
    most once a minute; the file is only re-read when it changed)."""
    if time.time() - _cache["checked"] < max_age and _cache["key"] is not None:
        return _cache["snap"]
    _cache["checked"] = time.time()
    snaps = snapshots()
    if not snaps:
        _cache.update(key=(), snap=None)
        return None
    newest = max(snaps, key=lambda p: (p.name, p.stat().st_mtime))
    key = (str(newest), newest.stat().st_mtime)
    if key != _cache["key"]:
        try:
            _cache.update(key=key, snap=json.loads(newest.read_text()))
        except (OSError, json.JSONDecodeError):
            _cache.update(key=key, snap=None)
    return _cache["snap"]


def views(song_id: str) -> int | None:
    s = latest()
    return ((s or {}).get("songs", {}).get(song_id) or {}).get("youtube")


def due(now: float | None = None) -> bool:
    now = time.time() if now is None else now
    s = latest(max_age=0)
    return not s or now - float(s.get("at") or 0) >= WEEK


# ---- reading the counts (the weekly job only) ------------------------------------------------


_local = threading.local()


def youtube_views(video_id: str) -> int | None:
    """A video's view count from its page (yt-dlp, metadata only: nothing is downloaded,
    and the player's code isn't fetched). One yt-dlp per worker thread, reused."""
    import yt_dlp

    if not hasattr(_local, "ydl"):
        _local.ydl = yt_dlp.YoutubeDL({
            "quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True, "socket_timeout": 20,
            "extractor_args": {"youtube": {"player_skip": ["js", "configs"], "player_client": ["web"]}},
        })
    try:
        meta = _local.ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False, process=False)
    except Exception:
        return None
    n = (meta or {}).get("view_count")
    return int(n) if isinstance(n, (int, float)) else None


def song_ids() -> list[str]:
    """Every YouTube song: the ones in featured.json (ready or not) and every stored one."""
    from . import catalog, storage

    ids = {f"yt-{f['videoId']}" for f in storage.prepare_list() if f.get("videoId")}
    ids |= {e["id"] for e in catalog.all_songs() if e["id"].startswith("yt-")}
    return sorted(ids)


def refresh(push: bool = True, ids: list[str] | None = None, log=print) -> Path:
    """Read every song's views and store the snapshot. A song whose page can't be read
    keeps last week's number."""
    ids = song_ids() if ids is None else ids
    before = (latest(max_age=0) or {}).get("songs", {})
    t0 = time.time()
    with ThreadPoolExecutor(WORKERS) as pool:
        counts = dict(zip(ids, pool.map(lambda sid: youtube_views(sid[3:]), ids)))
    songs: dict[str, dict] = {}
    for sid, n in counts.items():
        if n is not None:
            songs[sid] = {"youtube": n}
        elif sid in before:
            songs[sid] = before[sid]
    path = save(songs)
    got = sum(n is not None for n in counts.values())
    log(f"play counts: {got}/{len(ids)} songs read from YouTube in {time.time() - t0:.0f} s → {path.name}")
    if push:
        from . import remote

        remote.push_popularity(snap_dir())
    return path


def keep_fresh(idle) -> None:
    """Background: refresh once a week, when `idle()` says the analyzer isn't busy (or
    once it's been due for 6 hours anyway: reading views is light)."""
    def loop() -> None:
        due_since = None
        while True:
            try:
                if due():
                    due_since = due_since or time.time()
                    if idle() or time.time() - due_since > STALE_RUN_ANYWAY:
                        from . import worker

                        refresh(log=worker.log)
                        due_since = None
                else:
                    due_since = None
            except Exception as e:
                print(f"could not refresh the play counts: {e}", flush=True)
            time.sleep(600)

    threading.Thread(target=loop, daemon=True, name="lemo-popularity").start()


if __name__ == "__main__":
    refresh(push="--no-push" not in sys.argv)
