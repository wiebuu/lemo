"""Timing lyrics to the singer for a server that can't.

The VPS (small, no torch) can't run the word-timing model, so when a singer pastes or
edits lyrics there, it leaves a job in the song store (`_align/<song>__<key>.json`). The
machine that analyses songs (this Mac) picks jobs up, times the lines with the model and
puts the result next to the song (`<song>/align-<key>.json`), where the VPS answers with
it. If no machine picks the job up for a while, the VPS falls back to rough timing.

Jobs are claimed by renaming them, so two processes here (the analyzer and the admin
site) never time the same one twice.
"""

from __future__ import annotations

import json
import os
import shlex
import threading
import time
from pathlib import Path

from . import jobs, remote, worker

QUEUE = "_align"
WAIT_SEC = 300  # the VPS gives up waiting after this and times the lines roughly instead
_started = False


# ---- on the server (the store is a folder here) -----------------------------------------------


def _store() -> Path | None:
    if not remote.enabled() or remote._host_path()[0]:
        return None  # not the server holding the store
    return Path(remote._host_path()[1])


def available() -> bool:
    """A job can be left for another machine (this is the VPS)."""
    return _store() is not None


def result(song_id: str, key: str) -> dict | None:
    """The finished job ({"lines": …} or {"error": …}), once the other machine is done."""
    s = _store()
    f = s / song_id / f"align-{key}.json" if s else None
    if not f or not f.exists():
        return None
    try:
        return json.loads(f.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def ask(song_id: str, key: str, job: dict) -> float:
    """Leave the job (once). Returns how long it has been waiting, in seconds."""
    s = _store()
    q = s / QUEUE
    q.mkdir(exist_ok=True)
    name = f"{song_id}__{key}.json"
    waiting = [p for p in (q / name, *q.glob(f"{name}.*")) if p.exists()]
    if waiting:
        return time.time() - min(p.stat().st_mtime for p in waiting)
    tmp = q / f".{name}.tmp"
    tmp.write_text(json.dumps({"songId": song_id, "key": key, **job}))
    tmp.replace(q / name)
    return 0.0


# ---- on the machine that analyses songs ---------------------------------------------------------


def _remote_dir() -> str:
    return remote._host_path()[1] + "/" + QUEUE


def work_once() -> int:
    """Time every waiting job. Returns how many were done."""
    out = remote._ssh(f"cd {shlex.quote(_remote_dir())} 2>/dev/null && ls -1 -- *.json 2>/dev/null || true")
    done = 0
    for name in out.split():
        if not name.endswith(".json") or "__" not in name:
            continue
        claimed = f"{name}.{os.getpid()}"
        try:  # claim it: only one of us gets to rename it
            remote._ssh(f"cd {shlex.quote(_remote_dir())} && mv -n -- {shlex.quote(name)} {shlex.quote(claimed)} && test -f {shlex.quote(claimed)}")
        except Exception:
            continue
        try:
            job = json.loads(remote._ssh(f"cat -- {shlex.quote(_remote_dir() + '/' + claimed)}"))
            res = _time(job)
        except Exception as e:  # reported to the singer, not guessed
            job = locals().get("job") or {"songId": name.split("__")[0], "key": name.split("__")[1][:-5]}
            res = {"error": str(e)[:300]}
        _send_back(job["songId"], job["key"], res)
        remote._ssh(f"rm -f -- {shlex.quote(_remote_dir() + '/' + claimed)}")
        worker.log(f"lyrics timing for the server: {job['songId']} {'failed: ' + res['error'] if 'error' in res else 'done'}")
        done += 1
    return done


def _time(job: dict) -> dict:
    from . import lyric_align

    d = jobs.song_dir(job["songId"])
    if not ((d / "reference.json").exists() or remote.pull(d)):
        raise RuntimeError("the song isn't in the store")
    if job.get("kind") == "plain":
        lines = worker.run(lyric_align.align_plain_song, str(d), job["lines"], tuple(job["span"]), heavy=True)
    else:
        lines = worker.run(lyric_align.align_song, str(d), job["lines"], heavy=True)
    return {"lines": lines}


def _send_back(song_id: str, key: str, res: dict) -> None:
    """The result goes next to the song in the store (where the VPS reads it). Here, a
    finished timing is kept the way this machine's own server caches one: just the lines."""
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp) / f"align-{key}.json"
        f.write_text(json.dumps(res, ensure_ascii=False))
        with remote._lock:
            remote._rsync(str(f), remote._at(f"{song_id}/{f.name}"))
    d = jobs.song_dir(song_id)
    if res.get("lines") is not None and d.exists():
        (d / f"align-{key}.json").write_text(json.dumps(res["lines"], ensure_ascii=False))


def serve_forever(every: float = 10) -> None:
    """Background: look for jobs every few seconds (only where the model runs and the
    store is on another machine)."""
    global _started
    import importlib.util

    if _started or not remote.enabled() or not remote._host_path()[0] or importlib.util.find_spec("torchaudio") is None:
        return
    _started = True

    def loop() -> None:
        while True:
            try:
                work_once()
            except Exception as e:
                print(f"lyrics timing queue: {e}", flush=True)
            time.sleep(every)

    threading.Thread(target=loop, daemon=True, name="lemo-align-queue").start()
