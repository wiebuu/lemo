"""Background analysis jobs: fetch → preprocess → separate → melody → finish.
One job runs at a time, in its own process (see worker.py); results are cached on disk per song."""

from __future__ import annotations

import json
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from . import audio, catalog, melody, remote, separation, storage, worker, youtube
from .config import CONFIG

# Overall progress span per stage.
SPANS = {
    "queued": (0.0, 0.0),
    "fetching": (0.0, 0.15),
    "preprocessing": (0.15, 0.2),
    "separating": (0.2, 0.75),
    "melody": (0.75, 0.95),
    "finishing": (0.95, 1.0),
    "done": (1.0, 1.0),
}


# ---- how long it takes -----------------------------------------------------------------------
# Seconds of work per second of audio, per stage, on this machine. Starts from
# measurements on an M-series Mac (≈1.4× the song's length in all) and is
# re-learned from every finished song (data/timing.json).
ORDER = ["fetching", "preprocessing", "separating", "melody", "finishing"]
DEFAULT_RATES = {"fetching": 0.05, "preprocessing": 0.02, "separating": 0.25, "melody": 1.0, "finishing": 0.11}
FETCH_FIXED = 8.0  # reading video info etc., whatever the length
TYPICAL_SONG = 240.0  # until the length is known
_rates_lock = threading.Lock()


def _rates_file() -> Path:
    return CONFIG.data_dir / "timing.json"


def rates() -> dict[str, float]:
    try:
        saved = json.loads(_rates_file().read_text())
    except (OSError, json.JSONDecodeError):
        saved = {}
    return {k: float(saved.get(k, v)) for k, v in DEFAULT_RATES.items()}


def learn(stage_secs: dict[str, float], duration: float) -> None:
    """Fold one finished song's stage times into the estimate (moving average)."""
    if duration < 20:
        return
    with _rates_lock:
        r = rates()
        for st, secs in stage_secs.items():
            if st in r and secs > 0:
                rate = max(0.0, secs - (FETCH_FIXED if st == "fetching" else 0)) / duration
                r[st] = round(0.7 * r[st] + 0.3 * min(rate, 10 * DEFAULT_RATES[st] + 1), 4)
        _rates_file().write_text(json.dumps(r, indent=1))


def estimate_total(duration: float | None) -> float:
    """Whole analysis, start to finish, in seconds."""
    d = duration or TYPICAL_SONG
    return FETCH_FIXED + sum(rates().values()) * d


@dataclass
class Job:
    id: str
    stage: str = "queued"
    progress: float = 0.0
    message: str = "waiting"
    error: str | None = None
    title: str | None = None
    duration: float | None = None  # the song's length, once known
    eta: float | None = None  # seconds left (estimate)
    cancel: threading.Event = field(default_factory=threading.Event, repr=False)
    started: float = 0.0
    stage_started: float = 0.0
    stage_secs: dict = field(default_factory=dict, repr=False)
    eta_at: float = 0.0  # when eta was last estimated

    def public(self) -> dict:
        out = {k: getattr(self, k) for k in ("id", "stage", "progress", "message", "error", "title", "duration")}
        if self.eta is None:
            out["eta"] = None
        elif self.stage in ORDER:
            # between progress reports (melody tracking reports every 30 s of audio) keep counting
            # down with the clock, so the bar never looks stuck — but never claim it's finished
            since = time.time() - self.eta_at
            left = max(self.eta * 0.08, self.eta - since, 3.0)
            elapsed = time.time() - self.started
            out["eta"] = round(left)
            out["progress"] = round(min(0.99, elapsed / max(1e-6, elapsed + left)), 3)
        else:
            out["eta"] = round(self.eta)
        return out

    def update_eta(self, stage_fraction: float) -> None:
        """Seconds left: the current stage (blending the learned rate with how fast it's
        actually going) plus the stages after it. Progress is then time-based."""
        now = time.time()
        if self.stage not in ORDER:
            return
        r = rates()
        d = self.duration or TYPICAL_SONG
        planned = r[self.stage] * d + (FETCH_FIXED if self.stage == "fetching" else 0)
        spent = now - self.stage_started
        if stage_fraction > 0.15:
            planned = 0.5 * planned + 0.5 * (spent / stage_fraction)
        later = sum(r[s] * d for s in ORDER[ORDER.index(self.stage) + 1 :])
        self.eta = max(0.0, planned - spent) + later
        self.eta_at = now
        elapsed = now - self.started
        self.progress = round(min(0.99, elapsed / max(1e-6, elapsed + self.eta)), 3)


def song_dir(song_id: str) -> Path:
    return CONFIG.data_dir / "songs" / song_id


class JobManager:
    def __init__(self) -> None:
        self.jobs: dict[str, Job] = {}
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="lemo-job")
        self.lock = threading.Lock()

    def status(self, song_id: str) -> dict | None:
        job = self.jobs.get(song_id)
        if job and not (job.stage == "done" and not (song_dir(song_id) / "reference.json").exists()):
            out = job.public()
            if job.stage == "queued":
                # waiting behind other songs: their time left, then this one
                ahead = [j for j in self.jobs.values() if j is not job and j.stage not in {"queued", "done", "failed", "cancelled"}]
                ahead += [j for j in list(self.jobs.values())[: list(self.jobs).index(song_id)] if j.stage == "queued"]
                out["ahead"] = len(ahead)
                out["eta"] = round(sum(j.eta if j.eta is not None else estimate_total(j.duration) for j in ahead) + estimate_total(job.duration))
            return out
        if (song_dir(song_id) / "reference.json").exists() or remote.has(song_id):
            return {"id": song_id, "stage": "done", "progress": 1, "message": "ready", "error": None, "title": None}
        return None

    def submit(self, song_id: str, source: dict) -> dict:
        """source: {"kind": "youtube", "videoId": ...} or {"kind": "upload", "path": ..., "name": ...}"""
        with self.lock:
            existing = self.jobs.get(song_id)
            if existing and existing.stage not in {"failed", "cancelled", "done"}:
                return existing.public()
            if (song_dir(song_id) / "reference.json").exists() or remote.has(song_id):
                return self.status(song_id)  # already analysed (here or on the VPS)
            job = Job(id=song_id, title=source.get("name"))
            self.jobs[song_id] = job
        self.pool.submit(self._run, job, source)
        return job.public()

    def queue(self) -> dict:
        active = [j for j in self.jobs.values() if j.stage not in {"done", "failed", "cancelled"}]
        wait = sum(j.eta if j.eta is not None else estimate_total(j.duration) for j in active)
        return {"songs": len(active), "waitSec": round(wait)}

    def busy(self) -> bool:
        return any(j.stage not in {"done", "failed", "cancelled"} for j in self.jobs.values())

    def cancel(self, song_id: str) -> dict | None:
        job = self.jobs.get(song_id)
        if not job:
            return self.status(song_id)
        job.cancel.set()  # the job thread stops its worker process
        if job.stage == "queued":
            job.stage = "cancelled"
        return job.public()

    def _run(self, job: Job, source: dict) -> None:
        """Runs in the job thread; the actual work happens in a separate process."""
        d = song_dir(job.id)

        def on_progress(msg: dict) -> None:
            now = time.time()
            if msg.get("duration"):
                job.duration = float(msg["duration"])
            stage = msg.get("stage")
            if stage and stage != job.stage:
                if job.stage in ORDER:
                    job.stage_secs[job.stage] = now - job.stage_started
                job.stage, job.stage_started = stage, now
            for k in ("message", "title"):
                if k in msg:
                    setattr(job, k, msg[k])
            lo, hi = SPANS.get(job.stage, (0.0, 1.0))
            raw = msg.get("progress")
            frac = (raw - lo) / (hi - lo) if raw is not None and hi > lo else 0.0
            job.update_eta(max(0.0, min(1.0, frac)))

        try:
            job.message = "waiting for the analyser" if worker.HEAVY.locked() else job.message
            job.started = job.stage_started = time.time()
            job.update_eta(0.0)
            worker.log(f"job {job.id} started")
            seconds = worker.run(analyse, job.id, source, on_progress=on_progress, cancel=job.cancel)
            if job.stage in ORDER:
                job.stage_secs[job.stage] = time.time() - job.stage_started
            if job.duration:
                learn(job.stage_secs, job.duration)
            job.stage, job.progress, job.message, job.eta = "done", 1.0, f"done in {seconds:.0f}s", 0
            worker.log(f"job {job.id} done in {seconds:.0f}s · stages " + ", ".join(f"{k} {v:.0f}s" for k, v in job.stage_secs.items()))
            catalog.finish(d)  # 10-second preview + searchable
            remote.push_later(d)  # keep it safe on the VPS (when one is set up)
            storage.trim()
            from . import lyrics_prep  # (imports this module)

            e = catalog.load().get(job.id, {})
            lyrics_prep.for_song(job.id, e.get("title"), e.get("artist"))  # its lyrics, found and timed
        except worker.Cancelled:
            job.stage, job.message = "cancelled", "cancelled"
            worker.log(f"job {job.id} cancelled")
            shutil.rmtree(d, ignore_errors=True)
        except Exception as e:  # report, never fabricate results
            worker.log(f"job {job.id} failed: {e}")
            job.stage, job.error, job.message = "failed", str(e), "failed"
            if not (d / "reference.json").exists():
                shutil.rmtree(d, ignore_errors=True)


class _Progress:
    """Job progress inside the worker process, sent back to the server."""

    def __init__(self, send) -> None:
        self.send = send
        self.proc = None
        self.title = None

    def set(self, stage: str, frac: float, message: str) -> None:
        lo, hi = SPANS.get(stage, (0, 1))
        self.send({"stage": stage, "progress": round(lo + (hi - lo) * max(0.0, min(1.0, frac)), 3), "message": message})

    def set_title(self, title: str | None) -> None:
        self.title = title
        self.send({"title": title})


def analyse(song_id: str, source: dict, send) -> float:
    """fetch → preprocess → separate → melody → finish. Runs in a worker process;
    returns the time it took."""
    from .config import torch_device

    job = _Progress(send)
    d = song_dir(song_id)
    if (d / "reference.json").exists() or remote.has(song_id):
        return 0.0  # finished meanwhile (analysed on someone's device)
    d.mkdir(parents=True, exist_ok=True)
    t_start = time.time()
    device = torch_device()
    meta: dict = {}
    if source["kind"] == "youtube":
        src, meta = youtube.fetch(
            source["videoId"], d, CONFIG.max_duration_min * 60,
            lambda f, m: job.set("fetching", f, m), lambda p: None,
            on_duration=lambda dur: send({"duration": dur}),
        )
        if source.get("title"):  # featured songs carry clean names
            meta.update(title=source["title"], artist=source.get("artist"))
        job.set_title(meta.get("title"))
    else:
        src = Path(source["path"])
        meta = {"title": Path(source.get("name") or "upload").stem, "artist": None}
        job.set("fetching", 1, "upload received")

    job.set("preprocessing", 0, "converting audio")
    mix = d / "mix.wav"
    audio.to_wav(src, mix)
    info = audio.info(mix)
    send({"duration": info["duration"]})
    if info["duration"] > CONFIG.max_duration_min * 60:
        raise RuntimeError(f"Audio is longer than {CONFIG.max_duration_min:g} minutes.")
    if info["duration"] < 5:
        raise RuntimeError("Audio is too short to analyse.")

    job.set("separating", 0, "separating vocals")
    separation.separate_vocals(
        mix, d / "vocals.wav", d / "backing.wav", device,
        lambda f, m: job.set("separating", f, m), lambda: False,
    )
    separation.unload()
    mix.unlink(missing_ok=True)  # not needed any more; frees disk while the rest runs

    job.set("melody", 0, "tracking pitch")
    midi, conf = melody.extract_contour(
        d / "vocals.wav", CONFIG.melody_model, device,
        lambda f, m: job.set("melody", f, m), lambda: False,
    )
    for f in d.glob("source.*"):  # the original download isn't needed anymore
        f.unlink()
    return build_reference(song_id, d, meta, source["kind"], info["duration"], midi, conf,
                           f"demucs + {CONFIG.melody_model}", t_start, job)


def build_reference(song_id: str, d: Path, meta: dict, kind: str, duration: float, midi, conf,
                    melody_source: str, t_start: float, job, extra: dict | None = None) -> float:
    """From the vocal contour to a finished song: notes, tempo, dynamics, compressed
    stems, reference.json. Shared by server analysis and analysis done on a device."""
    smoothed = melody.median_filter_voiced(midi, 5)
    notes = melody.segment_notes(smoothed, conf)

    job.set("finishing", 0.2, "estimating tempo")
    tempo, first_beat = melody.estimate_tempo(d / "backing.wav")

    warnings = []
    if len(notes) < 10:
        warnings.append("Very few vocal notes were found — is this an instrumental, or is the vocal heavily processed?")
    ref = {
        "id": song_id,
        "title": meta.get("title") or song_id,
        "artist": meta.get("artist"),
        "duration": round(duration, 3),
        "notes": notes,
        "contour": melody.contour_json(smoothed),
        "lyrics": [],
        "lyricsTiming": "none",
        "sourceType": kind,
        "analysisStatus": "ready" if notes else "partial",
        "melodySource": melody_source,
        "tempo": tempo,
        "firstBeat": first_beat,
        "beatsPerBar": 4,
        "warnings": warnings,
        "createdAt": int(time.time()),
        "analysisSeconds": round(time.time() - t_start, 1),
        **(extra or {}),
    }
    job.set("finishing", 0.5, "measuring dynamics and harmony")
    melody.add_expression_data(ref, d)
    job.set("finishing", 0.8, "compressing audio")
    audio.compress_stems(d)
    (d / "reference.json").write_text(json.dumps(ref))
    storage.touch(d)
    return ref["analysisSeconds"]


MANAGER = JobManager()
