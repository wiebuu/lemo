"""Configuration from environment variables (and analyzer/.env if present)."""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(ROOT / ".env")


def _bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Config:
    host: str = os.environ.get("LEMO_HOST", "127.0.0.1")
    port: int = int(os.environ.get("LEMO_PORT", "8787"))
    data_dir: Path = Path(os.environ.get("LEMO_DATA_DIR", str(ROOT / "data"))).expanduser()
    enable_youtube: bool = _bool("LEMO_ENABLE_YOUTUBE", False)
    max_upload_mb: int = int(os.environ.get("LEMO_MAX_UPLOAD_MB", "80"))
    max_duration_min: float = float(os.environ.get("LEMO_MAX_DURATION_MIN", "15"))
    # crepe-full (best), crepe-tiny (fast), or pyin (no neural net)
    melody_model: str = os.environ.get("LEMO_MELODY_MODEL", "crepe-full")
    device: str = os.environ.get("LEMO_DEVICE", "auto")
    lrclib_enabled: bool = _bool("LEMO_ENABLE_LRCLIB", True)
    # Firebase project whose Google sign-ins may use the analyzer (Project settings → Project ID)
    firebase_project_id: str = os.environ.get("LEMO_FIREBASE_PROJECT_ID", "").strip()
    # All of lemo's song storage (every song + key/speed renders). At this size new songs
    # are refused, with a message on the site; songs already stored keep working.
    song_limit_gb: float = float(os.environ.get("LEMO_SONG_LIMIT_GB", "10"))
    # Songs are kept until that limit by default. Optional: drop the least recently used
    # songs earlier (MB) / songs unused for this many days (0 = never).
    user_cache_mb: int = int(os.environ.get("LEMO_USER_CACHE_MB", "0")) or int(float(os.environ.get("LEMO_SONG_LIMIT_GB", "10")) * 1024)
    user_keep_days: float = float(os.environ.get("LEMO_USER_KEEP_DAYS", "0"))
    variant_cache_mb: int = int(os.environ.get("LEMO_VARIANT_CACHE_MB", "300"))
    # Song files on a VPS (see remote.py): "user@host:/path", the HTTPS base nginx serves
    # it at, and the signing secret shared with nginx. Empty = songs stay on this machine.
    remote_store: str = os.environ.get("LEMO_REMOTE_STORE", "").strip()
    remote_url: str = os.environ.get("LEMO_REMOTE_URL", "").strip()
    remote_secret: str = os.environ.get("LEMO_REMOTE_SECRET", "").strip()
    remote_min_free_gb: float = float(os.environ.get("LEMO_REMOTE_MIN_FREE_GB", "1.5"))
    # With a VPS, this machine is only a cache: songs safe on the VPS beyond this are dropped here.
    local_cache_mb: int = int(os.environ.get("LEMO_LOCAL_CACHE_MB", "2048"))


CONFIG = Config()
CONFIG.data_dir.mkdir(parents=True, exist_ok=True)

FFMPEG = shutil.which("ffmpeg")
RUBBERBAND = shutil.which("rubberband")


def device_name() -> str:
    """The device torch_device() will pick, without importing torch (the server stays light)."""
    import platform
    import sys

    if CONFIG.device != "auto":
        return CONFIG.device
    if shutil.which("nvidia-smi"):
        return "cuda"
    if sys.platform == "darwin" and platform.machine() == "arm64":
        return "mps"
    return "cpu"


def torch_device() -> str:
    import torch

    if CONFIG.device != "auto":
        return CONFIG.device
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"
