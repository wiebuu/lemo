"""Today's top: each singer's best take of the day, the best 100 kept — with their voice, so
anyone can open the full result and hear how they sang it.

Storage stays small: a take that drops out of the 100 (or is from an earlier day) is
deleted, files and all. A day runs midnight to midnight, India time."""

from __future__ import annotations

import gzip
import json
import secrets
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import userdata
from .config import CONFIG, FFMPEG

IST = timezone(timedelta(hours=5, minutes=30))
MIN_SECONDS = 60  # at least a minute of the song
VOICE = "voice.m4a"
FRAMES = "frames.json.gz"


class Rejected(Exception):
    pass


def today() -> str:
    return datetime.now(IST).date().isoformat()


def resets_at() -> float:
    """When today's top starts again (unix seconds)."""
    now = datetime.now(IST)
    return (now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)).timestamp()


def root() -> Path:
    d = CONFIG.data_dir / "top"
    d.mkdir(parents=True, exist_ok=True)
    return d


def take_dir(take_id: str) -> Path:
    if not take_id.isalnum():
        raise Rejected("invalid take")
    return root() / take_id


def _delete(ids: list[str]) -> None:
    for i in ids:
        if i.isalnum():
            shutil.rmtree(root() / i, ignore_errors=True)


def tidy() -> None:
    """Drop earlier days, and any files the database no longer lists (e.g. after a crash)."""
    _delete(userdata.top_prune(today()))
    keep = userdata.top_ids()
    for d in root().iterdir():
        if d.name in keep:
            continue
        if d.is_dir():
            shutil.rmtree(d, ignore_errors=True)
        else:
            d.unlink(missing_ok=True)


def check(uid: str, score: float) -> dict:
    return userdata.top_rank(today(), uid, score)


def _frames(raw: bytes) -> dict:
    """{t, m, c, l}: the pitch line, as parallel lists (checked, then kept gzipped)."""
    try:
        f = json.loads(raw)
        n = len(f["t"])
        if not (10 <= n <= 200_000) or any(len(f[k]) != n for k in ("m", "c")) or ("l" in f and len(f["l"]) != n):
            raise ValueError
        return f
    except Exception as e:
        raise Rejected("the pitch line couldn't be read") from e


def add(uid: str, meta: dict, frames_raw: bytes, voice_wav: Path) -> dict:
    """Keep a take if it makes today's 100. Returns {rank} (None: it didn't make it)."""
    score, seconds = meta.get("score"), meta.get("seconds")
    if not isinstance(score, (int, float)) or not 0 <= score <= 1:
        raise Rejected("invalid score")
    if not isinstance(seconds, (int, float)) or seconds < MIN_SECONDS or seconds > 1200:
        raise Rejected(f"a take needs at least {MIN_SECONDS} seconds of the song")
    day = today()
    if userdata.top_rank(day, uid, float(score))["rank"] is None:
        return {"rank": None}
    frames = _frames(frames_raw)
    take_id = secrets.token_hex(8)
    d = take_dir(take_id)
    d.mkdir(parents=True)
    try:
        # the voice as small AAC (plays in every browser): ~0.5 MB a minute
        r = subprocess.run([FFMPEG, "-v", "error", "-y", "-i", str(voice_wav), "-ac", "1", "-ar", "24000",
                            "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart", str(d / VOICE)],
                           capture_output=True, timeout=120)
        if r.returncode != 0 or not (d / VOICE).exists():
            raise Rejected("the recording couldn't be read")
        (d / FRAMES).write_bytes(gzip.compress(json.dumps(frames, separators=(",", ":")).encode()))
        keep = {k: meta.get(k) for k in ("from", "to", "start", "keyOffset", "scores", "toleranceCents", "scoringMode")}
        rank, gone = userdata.top_add({"id": take_id, "day": day, "uid": uid, "songId": meta["songId"], "title": meta.get("title"),
                                       "artist": meta.get("artist"), "score": float(score), "seconds": float(seconds), "meta": keep})
    except Exception:
        shutil.rmtree(d, ignore_errors=True)
        raise
    _delete(gone)
    return {"rank": rank}


def get(take_id: str) -> dict | None:
    e = userdata.top_get(take_id)
    d = take_dir(take_id)
    if not e or not (d / FRAMES).exists():
        return None
    return {**e, "frames": json.loads(gzip.decompress((d / FRAMES).read_bytes()))}


def voice(take_id: str) -> Path | None:
    f = take_dir(take_id) / VOICE
    return f if f.exists() else None
