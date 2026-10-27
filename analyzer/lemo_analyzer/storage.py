"""What the server keeps on disk.

Featured songs (analyzer/featured.json) are analysed once and kept forever.
Every other song belongs to the singer's browser, which stores its own copy;
the server only caches those, dropping the least recently used ones past the
size / age limits. A browser re-sends a dropped song when it needs the server
again (key / speed renders, word timing)."""

from __future__ import annotations

import json

import re
import shutil
import threading
import time
import urllib.parse
from pathlib import Path

from .config import CONFIG, ROOT

FEATURED_FILE = ROOT / "featured.json"
_lock = threading.Lock()


def songs_root() -> Path:
    return CONFIG.data_dir / "songs"


# ---- featured songs ---------------------------------------------------------------


def prepare_list() -> list[dict]:
    """Every song in featured.json: the featured ones, and "hidden" ones that are only
    prepared ahead of time (they show up in search and Explore, not on the shelves)."""
    try:
        return json.loads(FEATURED_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        return []


def featured() -> list[dict]:
    return [f for f in prepare_list() if not f.get("hidden")]


def featured_ids() -> set[str]:
    return {f"yt-{f['videoId']}" for f in featured() if f.get("videoId")}


def prepare_ids() -> set[str]:
    return {f"yt-{f['videoId']}" for f in prepare_list() if f.get("videoId")}


def featured_entry(song_id: str) -> dict | None:
    return next((f for f in prepare_list() if f.get("videoId") and f"yt-{f['videoId']}" == song_id), None)


def _norm(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def resolve(title: str, artist: str) -> dict | None:
    """Find the plain studio recording on YouTube Music (an auto-generated "art
    track": just the song — no video intro, dialogue or sound effects)."""
    import yt_dlp

    q = urllib.parse.quote_plus(f"{title} {artist}")
    opts = {"quiet": True, "no_warnings": True}
    with yt_dlp.YoutubeDL({**opts, "extract_flat": True, "playlistend": 5}) as y:
        found = y.extract_info(f"https://music.youtube.com/search?q={q}#songs", download=False)
    for e in (found or {}).get("entries") or []:
        try:
            with yt_dlp.YoutubeDL({**opts, "skip_download": True}) as y:
                m = y.extract_info(f"https://www.youtube.com/watch?v={e['id']}", download=False)
        except Exception:
            continue
        track = m.get("track") or m.get("title") or ""
        artists = m.get("artists") or [m.get("artist") or m.get("creator") or m.get("channel") or ""]
        artists = [a for part in artists for a in str(part).split(",")]
        dur = float(m.get("duration") or 0)
        if (
            _norm(title) in _norm(track)
            and any(_norm(artist) in _norm(a) or (_norm(a) and _norm(a) in _norm(artist)) for a in artists)
            and 90 <= dur <= 600
        ):
            return {"videoId": e["id"], "track": track, "artists": [a.strip() for a in artists], "duration": dur}
    return None


def resolve_featured() -> list[str]:
    """Fill in missing videoIds in featured.json. Returns titles that couldn't be found."""
    with _lock:
        items = prepare_list()
    missing = []
    changed = False
    for f in items:
        if f.get("videoId"):
            continue
        hit = resolve(f["title"], f["artist"])
        if hit:
            f["videoId"] = hit["videoId"]
            changed = True
        else:
            missing.append(f["title"])
    if changed:
        with _lock:
            FEATURED_FILE.write_text("[\n" + ",\n".join("  " + json.dumps(f, ensure_ascii=False) for f in items) + "\n]\n")
    return missing


# ---- cache of everyone else's songs -------------------------------------------------


def touch(song_dir: Path) -> None:
    """Mark a song as just used (it's the last to be dropped)."""
    try:
        (song_dir / ".used").touch()
    except OSError:
        pass


def _last_used(d: Path) -> float:
    return max((p.stat().st_mtime for p in (d / ".used", d / "reference.json") if p.exists()), default=0)


def _size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())


def trim() -> list[str]:
    """Enforce the disk budget. Returns the ids of songs dropped from the cache."""
    with _lock:
        root = songs_root()
        if not root.exists():
            return []
        # Key / speed renders: oldest first, across all songs (they're re-rendered on demand).
        done = (p for p in root.glob("*/variants/*.m4a") if ".tmp" not in p.name)  # never a render in progress
        variants = sorted(done, key=lambda p: p.stat().st_mtime)
        total = sum(p.stat().st_size for p in variants)
        budget = CONFIG.variant_cache_mb * 1024 * 1024
        for p in variants:
            if total <= budget:
                break
            total -= p.stat().st_size
            p.unlink(missing_ok=True)

        from . import remote

        if remote.enabled():
            # this machine is a cache: anything safely on the VPS may go, oldest first
            here = [d for d in root.iterdir() if d.is_dir() and (d / remote.PUSHED).exists()]
            here.sort(key=_last_used)
            total = sum(_size(d) for d in root.iterdir() if d.is_dir())
            dropped = []
            for d in here:
                if total <= CONFIG.local_cache_mb * 1024 * 1024:
                    break
                total -= _size(d)
                shutil.rmtree(d, ignore_errors=True)
                dropped.append(d.name)
            return dropped

        keep = featured_ids()
        songs = [d for d in root.iterdir() if d.is_dir() and d.name not in keep and (d / "reference.json").exists()]
        songs.sort(key=_last_used)
        now = time.time()
        dropped = []
        total = sum(_size(d) for d in songs)
        budget = CONFIG.user_cache_mb * 1024 * 1024
        for d in songs:
            stale = CONFIG.user_keep_days > 0 and now - _last_used(d) > CONFIG.user_keep_days * 86400
            if not stale and total <= budget:
                continue
            total -= _size(d)
            shutil.rmtree(d, ignore_errors=True)
            dropped.append(d.name)
        return dropped


_size_cache = {"at": 0.0, "bytes": 0}


def songs_bytes(max_age: float = 20.0) -> int:
    """Everything lemo stores for songs (audio, analyses, renders) — re-measured at most every 20 s."""
    now = time.time()
    if now - _size_cache["at"] > max_age:
        root = songs_root()
        _size_cache["bytes"] = _size(root) if root.exists() else 0
        _size_cache["at"] = now
    return _size_cache["bytes"]


def limit_bytes() -> int:
    return int(CONFIG.song_limit_gb * 1024**3)


def used_bytes() -> int:
    """Song storage counted against the limit: on the VPS when songs live there, else here."""
    from . import remote

    if remote.enabled():
        return max(remote.usage()["used"], 0)
    return songs_bytes()


def full() -> bool:
    """At the song storage limit: new songs are refused (existing ones keep working). With a
    VPS, also when its disk is nearly full — lemo must never starve the other apps there."""
    from . import remote

    if used_bytes() >= limit_bytes():
        return True
    if remote.enabled():
        free = remote.usage()["free"]
        return free is not None and free < CONFIG.remote_min_free_gb * 1024**3
    return False


def usage() -> dict:
    root = songs_root()
    keep = featured_ids()
    out = {"featuredMb": 0.0, "cachedMb": 0.0}
    if root.exists():
        for d in root.iterdir():
            if d.is_dir():
                out["featuredMb" if d.name in keep else "cachedMb"] += _size(d) / 1048576
    out["cacheLimitMb"] = CONFIG.user_cache_mb
    out["usedMb"] = used_bytes() / 1048576
    out["limitMb"] = limit_bytes() / 1048576
    out["full"] = full()
    return {k: round(v, 1) if isinstance(v, float) and not isinstance(v, bool) else v for k, v in out.items()}


def free_mb() -> float:
    try:
        return shutil.disk_usage(CONFIG.data_dir).free / 1048576
    except OSError:
        return float("inf")


def migrate() -> None:
    """Compress WAV stems left by older versions (one-off, at startup)."""
    from . import audio

    root = songs_root()
    if not root.exists():
        return
    for d in sorted(root.iterdir()):
        if d.is_dir() and (d / "reference.json").exists():
            try:
                audio.compress_stems(d)
            except Exception as e:  # keep the WAVs, try again next start
                print(f"could not compress {d.name}: {e}", flush=True)
    for leftover in root.glob("*/.decode-*"):
        shutil.rmtree(leftover, ignore_errors=True)
