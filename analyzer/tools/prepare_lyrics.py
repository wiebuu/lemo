"""Find and time the lyrics of stored songs by hand (the analyzer also does this by
itself: after each song, and when idle). Needs YouTube and the alignment model.

    .venv/bin/python -m tools.prepare_lyrics            # every song still without lyrics
    .venv/bin/python -m tools.prepare_lyrics yt-abc…    # just these (found again)

One song at a time, in this one process (the alignment model is loaded once, ~2.5 GB).
"""

from __future__ import annotations

import shutil
import sys
import time

from lemo_analyzer import catalog, lyrics_prep


def main(ids: list[str]) -> None:
    cat = catalog.load()
    have = set() if ids else lyrics_prep.with_lyrics()
    todo = ids or [sid for sid in sorted(cat) if sid.startswith("yt-") and sid not in have]
    missing = []
    for n, sid in enumerate(todo, 1):
        t = time.time()
        e = cat.get(sid, {})
        try:
            ok, result = lyrics_prep.prepare(sid, e.get("title") or "", e.get("artist") or "")
        except Exception as ex:  # one song failing never stops the rest
            ok, result = False, f"failed: {ex}"
        if not ok:
            missing.append(sid)
        print(f"[{n}/{len(todo)}] {sid} {e.get('title', '')}: {result} ({time.time() - t:.0f}s)", flush=True)
    print(f"done. without lyrics: {', '.join(missing) or 'none'}", flush=True)


if __name__ == "__main__":
    if not shutil.which("ffmpeg"):
        sys.exit("needs ffmpeg")
    main(sys.argv[1:])
