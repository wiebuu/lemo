"""Every stored song, for search: id, title, singer, length — and its 10-second preview.

Kept in data/catalog.json, so songs that now live only on the VPS stay searchable
without fetching them back. Updated when a song is analysed or deleted; rebuilt from
the songs on this machine at startup (VPS-only entries are kept)."""

from __future__ import annotations

import json
import subprocess
import threading
import time
from pathlib import Path

from . import storage
from .config import CONFIG, FFMPEG

_lock = threading.Lock()
PREVIEW = "preview.m4a"
PREVIEW_SECONDS = 10.0


def _file() -> Path:
    return CONFIG.data_dir / "catalog.json"


def load() -> dict[str, dict]:
    try:
        return json.loads(_file().read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def _save(cat: dict) -> None:
    tmp = _file().with_suffix(".tmp")
    tmp.write_text(json.dumps(cat, ensure_ascii=False))
    tmp.replace(_file())


def entry(song_dir: Path) -> dict | None:
    """Catalog entry from a song's analysis (featured songs use their clean names)."""
    try:
        ref = json.loads((song_dir / "reference.json").read_text())
    except (OSError, json.JSONDecodeError):
        return None
    sid = song_dir.name
    feat = storage.featured_entry(sid)
    return {
        "id": sid,
        "title": (feat or {}).get("title") or ref.get("title") or sid,
        "artist": (feat or {}).get("artist") or ref.get("artist"),
        "duration": ref.get("duration"),
        "lang": (feat or {}).get("lang"),
        "featured": feat is not None and not feat.get("hidden"),
        "addedAt": ref.get("createdAt") or int(time.time()),
        "preview": (song_dir / PREVIEW).exists(),
    }


def add(song_dir: Path) -> None:
    e = entry(song_dir)
    if not e:
        return
    with _lock:
        cat = load()
        cat[e["id"]] = {**cat.get(e["id"], {}), **e}  # keeps its play count
        _save(cat)


def remove(song_id: str) -> None:
    with _lock:
        cat = load()
        if cat.pop(song_id, None) is not None:
            _save(cat)


def rebuild() -> None:
    """Refresh entries for songs on this machine; keep the ones that live only on the VPS."""
    with _lock:
        cat = load()
        for ref in storage.songs_root().glob("*/reference.json") if storage.songs_root().exists() else []:
            e = entry(ref.parent)
            if e:
                cat[e["id"]] = {**cat.get(e["id"], {}), **e}
        _save(cat)


_last_play: dict[tuple[str, str], float] = {}
PLAY_GAP = 600  # one person's plays of one song count once per 10 minutes


def played(song_id: str, who: str) -> int | None:
    """Someone finished a test on this song (they got a result): one more play.
    Returns the new count, or None if it wasn't counted (unknown song, or too soon)."""
    now = time.time()
    with _lock:
        if now - _last_play.get((song_id, who), 0) < PLAY_GAP:
            return None
        cat = load()
        e = cat.get(song_id)
        if not e:
            return None
        e["plays"] = int(e.get("plays") or 0) + 1
        _save(cat)
        _last_play[(song_id, who)] = now
        return e["plays"]


def all_songs() -> list[dict]:
    return sorted(load().values(), key=lambda e: (not e.get("featured"), -(e.get("addedAt") or 0)))


# ---- 10-second preview -------------------------------------------------------------------


def preview_start(ref: dict, length: float = PREVIEW_SECONDS) -> float:
    """Where the preview starts: the 10 s with the most (and loudest) singing — usually the chorus."""
    notes = [n for n in ref.get("notes", []) if n.get("sung", True) and not n.get("offLyrics")]
    if not notes:
        return min(30.0, max(0.0, (ref.get("duration") or 0) * 0.3))
    louds = [n["loudness"] for n in notes if n.get("loudness") is not None]
    floor = min(louds) if louds else 0.0
    weight = lambda n: (n["endTime"] - n["startTime"]) * (1.0 + max(0.0, (n.get("loudness", floor) - floor)) / 6)  # noqa: E731
    best, best_t = -1.0, notes[0]["startTime"]
    for n in notes:
        t0 = n["startTime"] - 0.4  # a breath before the phrase
        score = sum(weight(m) for m in notes if m["startTime"] >= t0 and m["endTime"] <= t0 + length)
        if score > best:
            best, best_t = score, t0
    return max(0.0, min(best_t, (ref.get("duration") or length) - length))


def make_preview(song_dir: Path) -> bool:
    """music + vocal mixed, 10 s, faded in and out — about 150 KB."""
    from . import audio

    out = song_dir / PREVIEW
    if out.exists():
        return True
    if not FFMPEG:
        return False
    try:
        ref = json.loads((song_dir / "reference.json").read_text())
    except (OSError, json.JSONDecodeError):
        return False
    backing, vocals = audio.stem_file(song_dir, "backing"), audio.stem_file(song_dir, "vocals")
    if not backing or not vocals:
        return False
    start = preview_start(ref)
    tmp = song_dir / "preview.tmp.m4a"
    L = PREVIEW_SECONDS
    cmd = [
        FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{start:.2f}", "-t", f"{L}", "-i", str(backing),
        "-ss", f"{start:.2f}", "-t", f"{L}", "-i", str(vocals),
        "-filter_complex",
        f"[1:a]aformat=channel_layouts=stereo[v];[0:a][v]amix=inputs=2:normalize=0,"
        f"afade=t=in:d=0.3,afade=t=out:st={L - 0.8}:d=0.8,volume=0.9[out]",
        "-map", "[out]", "-c:a", "aac", "-b:a", "112k", "-movflags", "+faststart", str(tmp),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        return False
    tmp.replace(out)
    return True


def is_public(song_id: str) -> bool:
    """Only YouTube songs are searchable — a file someone uploaded stays theirs."""
    return song_id.startswith("yt-")


def finish(song_dir: Path) -> None:
    """A song was just analysed: make its preview and list it."""
    try:
        make_preview(song_dir)
    except Exception as e:  # a missing preview never fails the song
        print(f"no preview for {song_dir.name}: {e}", flush=True)
    add(song_dir)


def backfill() -> None:
    """Startup: every stored song gets a preview and a catalog entry — including songs
    that now live only on the VPS (fetched back once for this)."""
    from . import remote

    rebuild()
    root = storage.songs_root()
    local = {r.parent.name for r in root.glob("*/reference.json")} if root.exists() else set()
    known = load()
    for sid in sorted(local | remote.index()):
        d = root / sid
        if sid in known and (sid not in local or (d / PREVIEW).exists()):
            continue  # already listed (a song only on the VPS isn't fetched back again)
        if sid not in local and not remote.pull(d):
            continue
        made = not (d / PREVIEW).exists() and make_preview(d)
        add(d)
        if made and (d / remote.PUSHED).exists():
            remote.push(d)  # rsync sends only the new preview
