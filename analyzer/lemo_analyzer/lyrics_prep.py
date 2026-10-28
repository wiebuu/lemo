"""Lyrics found and timed ahead of time, kept with the song (lyrics.json) for any server
to hand out — including a small one that can't reach YouTube or run the alignment model.

Runs where both work (the machine that analyses songs): right after each song is
analysed, and when idle for stored songs that don't have lyrics yet (one at a time).
"""

from __future__ import annotations

import importlib.util
import json
import shlex
import subprocess
import threading
import time
from pathlib import Path

from . import catalog, jobs, remote, worker
from .config import CONFIG

FILE = "lyrics.json"
IDLE_CHECK_SEC = 600


def available() -> bool:
    """YouTube (for captions / descriptions) and the alignment model are both here."""
    return CONFIG.enable_youtube and CONFIG.server_analysis and importlib.util.find_spec("torchaudio") is not None


def timed_lines(found: dict, d: Path, ref: dict) -> list[dict]:
    """The best version, timed to the singer: line start / end and each word."""
    from . import lyric_align, lyrics_fit
    from .audio import wav_stems
    from .config import torch_device

    duration = float(ref.get("duration") or 0)
    with wav_stems(d, ("vocals",)) as wd:
        vocals = wd / "vocals.wav"
        if found.get("synced"):
            lrc = [(t, text) for t, text in lyrics_fit.lrc_lines(found["synced"]) if text]
            lines = [{"start": t, "end": min(duration, lrc[i + 1][0] if i + 1 < len(lrc) else t + 6), "text": text}
                     for i, (t, text) in enumerate(lrc)]
            words = lyric_align.align_lines(vocals, lines, torch_device())
            return [{**ln, "words": w} for ln, w in zip(lines, words)]
        texts = [t.strip() for t in (found.get("plain") or "").splitlines() if t.strip()]
        if not texts:
            return []
        sung = [n for n in ref.get("notes", []) if n.get("sung", True)]
        span = (sung[0]["startTime"], sung[-1]["endTime"]) if sung else (0.0, duration)
        return lyric_align.align_plain(vocals, texts, span, torch_device())


def prepare(song_id: str, title: str, artist: str) -> tuple[bool, str]:
    """Find, time and save one song's lyrics (in this process: loads the model)."""
    from . import lyrics

    d = jobs.song_dir(song_id)
    if not ((d / "reference.json").exists() or remote.pull(d)):
        return False, "not stored"
    ref = json.loads((d / "reference.json").read_text())
    vid = song_id[3:] if song_id.startswith("yt-") else None
    found = lyrics.find(title or ref.get("title") or "", artist or ref.get("artist") or "",
                        float(ref.get("duration") or 0), vid, ref.get("notes"))
    if not (found.get("synced") or found.get("plain")):
        return False, "no lyrics found"
    found["timed"] = timed_lines(found, d, ref)
    found["preparedAt"] = int(time.time())
    (d / FILE).write_text(json.dumps(found, ensure_ascii=False))
    to_store(d)
    return True, f"{found.get('source')} · {'synced' if found.get('synced') else 'plain'} · {len(found['timed'])} lines"


def prepare_in_worker(song_id: str, title: str, artist: str, send) -> tuple[bool, str]:
    return prepare(song_id, title, artist)


def to_store(d: Path) -> None:
    """Copy lyrics.json next to the song in the store, and drop the server's cached copy
    of the song so it reads the new file."""
    if not remote.enabled() or not (d / FILE).exists():
        return
    host, _ = remote._host_path()
    with remote._lock:
        remote._rsync(str(d / FILE), remote._at(f"{d.name}/{FILE}"))
    if host:  # the server (LEMO_DATA_DIR=~/lemo/data) fetches the song again, with its lyrics
        subprocess.run(["ssh", *remote.SSH_OPTS.split(), host, f"rm -rf ~/lemo/data/songs/{shlex.quote(d.name)}"],
                       timeout=30, check=False, capture_output=True)


def with_lyrics() -> set[str]:
    """Songs that already have lyrics.json (here or in the store)."""
    root = jobs.song_dir("x").parent
    have = {p.parent.name for p in root.glob(f"*/{FILE}")} if root.exists() else set()
    if remote.enabled():
        _, path = remote._host_path()
        try:
            out = remote._ssh(f"cd {shlex.quote(path)} && ls -1 */{FILE} 2>/dev/null || true")
            have |= {line.split("/")[0] for line in out.split() if line.endswith(f"/{FILE}")}
        except Exception:
            pass
    return have


def for_song(song_id: str, title: str | None, artist: str | None) -> None:
    """Right after a song is analysed: its lyrics, in a worker process (waits its turn
    behind other heavy work)."""
    if not available() or not song_id.startswith(("yt-", "up-")):
        return
    try:
        ok, msg = worker.run(prepare_in_worker, song_id, title or "", artist or "", heavy=True)
        worker.log(f"lyrics {song_id}: {msg}")
    except Exception as e:  # never fails the song
        worker.log(f"lyrics {song_id}: failed: {e}")


_tried: set[str] = set()


def catch_up_forever() -> None:
    """Background: while nothing else is being analysed, give stored songs that have no
    lyrics yet theirs, one at a time; look again every 10 minutes."""
    if not available():
        return

    def loop() -> None:
        while True:
            try:
                missing = [(sid, e) for sid, e in sorted(catalog.load().items())
                           if sid.startswith(("yt-", "up-")) and sid not in _tried]
                have = with_lyrics() if missing else set()
                for sid, e in missing:
                    if sid in have:
                        continue
                    while jobs.MANAGER.busy():  # songs being analysed go first
                        time.sleep(15)
                    _tried.add(sid)  # once per run: a song with no lyrics anywhere isn't retried in a loop
                    for_song(sid, e.get("title"), e.get("artist"))
            except Exception as e:
                worker.log(f"lyrics catch-up: {e}")
            time.sleep(IDLE_CHECK_SEC)

    threading.Thread(target=loop, daemon=True, name="lemo-lyrics").start()
