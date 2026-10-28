"""Find and time the lyrics of every stored song, on a machine that can (YouTube access
and the alignment model), and keep them with the song for a small server to hand out.

    .venv/bin/python -m tools.prepare_lyrics            # every song still without lyrics
    .venv/bin/python -m tools.prepare_lyrics yt-abc…    # just these (found again)

One song at a time, in this one process (the alignment model is loaded once, ~1.5 GB).
Each song gets `lyrics.json` (every version found, best first, plus the best one timed
line by line and word by word), copied to the song store. Songs whose lyrics weren't
found are listed at the end; run again later to retry them.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

from lemo_analyzer import catalog, jobs, lyric_align, lyrics, lyrics_fit, remote
from lemo_analyzer.audio import wav_stems
from lemo_analyzer.config import torch_device

FILE = "lyrics.json"


def timed_lines(found: dict, d: Path, ref: dict) -> list[dict]:
    """The best version, timed to the singer: line start / end and each word."""
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


def to_store(d: Path) -> None:
    """Copy lyrics.json next to the song in the store, and drop the server's cached copy
    of the song so it reads the new file."""
    if not remote.enabled():
        return
    host, path = remote._host_path()
    remote._rsync(str(d / FILE), remote._at(f"{d.name}/{FILE}"))
    if host:  # the server (LEMO_DATA_DIR=~/lemo/data) fetches the song again, with its lyrics
        subprocess.run(["ssh", *remote.SSH_OPTS.split(), host, f"rm -rf ~/lemo/data/songs/{d.name}"], timeout=30, check=False)


def prepare(song_id: str, entry: dict) -> tuple[bool, str]:
    d = jobs.song_dir(song_id)
    if not ((d / "reference.json").exists() or remote.pull(d)):
        return False, "not stored"
    ref = json.loads((d / "reference.json").read_text())
    title, artist = entry.get("title") or ref.get("title") or "", entry.get("artist") or ref.get("artist") or ""
    vid = song_id[3:] if song_id.startswith("yt-") else None
    found = lyrics.find(title, artist, float(ref.get("duration") or 0), vid, ref.get("notes"))
    if not (found.get("synced") or found.get("plain")):
        return False, "no lyrics found"
    found["timed"] = timed_lines(found, d, ref)
    found["preparedAt"] = int(time.time())
    (d / FILE).write_text(json.dumps(found, ensure_ascii=False))
    to_store(d)
    return True, f"{found.get('source')} · {'synced' if found.get('synced') else 'plain'} · {len(found['timed'])} lines"


def main(ids: list[str]) -> None:
    cat = catalog.load()
    todo = ids or [sid for sid in sorted(cat) if sid.startswith("yt-")]
    missing = []
    for n, sid in enumerate(todo, 1):
        d = jobs.song_dir(sid)
        if not ids and (d / FILE).exists():
            continue
        t = time.time()
        try:
            ok, result = prepare(sid, cat.get(sid, {}))
        except Exception as e:  # one song failing never stops the rest
            ok, result = False, f"failed: {e}"
        if not ok:
            missing.append(sid)
        print(f"[{n}/{len(todo)}] {sid} {cat.get(sid, {}).get('title', '')}: {result} ({time.time() - t:.0f}s)", flush=True)
    print(f"done. without lyrics: {', '.join(missing) or 'none'}", flush=True)


if __name__ == "__main__":
    if not shutil.which("ffmpeg"):
        sys.exit("needs ffmpeg")
    main(sys.argv[1:])
