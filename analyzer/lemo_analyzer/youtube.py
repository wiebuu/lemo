"""YouTube audio import via yt-dlp — personal use, opt-in (LEMO_ENABLE_YOUTUBE).

Only ordinary public videos: no DRM circumvention, no playlists, no live
streams. Audio stays in the local cache."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Callable

VIDEO_ID = re.compile(
    r"^(?:https?://)?(?:(?:www|m|music)\.)?"
    r"(?:youtube\.com/(?:watch\?(?:[^#]*&)?v=|shorts/|live/|embed/)|youtu\.be/)"
    r"([A-Za-z0-9_-]{11})(?:[?&#/].*)?$"
)

_NOISE = re.compile(
    r"\s*[\(\[][^\)\]]*(official|video|audio|lyrics?|visuali[sz]er|hd|4k|mv|remaster(ed)?|live)[^\)\]]*[\)\]]",
    re.I,
)


def video_id(url: str) -> str | None:
    m = VIDEO_ID.match(url.strip())
    return m.group(1) if m else None


def available() -> tuple[bool, str | None]:
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        return False, "yt-dlp is not installed in the analyzer venv (pip install yt-dlp)."
    return True, None


def _key(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _tidy_name(s: str, person: bool = True) -> str:
    """'AP DHILLON | SHINDA KAHLON' → 'AP Dhillon'; all-caps words get normal case (in a
    singer's name short ones like AP, DJ stay as they are)."""
    first = re.split(r"\s*(?:\||,|&| x | ft\.? | feat\.? )\s*", s.strip(), maxsplit=1, flags=re.I)[0].strip()
    if first.isupper():
        first = " ".join(w if person and len(w) <= 2 else w.capitalize() for w in first.split())
    return first


def clean_title(meta: dict) -> tuple[str, str | None]:
    """Best-effort song name and singer from YouTube metadata (for display + lyric lookup).

    Order of trust: YouTube Music's own track / artist; "SONG : … / ARTIST : …" lines in
    the description (official uploads often have them); the title's "A - B", where the
    channel name tells which side is the singer (titles come both ways round)."""
    track, artist = meta.get("track"), meta.get("artist") or meta.get("creator")
    title = meta.get("title") or "YouTube video"
    if track:
        return track, (_tidy_name(artist) if artist else None)
    desc = meta.get("description") or ""
    song = re.search(r"^\s*(?:song|track|song name)\s*[:\-–]\s*(.+)$", desc, re.I | re.M)
    singer = re.search(r"^\s*(?:artists?|singers?|vocals?|sung by)\s*[:\-–]\s*(.+)$", desc, re.I | re.M)
    if song and singer and len(song.group(1)) < 60:
        return _tidy_name(song.group(1), person=False), _tidy_name(singer.group(1))
    t = _NOISE.sub("", title).strip()
    uploader = (meta.get("uploader") or meta.get("channel") or "").replace(" - Topic", "").strip()
    if " - " in t:
        a, b = (x.strip() for x in t.split(" - ", 1))
        ch = _key(uploader)
        names = lambda side: [_key(x) for x in re.split(r"\s*(?:\||,|&| x | ft\.? | feat\.? )\s*", side, flags=re.I)]  # noqa: E731
        if ch and ch in names(b) and ch not in names(a):
            return _tidy_name(a, person=False), _tidy_name(b)  # "Song - Singer"
        return _tidy_name(b, person=False), _tidy_name(a)  # the usual "Singer - Song"
    return t, uploader or None


def fetch(
    vid: str,
    out_dir: Path,
    max_duration_sec: float,
    progress: Callable[[float, str], None],
    on_proc: Callable[[subprocess.Popen | None], None],
    on_duration: Callable[[float], None] | None = None,
) -> tuple[Path, dict]:
    url = f"https://www.youtube.com/watch?v={vid}"
    base = [sys.executable, "-m", "yt_dlp", "--no-playlist", "--no-warnings"]
    progress(0.0, "reading video info")
    r = subprocess.run([*base, "-J", url], capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        msg = (r.stderr.strip().splitlines() or ["unknown error"])[-1]
        raise RuntimeError(f"YouTube: {msg.replace('ERROR: ', '')}")
    meta = json.loads(r.stdout)
    if meta.get("is_live") or meta.get("live_status") in {"is_live", "is_upcoming"}:
        raise RuntimeError("Live streams can't be analysed.")
    dur = float(meta.get("duration") or 0)
    if dur and on_duration:
        on_duration(dur)  # known before downloading: the time estimate can start right away
    if dur > max_duration_sec:
        raise RuntimeError(f"Video is {dur / 60:.1f} min; the limit is {max_duration_sec / 60:.0f} min (LEMO_MAX_DURATION_MIN).")

    for old in out_dir.glob("source.*"):
        old.unlink()
    cmd = [*base, "-f", "bestaudio/best", "--no-part", "--newline", "-o", str(out_dir / "source.%(ext)s"), url]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    on_proc(proc)
    pct = re.compile(r"\[download\]\s+([\d.]+)%")
    tail: list[str] = []
    assert proc.stdout
    for line in proc.stdout:
        tail = (tail + [line.strip()])[-5:]
        m = pct.search(line)
        if m:
            progress(float(m.group(1)) / 100, f"downloading audio {float(m.group(1)):.0f}%")
    code = proc.wait()
    on_proc(None)
    if code != 0:
        raise RuntimeError(f"Download failed: {tail[-1] if tail else code}")
    files = [p for p in out_dir.glob("source.*") if p.suffix not in {".json", ".part"}]
    if not files:
        raise RuntimeError("Download finished but no audio file was produced.")
    title, artist = clean_title(meta)
    return files[0], {"title": title, "artist": artist, "duration": dur, "videoId": vid}
