"""Song files on the VPS (LEMO_REMOTE_STORE, over SSH), served to browsers by nginx
through signed, expiring links (LEMO_REMOTE_URL + LEMO_REMOTE_SECRET).

Analysis still happens on this machine. Each finished song is copied to the VPS;
this machine then only keeps a cache (songs safe on the VPS can be dropped here) and
fetches a song back when it needs the files itself (key / speed renders, word timing).
When a browser asks for a song that isn't here, it's sent to the VPS instead."""

from __future__ import annotations

import base64
import hashlib
import shlex
import subprocess
import threading
import time
from pathlib import Path

from .config import CONFIG

PUSHED = ".pushed"  # marker: this song's files are safe on the VPS
EXCLUDE = ["variants/", ".decode-*", ".used", PUSHED, "*.tmp*", "source.*", "mix.wav", "*.wav"]

_lock = threading.Lock()  # one transfer at a time (small VPS, home upload)
# notice a dropped connection within ~45 s instead of hanging
SSH_OPTS = "-o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3"
_index: dict = {"at": 0.0, "ids": set()}
_usage: dict = {"at": 0.0, "used": 0, "free": None}


def enabled() -> bool:
    return bool(CONFIG.remote_store and CONFIG.remote_url and CONFIG.remote_secret)


def _host_path() -> tuple[str, str]:
    host, _, path = CONFIG.remote_store.partition(":")
    return host, path.rstrip("/")


def _ssh(cmd: str, timeout: float = 30) -> str:
    host, _ = _host_path()
    r = subprocess.run(["ssh", *SSH_OPTS.split(), host, cmd],
                       capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"VPS: {(r.stderr or r.stdout).strip()[-200:]}")
    return r.stdout


def _rsync(src: str, dst: str, timeout: float = 900, tries: int = 4) -> None:
    """Copy with rsync; a dropped connection is retried (pauses 5, 15, 45 s) and half-sent
    files resume where they stopped (--partial)."""
    excludes = [a for e in EXCLUDE for a in ("--exclude", e)]
    last = ""
    for attempt in range(tries):
        if attempt:
            time.sleep(5 * 3 ** (attempt - 1))
        try:
            r = subprocess.run(["rsync", "-a", "--partial", "--timeout=60", "-e", f"ssh {SSH_OPTS}", *excludes, src, dst],
                               capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            last = "took too long"
            continue
        if r.returncode == 0:
            return
        last = (r.stderr or r.stdout).strip()[-200:]
    raise RuntimeError(f"copy failed after {tries} tries: {last}")


# ---- what's on the VPS ---------------------------------------------------------------------


def index(max_age: float = 60) -> set[str]:
    """Song ids stored on the VPS (re-listed at most once a minute)."""
    if not enabled():
        return set()
    if time.time() - _index["at"] > max_age:
        _, path = _host_path()
        try:
            out = _ssh(f"cd {shlex.quote(path)} && ls -1 */reference.json 2>/dev/null || true")
            _index["ids"] = {line.split("/")[0] for line in out.split() if line.endswith("/reference.json")}
            _index["at"] = time.time()
        except Exception:
            pass  # keep the last known list
    return _index["ids"]


def has(song_id: str) -> bool:
    return song_id in index()


def usage(max_age: float = 60) -> dict:
    """Bytes lemo uses on the VPS, and the VPS disk's free bytes (re-measured once a minute)."""
    if enabled() and time.time() - _usage["at"] > max_age:
        _, path = _host_path()
        try:
            out = _ssh(f"du -sb {shlex.quote(path)} | cut -f1; df -B1 --output=avail {shlex.quote(path)} | tail -1").split()
            _usage.update(used=int(out[0]), free=int(out[1]), at=time.time())
        except Exception:
            pass
    return {"used": _usage["used"], "free": _usage["free"]}


# ---- moving songs --------------------------------------------------------------------------


def push(song_dir: Path) -> bool:
    """Copy a finished song to the VPS. True when it's safely there."""
    if not enabled() or not (song_dir / "reference.json").exists():
        return False
    _, path = _host_path()
    host, _ = _host_path()
    with _lock:
        try:
            _rsync(f"{song_dir}/", f"{host}:{path}/{song_dir.name}/")
        except Exception as e:
            print(f"could not copy {song_dir.name} to the VPS: {e}", flush=True)
            return False
    (song_dir / PUSHED).touch()
    _index["ids"].add(song_dir.name)
    _usage["at"] = 0  # re-measure
    return True


def push_later(song_dir: Path) -> None:
    threading.Thread(target=push, args=(song_dir,), daemon=True, name=f"push-{song_dir.name}").start()


def pending(root: Path) -> list[Path]:
    """Finished songs not yet safely on the VPS."""
    return [r.parent for r in sorted(root.glob("*/reference.json")) if not (r.parent / PUSHED).exists()]


def keep_in_sync(root: Path, every: float = 300) -> None:
    """Background: copy anything not yet on the VPS now, then check again every 5 minutes —
    so songs whose copy failed (network drop, VPS restart) get there on their own."""
    if not enabled():
        return

    def loop() -> None:
        while True:
            for d in pending(root):
                if (d / "reference.json").exists():
                    push(d)
            time.sleep(every)

    threading.Thread(target=loop, daemon=True, name="vps-sync").start()


def pull(song_dir: Path) -> bool:
    """Fetch a song back from the VPS (this machine needs its files)."""
    if not enabled() or not has(song_dir.name):
        return False
    host, path = _host_path()
    song_dir.mkdir(parents=True, exist_ok=True)
    with _lock:
        try:
            _rsync(f"{host}:{path}/{song_dir.name}/", f"{song_dir}/")
        except Exception as e:
            print(f"could not fetch {song_dir.name} from the VPS: {e}", flush=True)
            return False
    (song_dir / PUSHED).touch()
    return (song_dir / "reference.json").exists()


def remove(song_id: str) -> None:
    if not enabled():
        return
    _, path = _host_path()
    try:
        _ssh(f"rm -rf {shlex.quote(path + '/' + song_id)}")
        _index["ids"].discard(song_id)
        _usage["at"] = 0
    except Exception as e:
        print(f"could not delete {song_id} on the VPS: {e}", flush=True)


# ---- the analysis models (for browsers analysing on their own device) ------------------------

_models: dict = {"at": 0.0, "sizes": {}}


def has_model(name: str, local: Path) -> bool:
    """True only when the VPS copy is complete (same size as here) — an interrupted
    copy must never be handed to a browser."""
    if time.time() - _models["at"] > 600:
        _, path = _host_path()
        try:
            out = _ssh(f"cd {shlex.quote(path + '/_models')} 2>/dev/null && stat -c '%n %s' * 2>/dev/null || true")
            _models.update(sizes={n: int(sz) for n, sz in (line.rsplit(" ", 1) for line in out.splitlines() if " " in line)}, at=time.time())
        except Exception:
            pass
    return local.exists() and _models["sizes"].get(name) == local.stat().st_size


def push_models(models_dir: Path) -> None:
    """Copy the models to the VPS once, so browsers download them from there (fast)
    instead of from this machine."""
    if not enabled() or not models_dir.exists():
        return
    host, path = _host_path()
    with _lock:
        try:
            r = subprocess.run(["rsync", "-a", "--partial", "--timeout=60", "-e", f"ssh {SSH_OPTS}", f"{models_dir}/", f"{host}:{path}/_models/"],
                               capture_output=True, text=True, timeout=3600)
            if r.returncode == 0:
                _models["at"] = 0  # re-list
            else:
                print(f"could not copy the models to the VPS: {(r.stderr or r.stdout).strip()[-200:]}", flush=True)
        except Exception as e:
            print(f"could not copy the models to the VPS: {e}", flush=True)


# ---- links for browsers -----------------------------------------------------------------------


def signed_url(song_id: str, filename: str, ttl: int = 6 * 3600) -> str:
    """A link nginx accepts until it expires (secure_link_md5 "$expires$uri SECRET")."""
    expires = int(time.time()) + ttl
    base = CONFIG.remote_url.rstrip("/")
    uri_path = "/" + base.split("://", 1)[-1].split("/", 1)[-1] + f"/{song_id}/{filename}"
    digest = hashlib.md5(f"{expires}{uri_path} {CONFIG.remote_secret}".encode()).digest()
    sig = base64.urlsafe_b64encode(digest).decode().rstrip("=")
    return f"{base}/{song_id}/{filename}?s={sig}&e={expires}"
