"""Songs analysed on the singer's own device instead of waiting in the server's queue.

1. start(): the server fetches the YouTube audio (light work, no queue) and hands it
   to the browser — or start_upload(): the singer sends their own audio file.
2. The browser separates the vocals (Demucs, same model as here) and tracks their
   pitch (CREPE "full", same model as here) itself.
3. accept(): the result is checked against the original before it's kept — the
   stems must add back up to the song and be the right length, there must be a
   voice, and the pitch must match that voice. Then it's finished like any other
   song (notes, tempo, dynamics, compressed stems), listed for search and copied to
   the VPS. A result that fails a check is thrown away; the song can still go
   through the server queue.
"""

from __future__ import annotations

import json
import shutil
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import audio, catalog, jobs, remote, storage, worker, youtube
from .config import CONFIG

SR = audio.ANALYSIS_SR
PITCH_SR, PITCH_HOP = 16000, 160
FORGET_AFTER = 3 * 3600  # an abandoned device analysis is cleaned up after this


class Rejected(Exception):
    """The device's result doesn't hold up; nothing is kept."""


@dataclass
class DeviceJob:
    id: str
    video_id: str | None
    upload: Path | None = None  # the singer's own file (instead of a YouTube video)
    state: str = "fetching"  # fetching → ready → checking → finishing → done | failed
    progress: float = 0.0
    message: str = "getting the song"
    title: str | None = None
    artist: str | None = None
    duration: float | None = None
    error: str | None = None
    started: float = field(default_factory=time.time)
    touched: float = field(default_factory=time.time)

    def public(self) -> dict:
        return {k: getattr(self, k) for k in ("id", "state", "progress", "message", "title", "artist", "duration", "error")}


JOBS: dict[str, DeviceJob] = {}
_lock = threading.Lock()


def work_dir(song_id: str) -> Path:
    """Kept apart from the song's own folder until the result is accepted."""
    return CONFIG.data_dir / "device" / song_id


def start(song_id: str, video_id: str) -> dict:
    with _lock:
        _forget_old()
        job = JOBS.get(song_id)
        if job and job.state not in {"failed", "done"}:
            job.touched = time.time()
            return job.public()  # already being fetched / analysed (maybe by someone else too)
        job = JOBS[song_id] = DeviceJob(id=song_id, video_id=video_id)
    threading.Thread(target=_fetch, args=(job,), daemon=True, name=f"device-fetch-{song_id}").start()
    return job.public()


def start_upload(song_id: str, path: Path, name: str) -> dict:
    """Like start(), from an audio file the singer sent (already saved at `path`)."""
    with _lock:
        _forget_old()
        job = JOBS.get(song_id)
        if job and job.state not in {"failed", "done"}:
            job.touched = time.time()
            path.unlink(missing_ok=True)
            return job.public()
        title, artist = upload_names(name)
        job = JOBS[song_id] = DeviceJob(id=song_id, video_id=None, upload=path, title=title, artist=artist, message="reading your file")
    threading.Thread(target=_fetch, args=(job,), daemon=True, name=f"device-upload-{song_id}").start()
    return job.public()


def upload_names(filename: str) -> tuple[str, str | None]:
    """"Artist - Title.mp3" → (Title, Artist); otherwise the file's name is the title."""
    stem = Path(filename or "my song").stem.replace("_", " ").strip() or "my song"
    if " - " in stem:
        artist, title = (p.strip() for p in stem.split(" - ", 1))
        if artist and title:
            return title, artist
    return stem, None


def status(song_id: str) -> dict | None:
    job = JOBS.get(song_id)
    if job:
        job.touched = time.time()
    return job.public() if job else None


def source_file(song_id: str) -> Path | None:
    job = JOBS.get(song_id)
    f = work_dir(song_id) / "source.m4a"
    return f if job and job.state != "failed" and f.exists() else None


def _fetch(job: DeviceJob) -> None:
    wd = work_dir(job.id)
    shutil.rmtree(wd, ignore_errors=True)
    wd.mkdir(parents=True)
    try:
        def progress(frac: float, msg: str) -> None:
            job.progress, job.message = round(0.9 * frac, 3), msg

        if job.upload:
            src = wd / f"upload{job.upload.suffix}"
            shutil.move(str(job.upload), src)
        else:
            src, meta = youtube.fetch(job.video_id, wd, CONFIG.max_duration_min * 60, progress, lambda p: None,
                                      on_duration=lambda d: setattr(job, "duration", d))
            job.title, job.artist = meta.get("title"), meta.get("artist")
        job.message = "preparing the audio"
        audio.to_wav(src, wd / "mix.wav")  # the original, to check the result against
        info = audio.info(wd / "mix.wav")
        if info["duration"] < 5:
            raise RuntimeError("Audio is too short to analyse.")
        if info["duration"] > CONFIG.max_duration_min * 60:
            raise RuntimeError(f"Songs can be up to {CONFIG.max_duration_min:g} minutes long.")
        job.duration = round(info["duration"], 3)
        audio.encode(wd / "mix.wav", wd / "source.m4a", "192k")  # what the browser analyses
        src.unlink(missing_ok=True)
        job.state, job.progress, job.message = "ready", 1.0, "ready"
        worker.log(f"device job {job.id}: audio ready for the browser")
    except Exception as e:
        job.state, job.error, job.message = "failed", str(e), "failed"
        worker.log(f"device job {job.id}: fetching failed: {e}")
        shutil.rmtree(wd, ignore_errors=True)


def _forget_old() -> None:
    now = time.time()
    for sid, job in list(JOBS.items()):
        if now - job.touched > FORGET_AFTER and job.state in {"ready", "failed", "done", "fetching"}:
            JOBS.pop(sid, None)
            shutil.rmtree(work_dir(sid), ignore_errors=True)


# ---- the result --------------------------------------------------------------------------


def accept(song_id: str, vocals: tuple[bytes, str], backing: tuple[bytes, str], f0: bytes, periodicity: bytes) -> dict:
    """Check a device's result and, if it holds up, finish the song (in the background)."""
    job = JOBS.get(song_id)
    if not job or job.state not in {"ready", "failed"} or not (work_dir(song_id) / "mix.wav").exists():
        raise Rejected("This analysis has expired — please start again.")
    d = jobs.song_dir(song_id)
    if (d / "reference.json").exists() or remote.has(song_id):
        job.state, job.progress, job.message = "done", 1.0, "ready"
        return job.public()
    wd = work_dir(song_id)
    job.state, job.progress, job.message, job.error = "checking", 0.0, "checking the result", None
    try:
        for name, (data, ext) in (("vocals", vocals), ("backing", backing)):
            up = wd / f"upload-{name}{ext}"
            up.write_bytes(data)
            audio.to_wav(up, wd / f"{name}.wav")
            up.unlink()
        f0s = np.frombuffer(f0, dtype="<f4").copy()
        pers = np.frombuffer(periodicity, dtype="<f4").copy()
        voc, bak, f0s, pers = check(wd / "mix.wav", wd / "vocals.wav", wd / "backing.wav", f0s, pers)
        audio.write_wav(wd / "vocals.wav", voc, SR)  # lined up with the original
        audio.write_wav(wd / "backing.wav", bak, SR)
        del voc, bak
    except Rejected as e:
        job.state, job.error, job.message = "ready", str(e), "the result didn't pass the checks"
        worker.log(f"device job {song_id}: rejected: {e}")
        raise
    except audio.AudioError as e:
        job.state, job.error = "ready", str(e)
        raise Rejected(f"The uploaded audio couldn't be read: {e}") from e
    np.save(wd / "f0.npy", f0s)
    np.save(wd / "periodicity.npy", pers)
    job.state, job.progress, job.message = "finishing", 0.05, "finishing up"
    threading.Thread(target=_finish, args=(job,), daemon=True, name=f"device-finish-{song_id}").start()
    return job.public()


def _finish(job: DeviceJob) -> None:
    def on_progress(msg: dict) -> None:
        if "progress" in msg:
            lo, hi = jobs.SPANS["finishing"]
            job.progress = round(0.05 + 0.95 * (msg["progress"] - lo) / max(1e-6, hi - lo), 3)
        if msg.get("message"):
            job.message = msg["message"]

    d = jobs.song_dir(job.id)
    try:
        worker.run(finish_in_worker, job.id, {"title": job.title, "artist": job.artist, "kind": "upload" if job.upload else "youtube"}, job.duration,
                   on_progress=on_progress, heavy=False)
        catalog.finish(d)
        remote.push_later(d)
        storage.trim()
        job.state, job.progress, job.message = "done", 1.0, "ready"
        worker.log(f"device job {job.id}: done")
    except Exception as e:
        job.state, job.error, job.message = "failed", str(e), "failed"
        worker.log(f"device job {job.id}: finishing failed: {e}")
        if not (d / "reference.json").exists():
            shutil.rmtree(d, ignore_errors=True)
    finally:
        shutil.rmtree(work_dir(job.id), ignore_errors=True)


def finish_in_worker(song_id: str, meta: dict, duration: float, send) -> float:
    """Runs in a worker process: the same last steps as a server analysis."""
    from . import melody

    t_start = time.time()
    job = jobs._Progress(send)
    job.set("finishing", 0.05, "building the melody")
    wd, d = work_dir(song_id), jobs.song_dir(song_id)
    d.mkdir(parents=True, exist_ok=True)
    for name in ("vocals", "backing"):
        shutil.move(str(wd / f"{name}.wav"), d / f"{name}.wav")
    midi, conf = melody.contour_from_device(d / "vocals.wav", np.load(wd / "f0.npy"), np.load(wd / "periodicity.npy"))
    return jobs.build_reference(song_id, d, meta, meta.get("kind", "youtube"), duration, midi, conf,
                                "demucs + crepe-full (on a device)", t_start, job,
                                extra={"analysedOn": "device"})


# ---- checks --------------------------------------------------------------------------------


def _read(path: Path) -> np.ndarray:
    import soundfile as sf

    x, sr = sf.read(str(path), dtype="float32", always_2d=True)
    if sr != SR:
        raise Rejected("unexpected sample rate")
    return x.T  # (channels, samples)


def _fit(x: np.ndarray, n: int) -> np.ndarray:
    return x[:, :n] if x.shape[1] >= n else np.pad(x, ((0, 0), (0, n - x.shape[1])))


def _lag(a: np.ndarray, b: np.ndarray, max_lag: int = 4096) -> int:
    """How many samples b is late (+) or early (−) against a — encoders and decoders
    add or drop a little at the start — measured on the loudest 10 seconds."""
    from scipy.signal import correlate

    n = min(len(a), len(b))
    seg = 10 * SR
    if n < seg + 2 * max_lag:
        return 0
    block = SR // 4
    energy = (a[: n // block * block].reshape(-1, block) ** 2).sum(1)
    run = np.convolve(energy, np.ones(40), mode="valid")  # 10 s of blocks
    start = min(int(np.argmax(run)) * block, n - seg - 2 * max_lag)
    x = a[start + max_lag : start + max_lag + seg]
    y = b[start : start + seg + 2 * max_lag]
    c = correlate(y, x, mode="valid", method="fft")  # c[k] = sum x[t] * y[t + k]
    return int(np.argmax(c)) - max_lag


def _shift(x: np.ndarray, lag: int) -> np.ndarray:
    """Undo a delay of `lag` samples (negative: x starts early) on the last axis."""
    if lag > 0:
        return x[..., lag:]
    if lag < 0:
        pad = [(0, 0)] * (x.ndim - 1) + [(-lag, 0)]
        return np.pad(x, pad)
    return x


def check(mix_path: Path, vocals_path: Path, backing_path: Path, f0: np.ndarray, periodicity: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Raise Rejected unless the stems and pitch really belong to this song. Returns them
    lined up with the original: (vocals, music, f0, periodicity)."""
    mix = _read(mix_path)
    n = mix.shape[1]
    voc, bak = _read(vocals_path), _read(backing_path)
    for name, x in (("vocals", voc), ("music", bak)):
        if abs(x.shape[1] - n) > 0.5 * SR + 3000:
            raise Rejected(f"The {name} part is {x.shape[1] / SR:.1f} s long; the song is {n / SR:.1f} s.")
    if voc.shape[0] == 1:
        voc = np.repeat(voc, 2, 0)
    if bak.shape[0] == 1:
        bak = np.repeat(bak, 2, 0)
    m = max(voc.shape[1], bak.shape[1])
    voc, bak = _fit(voc, m), _fit(bak, m)
    rec = voc + bak
    lag = _lag(mix.mean(0), rec.mean(0))
    voc, bak, rec = (_fit(_shift(x, lag), n) for x in (voc, bak, rec))

    power = float(np.mean(mix**2)) + 1e-12
    residual_db = 10 * np.log10(float(np.mean((mix - rec) ** 2)) / power + 1e-12)
    if residual_db > -15:  # a real result is about −25 dB (lossy upload included)
        raise Rejected(f"The separated parts don't add back up to the song ({residual_db:.0f} dB off).")
    vocal_db = 10 * np.log10(float(np.mean(voc**2)) / power + 1e-12)
    if vocal_db < -40:
        raise Rejected("No singing was found in the separated vocals.")
    if not np.isfinite(voc).all() or not np.isfinite(bak).all():
        raise Rejected("The separated audio is damaged.")

    frames = 1 + int(round(n * PITCH_SR / SR)) // PITCH_HOP
    if abs(len(f0) - frames) > 12 or len(f0) != len(periodicity):
        raise Rejected(f"The pitch track has {len(f0)} frames; expected {frames}.")
    shift = round(lag * 100 / SR)  # the pitch was worked out from the same (shifted) audio
    f0 = _fit(_shift(f0[None], shift), frames)[0]
    periodicity = _fit(_shift(periodicity[None], shift), frames)[0]
    if not (np.isfinite(f0).all() and np.isfinite(periodicity).all()):
        raise Rejected("The pitch track is damaged.")
    if f0.min() < 0 or f0.max() > 2100 or periodicity.min() < 0 or periodicity.max() > 1.0001:
        raise Rejected("The pitch track is out of range.")
    agree = pitch_agreement(voc.mean(0), f0, periodicity)
    if agree is not None and agree < 0.7:
        raise Rejected(f"The pitch track doesn't match the vocals (only {agree:.0%} agree).")
    return voc, bak, f0, periodicity


def pitch_agreement(vocals: np.ndarray, f0: np.ndarray, periodicity: np.ndarray) -> float | None:
    """Share of confidently-pitched frames where a quick independent pitch tracker (YIN)
    lands within a semitone of the device's pitch — octave slips forgiven. None when
    there's too little clear singing to tell."""
    import librosa

    y = librosa.resample(vocals.astype(np.float32), orig_sr=SR, target_sr=PITCH_SR)
    sure = periodicity > 0.8
    if sure.sum() < 300:
        return None
    # three 8-second windows with the most clear singing
    win = 800
    density = np.convolve(sure.astype(float), np.ones(win), mode="valid")
    picks: list[int] = []
    for i in np.argsort(-density):
        if all(abs(i - p) >= win for p in picks):
            picks.append(int(i))
        if len(picks) == 3:
            break
    hits = total = 0
    for p in picks:
        seg = y[p * PITCH_HOP : (p + win) * PITCH_HOP + 1024]
        if len(seg) < 2048:
            continue
        yin = librosa.yin(seg, fmin=65, fmax=1100, sr=PITCH_SR, frame_length=1024, hop_length=PITCH_HOP, center=True)
        dev = f0[p : p + len(yin)]
        ok = sure[p : p + len(yin)] & (dev > 0)
        m = min(len(yin), len(dev))
        ok, a, b = ok[:m], dev[:m], yin[:m]
        if not ok.any():
            continue
        cents = 1200 * np.log2(a[ok] / b[ok])
        folded = np.abs((cents + 600) % 1200 - 600)  # octave slips are fine
        hits += int((folded < 100).sum())
        total += int(ok.sum())
    return hits / total if total >= 100 else None
