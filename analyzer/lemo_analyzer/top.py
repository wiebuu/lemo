"""Today's top: each singer's best take of the day, the best 100 kept, so anyone can open
the full result — and hear how they sang it, if the singer shared their voice (a voice
kept private is still saved: its singer can play it, and so can Lemody's admin panel).

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
MIN_SECONDS = 45  # at least 45 seconds of the song
EASY_MIN_SCORE = 0.5  # on easy, a take needs at least 50
VOICE = "voice.m4a"
PRIVATE = "private"  # marker: the voice is kept for its singer only
COVER = "cover.m4a"  # the whole song with the singer's voice in it (made on first download)
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


def _encode(voice_wav: Path, d: Path) -> None:
    """The voice as small AAC (plays in every browser): ~0.5 MB a minute."""
    r = subprocess.run([FFMPEG, "-v", "error", "-y", "-i", str(voice_wav), "-ac", "1", "-ar", "24000",
                        "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart", str(d / (VOICE + ".tmp.m4a"))],
                       capture_output=True, timeout=120)
    tmp = d / (VOICE + ".tmp.m4a")
    if r.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        raise Rejected("the recording couldn't be read")
    tmp.replace(d / VOICE)
    (d / COVER).unlink(missing_ok=True)  # made again from the new voice


def add(uid: str, meta: dict, frames_raw: bytes, voice_wav: Path | None = None) -> dict:
    """Keep a take if it makes today's 100 (the voice only if the singer shares it, now or
    later). Returns {rank, id} (rank None: it didn't make it)."""
    score, seconds = meta.get("score"), meta.get("seconds")
    if not isinstance(score, (int, float)) or not 0 <= score <= 1:
        raise Rejected("invalid score")
    if not isinstance(seconds, (int, float)) or seconds < MIN_SECONDS or seconds > 1200:
        raise Rejected(f"a take needs at least {MIN_SECONDS} seconds of the song")
    tol = meta.get("toleranceCents", 50)
    if not isinstance(tol, (int, float)) or tol > 100 or tol <= 0:
        raise Rejected("invalid difficulty")
    if tol >= 100 and score < EASY_MIN_SCORE:
        raise Rejected(f"on easy, a take needs at least {round(EASY_MIN_SCORE * 100)} for today's top")
    day = today()
    if userdata.top_rank(day, uid, float(score))["rank"] is None:
        return {"rank": None, "id": None}
    frames = _frames(frames_raw)
    take_id = secrets.token_hex(8)
    d = take_dir(take_id)
    d.mkdir(parents=True)
    try:
        if voice_wav is not None:
            _encode(voice_wav, d)
        (d / FRAMES).write_bytes(gzip.compress(json.dumps(frames, separators=(",", ":")).encode()))
        keep = {k: meta.get(k) for k in ("from", "to", "start", "keyOffset", "scores", "toleranceCents", "scoringMode")}
        rank, gone = userdata.top_add({"id": take_id, "day": day, "uid": uid, "songId": meta["songId"], "title": meta.get("title"),
                                       "artist": meta.get("artist"), "score": float(score), "seconds": float(seconds), "meta": keep})
    except Exception:
        shutil.rmtree(d, ignore_errors=True)
        raise
    _delete(gone)
    return {"rank": rank, "id": take_id if rank else None}


def add_voice(uid: str, take_id: str, voice_wav: Path | None = None, private: bool = False) -> None:
    """The singer's voice for their take on today's top: shared with everyone, or kept
    private (then only they can play it). With no recording, only the choice changes."""
    d = take_dir(take_id)
    if userdata.top_owner(take_id) != uid or not d.exists():
        raise Rejected("this take is no longer in today's top")
    if voice_wav is not None:
        _encode(voice_wav, d)
    elif not (d / VOICE).exists():
        raise Rejected("send the recording")
    if private:
        (d / PRIVATE).touch()
    else:
        (d / PRIVATE).unlink(missing_ok=True)


def has_voice(take_id: str) -> bool:
    """A voice everyone may hear."""
    d = take_dir(take_id)
    return (d / VOICE).exists() and not (d / PRIVATE).exists()


def voice_private(take_id: str) -> bool:
    """A voice its singer kept for themselves."""
    d = take_dir(take_id)
    return (d / VOICE).exists() and (d / PRIVATE).exists()


def can_hear(take_id: str, uid: str | None) -> bool:
    """Everyone hears a shared voice; a private one only its singer (uid None: Lemody's admin)."""
    if has_voice(take_id):
        return True
    return voice_private(take_id) and (uid is None or userdata.top_owner(take_id) == uid)


def get(take_id: str) -> dict | None:
    e = userdata.top_get(take_id)
    d = take_dir(take_id)
    if not e or not (d / FRAMES).exists():
        return None
    return {**e, "hasVoice": has_voice(take_id), "voicePrivate": voice_private(take_id), "frames": json.loads(gzip.decompress((d / FRAMES).read_bytes()))}


def voice(take_id: str, uid: str | None) -> Path | None:
    """The voice file, for someone allowed to hear it (see can_hear)."""
    f = take_dir(take_id) / VOICE
    return f if f.exists() and can_hear(take_id, uid) else None


FADE = 0.6  # seconds: the original singer fades out where the take starts, and back in after


def _num(v, default: float) -> float:
    return float(v) if isinstance(v, (int, float)) else default


def cover(take_id: str, uid: str | None, backing: Path, vocals: Path) -> Path | None:
    """The singer's cover, for someone allowed to hear their voice: the WHOLE song, not just
    the stretch they sang. The original plays before and after; where they sang, the
    original singer fades out and their voice comes in over the music. Made once, kept
    with the take (and deleted with it)."""
    f = voice(take_id, uid)
    e = userdata.top_get(take_id)
    if not f or not e:
        return None
    out = take_dir(take_id) / COVER
    if out.exists() and out.stat().st_mtime >= f.stat().st_mtime:
        return out
    m = e.get("meta") or {}
    start = _num(m.get("start"), 0.0)  # song time of the voice's first sample
    a = _num(m.get("from"), start)
    b = _num(m.get("to"), a + _num(e.get("seconds"), 0.0))
    F = FADE
    # the original singer: silent while the take is sung (with fades), the voice the opposite
    orig = f"max(clip(({a:.3f}-t)/{F},0,1),clip((t-{b:.3f})/{F},0,1))"
    mine = f"clip(min((t-{a - F:.3f})/{F},({b + F:.3f}-t)/{F}),0,1)"
    if start >= 0:
        place = f"adelay={round(start * 1000)}:all=1"
    else:  # the recording began before the song: drop that part
        place = f"atrim=start={-start:.3f},asetpts=PTS-STARTPTS"
    fmt = "aformat=sample_rates=44100:channel_layouts=stereo"
    graph = (
        f"[0:a]{fmt}[bk];"
        f"[1:a]{fmt},volume='{orig}':eval=frame[ov];"
        f"[2:a]highpass=f=80,acompressor=threshold=0.1:ratio=3:attack=10:release=200,"
        f"loudnorm=I=-14:TP=-2,{fmt},aecho=0.8:0.5:70:0.18,{place},volume='{mine}':eval=frame[vo];"  # as loud as a vocal stem
        f"[bk][ov][vo]amix=inputs=3:duration=first:normalize=0,volume=0.7,alimiter=limit=0.63:level=0[out]"  # headroom: no clipping after AAC
    )
    tmp = out.with_suffix(".tmp.m4a")
    r = subprocess.run([FFMPEG, "-v", "error", "-y", "-i", str(backing), "-i", str(vocals), "-i", str(f),
                        "-filter_complex", graph, "-map", "[out]", "-c:a", "aac", "-b:a", "192k",
                        "-movflags", "+faststart", str(tmp)], capture_output=True, timeout=300)
    if r.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        raise Rejected(f"the cover couldn't be made: {r.stderr.decode(errors='replace').strip()[-200:]}")
    tmp.replace(out)
    return out


def cover_file(take_id: str, uid: str | None) -> Path | None:
    """cover(), with the song's music found here (fetched back from the song store if needed).
    uid None: Lemody's admin panel."""
    from . import audio, jobs, remote

    e = userdata.top_get(take_id)
    if not e or not voice(take_id, uid):
        return None
    d = jobs.song_dir(e["songId"])
    if (audio.stem_file(d, "backing") is None or audio.stem_file(d, "vocals") is None) and not remote.pull(d):
        raise Rejected("this song's music isn't available right now")
    backing, vocals = audio.stem_file(d, "backing"), audio.stem_file(d, "vocals")
    if backing is None or vocals is None:
        raise Rejected("this song's music isn't available right now")
    return cover(take_id, uid, backing, vocals)
