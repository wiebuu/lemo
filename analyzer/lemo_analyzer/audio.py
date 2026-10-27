"""FFmpeg preprocessing, WAV IO and speed/transpose rendering."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import numpy as np
import soundfile as sf

from .config import FFMPEG, RUBBERBAND

ANALYSIS_SR = 44100
# Stems are kept as AAC (.m4a): ~8× smaller than WAV, and browsers decode it
# sample-accurately (no encoder-delay offset), so timing stays exact.
STEM_EXT = ".m4a"
STEM_BITRATE = {"backing": "160k", "vocals": "96k"}
STEMS = ("backing", "vocals")
ALLOWED_EXT = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".webm", ".mp4"}


class AudioError(RuntimeError):
    pass


def to_wav(src: Path, dst: Path, sr: int = ANALYSIS_SR, channels: int = 2) -> None:
    """Decode anything FFmpeg understands into 16-bit PCM WAV."""
    if not FFMPEG:
        raise AudioError("ffmpeg is not installed (brew install ffmpeg)")
    cmd = [FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
           "-vn", "-ac", str(channels), "-ar", str(sr), "-c:a", "pcm_s16le", str(dst)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0 or not dst.exists():
        raise AudioError(f"Could not decode audio: {r.stderr.strip()[-300:] or 'unknown ffmpeg error'}")


def info(path: Path) -> dict:
    i = sf.info(str(path))
    return {"duration": i.frames / i.samplerate, "sampleRate": i.samplerate, "channels": i.channels}


def write_wav(path: Path, audio: np.ndarray, sr: int) -> None:
    """audio: (channels, samples) float, written as 16-bit PCM."""
    data = np.clip(audio.T if audio.ndim == 2 else audio, -1.0, 1.0)
    sf.write(str(path), data, sr, subtype="PCM_16")


def encode(src: Path, dst: Path, bitrate: str) -> None:
    if not FFMPEG:
        raise AudioError("ffmpeg is not installed (brew install ffmpeg)")
    tmp = dst.with_name(f"{dst.stem}.tmp{dst.suffix}")
    cmd = [FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
           "-vn", "-c:a", "aac", "-b:a", bitrate, "-movflags", "+faststart", str(tmp)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
    if r.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        raise AudioError(f"Could not encode audio: {r.stderr.strip()[-300:] or 'unknown ffmpeg error'}")
    tmp.rename(dst)


def stem_file(song_dir: Path, stem: str) -> Path | None:
    """The stored stem: compressed if it has been, else a legacy WAV."""
    for ext in (STEM_EXT, ".wav"):
        p = song_dir / f"{stem}{ext}"
        if p.exists():
            return p
    return None


def compress_stems(song_dir: Path) -> None:
    """Replace WAV stems with AAC — the analysis is done, only playback needs them now."""
    for stem in STEMS:
        wav = song_dir / f"{stem}.wav"
        if wav.exists():
            encode(wav, song_dir / f"{stem}{STEM_EXT}", STEM_BITRATE[stem])
            wav.unlink()
    for old in (song_dir / "variants").glob("*.wav"):  # renders from before compression
        old.unlink()


@contextmanager
def wav_stems(song_dir: Path, stems: tuple[str, ...] = STEMS) -> Iterator[Path]:
    """A folder holding vocals.wav / backing.wav for the analysis code: the song's own
    folder for legacy WAV stems, else a temporary decode that is deleted afterwards."""
    if all((song_dir / f"{s}.wav").exists() for s in stems):
        yield song_dir
        return
    tmp = Path(tempfile.mkdtemp(prefix=".decode-", dir=song_dir))
    try:
        for stem in stems:
            src = stem_file(song_dir, stem)
            if src:
                to_wav(src, tmp / f"{stem}.wav", channels=1 if stem == "vocals" else 2)
        yield tmp
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# Renders are CPU-heavy: one at a time, at low priority, so playback and the
# browser's pitch detection stay smooth.
_render_slot = threading.Lock()
_locks: dict[str, threading.Lock] = {}
# Renders in flight: output path → progress 0..1 (or -1 while waiting for the slot).
_progress: dict[str, float] = {}


def variant_path(song_dir: Path, stem: str, speed: float, semitones: int) -> Path:
    return song_dir / "variants" / f"{stem}_{speed:g}x_{semitones:+d}{STEM_EXT}"


def render_status(song_dir: Path, stem: str, speed: float, semitones: int) -> dict:
    """How far along a key / speed render is, for the progress bar."""
    if speed == 1 and semitones == 0:
        return {"state": "ready", "progress": 1.0}
    out = variant_path(song_dir, stem, speed, semitones)
    p = _progress.get(str(out))
    if p is not None:
        return {"state": "queued", "progress": 0.0} if p < 0 else {"state": "rendering", "progress": round(p, 3)}
    return {"state": "ready" if out.exists() else "none", "progress": 1.0 if out.exists() else 0.0}


def _run_rubberband(cmd: list[str], key: str) -> None:
    """Rubber Band prints 0..100% twice (study pass, then processing): turn that into progress."""
    import re

    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, preexec_fn=lambda: os.nice(10))
    assert proc.stderr
    pass_no, buf, tail = 0, b"", b""
    pct = re.compile(rb"(\d+)%")
    while chunk := proc.stderr.read(64):
        buf += chunk
        tail = (tail + chunk)[-600:]
        *done, buf = re.split(rb"[\r\n]", buf)
        for line in done:
            if b"Pass 2" in line:
                pass_no = 1
            if m := pct.search(line):
                done_pct = int(m.group(1)) / 100  # the study pass is quick, processing is the bulk
                _progress[key] = 0.08 + (0.1 * done_pct if pass_no == 0 else 0.1 + 0.77 * done_pct)
    if proc.wait(timeout=900) != 0:
        raise AudioError(f"rubberband failed: {tail.decode(errors='replace').strip()[-300:]}")
_locks_guard = threading.Lock()


def render_variant(song_dir: Path, stem: str, speed: float, semitones: int) -> Path:
    """Time-stretch and/or pitch-shift a stem with Rubber Band. Cached per (stem, speed, semitones)."""
    src = stem_file(song_dir, stem)
    if src is None:
        raise AudioError("stem not found")
    if speed == 1 and semitones == 0:
        return src
    out = variant_path(song_dir, stem, speed, semitones)
    out_dir = out.parent
    out_dir.mkdir(exist_ok=True)
    key = str(out)
    with _locks_guard:
        lock = _locks.setdefault(str(out), threading.Lock())
    with lock:
        if out.exists():
            os.utime(out)  # recently used: kept longest when the cache is trimmed
            return out
        _progress[key] = -1  # waiting for the render slot
        _render_slot.acquire()
        _progress[key] = 0.02
        fd, name = tempfile.mkstemp(suffix=".wav", dir=out_dir)
        os.close(fd)
        tmp = Path(name)
        try:
            with wav_stems(song_dir, (stem,)) as wd:
                wav = wd / f"{stem}.wav"
                _progress[key] = 0.08
                if RUBBERBAND:
                    cmd = [RUBBERBAND, "-3", "-T", f"{speed:g}", "-p", str(semitones)]
                    if stem == "vocals":
                        cmd.append("-F")
                    _run_rubberband([*cmd, str(wav), str(tmp)], key)
                else:  # slower, lower quality fallback
                    import librosa

                    y, sr = sf.read(str(wav), dtype="float32", always_2d=True)
                    chans = []
                    for ch in y.T:
                        if speed != 1:
                            ch = librosa.effects.time_stretch(ch, rate=speed)
                        if semitones:
                            ch = librosa.effects.pitch_shift(ch, sr=sr, n_steps=semitones)
                        chans.append(ch)
                    write_wav(tmp, np.stack(chans), sr)
            _progress[key] = 0.96
            encode(tmp, out, STEM_BITRATE[stem])
        finally:
            tmp.unlink(missing_ok=True)
            _progress.pop(key, None)
            _render_slot.release()
    return out
