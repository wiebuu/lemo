"""Heavy work (vocal separation, pitch tracking, word timing) runs in its own
short-lived, low-priority process, one at a time.

The ML models need several GB while they run. In a separate process all of it
goes back to the system the moment the work is done, instead of staying in the
server for good; and at low priority the browser (which does the live pitch
detection while you sing) always gets the CPU first."""

from __future__ import annotations

import multiprocessing as mp
import os
import queue
import signal
import sys
import threading
import time
from typing import Any, Callable

# Only one heavy process at a time — they'd fight over memory and the GPU
# (Metal also aborts when two threads submit work at once).
HEAVY = threading.Lock()
LIGHT = threading.Lock()  # one light job at a time too (they're short)

NICE = 10


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, file=sys.stderr, flush=True)


class Cancelled(Exception):
    pass


def _entry(fn: Callable, args: tuple, q: Any) -> None:
    try:
        os.setpgrp()  # so cancelling also stops tools it started (yt-dlp, ffmpeg)
        os.nice(NICE)
    except OSError:
        pass
    try:
        import torch

        torch.set_num_threads(max(1, min(4, (os.cpu_count() or 4) // 2)))
    except ImportError:
        pass
    try:
        q.put(("result", fn(*args, lambda msg: q.put(("progress", msg)))))
    except Exception as e:  # sent back and raised in the server
        import traceback

        traceback.print_exc()
        q.put(("error", f"{type(e).__name__}: {e}" if not str(e) else str(e)))


def run(
    fn: Callable,
    *args: Any,
    on_progress: Callable[[Any], None] | None = None,
    cancel: threading.Event | None = None,
    heavy: bool = True,
) -> Any:
    """Run fn(*args, send) in a fresh process and return its result. `send(msg)`
    reports progress back (passed to on_progress). Setting `cancel` stops it.
    heavy=False: light work (finishing a song analysed on someone's device) that
    doesn't wait behind the analysis queue."""
    ctx = mp.get_context("spawn")
    q = ctx.Queue()
    with HEAVY if heavy else LIGHT:
        if cancel and cancel.is_set():
            raise Cancelled()
        p = ctx.Process(target=_entry, args=(fn, args, q), daemon=True)
        p.start()
        finished = False
        try:
            while True:
                if cancel and cancel.is_set():
                    raise Cancelled()
                try:
                    kind, payload = q.get(timeout=0.3)
                except queue.Empty:
                    if not p.is_alive():
                        try:  # it may have finished between the two checks
                            kind, payload = q.get(timeout=0.5)
                        except queue.Empty:
                            raise RuntimeError(
                                "the analysis process stopped unexpectedly — most likely the computer ran out of memory"
                            ) from None
                    else:
                        continue
                if kind == "progress":
                    if on_progress:
                        on_progress(payload)
                elif kind == "result":
                    finished = True
                    return payload
                else:
                    finished = True
                    raise RuntimeError(payload)
        finally:
            _stop(p, finished)


def _stop(p: mp.Process, finished: bool) -> None:
    if finished:
        p.join(5)  # let a finished worker exit on its own
    if p.is_alive():
        try:
            os.killpg(p.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            p.terminate()
        p.join(3)
        if p.is_alive():
            p.kill()
    p.join(1)
