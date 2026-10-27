"""Reference melody extraction: pitch contour (CREPE or pYIN) on the isolated
vocal, then segmentation into note events. Segmentation is pure numpy and
unit-tested."""

from __future__ import annotations

from pathlib import Path
from typing import Callable

import numpy as np

HOP_SEC = 0.01
SR = 16000
HOP = int(SR * HOP_SEC)


def hz_to_midi(f: np.ndarray) -> np.ndarray:
    with np.errstate(divide="ignore", invalid="ignore"):
        return 69 + 12 * np.log2(f / 440.0)


def extract_contour(
    vocals_path: Path,
    model: str,
    device: str,
    progress: Callable[[float, str], None],
    cancelled: Callable[[], bool],
) -> tuple[np.ndarray, np.ndarray]:
    """Returns (midi per 10 ms frame with NaN = unvoiced, confidence 0..1)."""
    import librosa

    y, _ = librosa.load(str(vocals_path), sr=SR, mono=True)
    n_frames = 1 + len(y) // HOP

    if model.startswith("crepe"):
        f0, conf = _crepe(y, model.split("-")[1] if "-" in model else "full", device, progress, cancelled)
        voiced = conf > 0.45
    else:
        progress(0.0, "tracking pitch (pYIN)")
        f0, voiced, conf = librosa.pyin(y, fmin=65, fmax=1100, sr=SR, frame_length=1024, hop_length=HOP)
        conf = np.nan_to_num(conf)
        voiced = voiced & (conf > 0.3)

    return gate_contour(y, f0, conf, voiced)


def contour_from_device(vocals_path: Path, f0: np.ndarray, periodicity: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The same contour as extract_contour(crepe), from pitch a browser worked out
    (CREPE "full", Viterbi-decoded — before the filters, which are applied here)."""
    import librosa

    y, _ = librosa.load(str(vocals_path), sr=SR, mono=True)
    per = nan_median3(periodicity.astype(np.float32))
    pitch = nan_mean3(f0.astype(np.float32))
    return gate_contour(y, pitch, per, per > 0.45)


def nan_median3(x: np.ndarray) -> np.ndarray:
    """torchcrepe.filter.median(x, 3) without torch: NaN-aware, edges reflected."""
    mask = ~np.isnan(x)
    v = np.pad(np.where(mask, x, 0), 1, mode="reflect")
    m = np.pad(mask, 1, mode="constant")
    w = np.lib.stride_tricks.sliding_window_view(v, 3)
    wm = np.lib.stride_tricks.sliding_window_view(m, 3)
    srt = np.sort(np.where(wm, w, np.inf), axis=-1)
    idx = np.clip((wm.sum(-1) - 1) // 2, 0, None)
    out = np.take_along_axis(srt, idx[:, None], -1)[:, 0]
    out[np.isinf(out)] = np.nan
    return out.astype(np.float32)


def nan_mean3(x: np.ndarray) -> np.ndarray:
    """torchcrepe.filter.mean(x, 3) without torch: NaN-aware moving average."""
    mask = ~np.isnan(x)
    k = np.ones(3, np.float32)
    total = np.convolve(np.where(mask, x, 0), k, mode="same")
    count = np.maximum(np.convolve(mask.astype(np.float32), k, mode="same"), 1)
    out = (total / count).astype(np.float32)
    out[out == 0] = np.nan
    return out


def gate_contour(y: np.ndarray, f0: np.ndarray, conf: np.ndarray, voiced: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    import librosa

    n_frames = 1 + len(y) // HOP
    f0 = f0[:n_frames]
    conf = conf[:n_frames]
    voiced = voiced[:n_frames]

    # Energy gate: ignore separation bleed and breaths far below the vocal level.
    rms = librosa.feature.rms(y=y, frame_length=4 * HOP, hop_length=HOP, center=True)[0][: len(f0)]
    db = 20 * np.log10(rms + 1e-9)
    loud = db > (np.percentile(db, 95) - 35)
    midi = hz_to_midi(np.where(voiced[: len(loud)] & loud, f0[: len(loud)], np.nan))
    return midi, conf[: len(midi)]


def _crepe(y, capacity, device, progress, cancelled):
    import torch
    import torchcrepe

    chunk = 30 * SR
    f0s, confs = [], []
    dev = device
    start = 0
    while start < len(y):
        # A tail shorter than a second rides along with this chunk (a 1-frame chunk breaks the filters).
        end = len(y) if len(y) - (start + chunk) < SR else start + chunk
        if cancelled():
            from .separation import Cancelled

            raise Cancelled()
        seg = torch.from_numpy(y[start:end].copy())[None]
        def run(d):
            return torchcrepe.predict(seg, SR, HOP, 65.0, 1100.0, capacity, batch_size=256, device=d,
                                      decoder=torchcrepe.decode.viterbi, return_periodicity=True)
        try:
            pitch, per = run(dev)
        except Exception:
            if dev == "cpu":
                raise
            dev = "cpu"
            pitch, per = run(dev)
        per = torchcrepe.filter.median(per, 3)
        pitch = torchcrepe.filter.mean(pitch, 3)
        p, c = pitch[0].cpu().numpy(), per[0].cpu().numpy()
        frames = seg.shape[1] // HOP  # drop the padded tail frame so chunks stay aligned
        if end < len(y):
            p, c = p[:frames], c[:frames]
        f0s.append(p)
        confs.append(c)
        progress(end / len(y), f"tracking pitch (crepe-{capacity}, {dev})")
        start = end
    return np.concatenate(f0s), np.concatenate(confs)


def median_filter_voiced(midi: np.ndarray, width: int = 5) -> np.ndarray:
    """Median filter that never bridges unvoiced gaps."""
    out = midi.copy()
    half = width // 2
    n = len(midi)
    for i in range(n):
        if np.isnan(midi[i]):
            continue
        lo, hi = max(0, i - half), min(n, i + half + 1)
        w = midi[lo:hi]
        w = w[~np.isnan(w)]
        out[i] = np.median(w)
    return out


def segment_notes(
    midi: np.ndarray,
    conf: np.ndarray,
    hop: float = HOP_SEC,
    split_semitones: float = 1.0,
    persist_sec: float = 0.08,
    min_dur: float = 0.09,
    min_conf: float = 0.5,
    t0: float = 0.0,
) -> list[dict]:
    """Turn a contour into notes. A note ends at an unvoiced gap, or when the
    pitch moves more than `split_semitones` from the note's median for at least
    `persist_sec` (so vibrato and scoops don't split notes)."""
    n = len(midi)
    persist = max(1, int(round(persist_sec / hop)))
    raw: list[tuple[int, int]] = []
    i = 0
    while i < n:
        if np.isnan(midi[i]):
            i += 1
            continue
        start = i
        j = i + 1
        dev_run = 0
        split_at = None
        while j < n and not np.isnan(midi[j]):
            center = np.median(midi[start : j - dev_run]) if j - dev_run > start else midi[start]
            if abs(midi[j] - center) > split_semitones:
                dev_run += 1
                if dev_run >= persist:
                    split_at = j - dev_run + 1
                    break
            else:
                dev_run = 0
            j += 1
        end = split_at if split_at is not None else j
        raw.append((start, end))
        i = end

    notes: list[dict] = []
    for s, e in raw:
        dur = (e - s) * hop
        if dur < min_dur:
            continue
        seg = midi[s:e]
        c = float(np.mean(conf[s:e]))
        if c < min_conf:
            continue
        note = {"startTime": t0 + s * hop, "endTime": t0 + e * hop, "midiPitch": float(np.median(seg)), "confidence": round(c, 3), "sung": True}
        prev = notes[-1] if notes else None
        if prev and note["startTime"] - prev["endTime"] <= 0.03 and abs(note["midiPitch"] - prev["midiPitch"]) < 0.5:
            prev["endTime"] = note["endTime"]
            continue
        notes.append(note)
    for nt in notes:
        nt["startTime"] = round(nt["startTime"], 3)
        nt["endTime"] = round(nt["endTime"], 3)
        nt["midiPitch"] = round(nt["midiPitch"], 3)
    return notes


def contour_json(midi: np.ndarray, hop: float = HOP_SEC, decimate: int = 2) -> dict:
    m = midi[::decimate]
    return {"t0": 0.0, "hop": hop * decimate, "midi": [None if np.isnan(v) else round(float(v), 2) for v in m]}


def estimate_tempo(backing_path: Path) -> tuple[float | None, float | None]:
    import librosa

    y, sr = librosa.load(str(backing_path), sr=22050, mono=True)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    t = float(np.atleast_1d(tempo)[0])
    if not (50 <= t <= 220) or len(beats) < 8:
        return None, None
    return round(t, 2), round(float(beats[0]), 3)


# ---- dynamics -------------------------------------------------------------------

def vocal_loudness(vocals_path: Path, midi: np.ndarray) -> np.ndarray:
    """Per-10 ms vocal level in dB relative to the median sung level; NaN where unvoiced.
    Relative values only — the absolute level of a mix says nothing about the singer."""
    import librosa

    y, _ = librosa.load(str(vocals_path), sr=SR, mono=True)
    rms = librosa.feature.rms(y=y, frame_length=4 * HOP, hop_length=HOP, center=True)[0]
    db = 20 * np.log10(rms + 1e-9)
    n = min(len(db), len(midi))
    db, voiced = db[:n], ~np.isnan(midi[:n])
    if voiced.sum() < 10:
        return np.full(n, np.nan)
    rel = db - np.median(db[voiced])
    rel[~voiced] = np.nan
    return rel


def attach_note_loudness(notes: list[dict], rel: np.ndarray, hop: float = HOP_SEC) -> None:
    for nt in notes:
        seg = rel[int(nt["startTime"] / hop) : int(nt["endTime"] / hop)]
        seg = seg[~np.isnan(seg)]
        if len(seg) >= 3:
            nt["loudness"] = round(float(np.median(seg)), 1)


def loudness_json(rel: np.ndarray, hop: float = HOP_SEC, decimate: int = 2) -> dict:
    r = rel[::decimate]
    return {"t0": 0.0, "hop": hop * decimate, "db": [None if np.isnan(v) else round(float(v), 1) for v in r]}


# ---- harmony ---------------------------------------------------------------------

_TEMPLATES: list[tuple[list[int], np.ndarray]] = []
for _root in range(12):
    for _ivs in ((0, 4, 7), (0, 3, 7)):  # major, minor triads
        pcs = [(_root + i) % 12 for i in _ivs]
        v = np.zeros(12)
        v[pcs] = 1
        _TEMPLATES.append((pcs, v / np.linalg.norm(v)))


def chords_from_chroma(chroma: np.ndarray, times: np.ndarray, seg: float = 0.5, min_conf: float = 0.8) -> list[dict]:
    """Triad template matching on averaged chroma. Segments that don't clearly match
    a triad are left out — no harmony is claimed where it isn't reliable."""
    out: list[dict] = []
    if chroma.shape[1] == 0:
        return out
    end_t = float(times[-1])
    t = 0.0
    while t < end_t:
        m = (times >= t) & (times < t + seg)
        if m.sum() >= 2:
            v = chroma[:, m].mean(axis=1)
            nv = np.linalg.norm(v)
            if nv > 1e-6:
                v = v / nv
                scores = sorted(((float(v @ tpl), pcs) for pcs, tpl in _TEMPLATES), key=lambda x: -x[0])
                best, pcs = scores[0]
                if best >= min_conf and best - scores[1][0] >= 0.03:
                    prev = out[-1] if out else None
                    if prev and prev["pcs"] == sorted(pcs) and abs(prev["end"] - t) < 1e-6:
                        prev["end"] = round(t + seg, 3)
                        prev["confidence"] = round(min(prev["confidence"], best), 3)
                    else:
                        out.append({"start": round(t, 3), "end": round(t + seg, 3), "pcs": sorted(pcs), "confidence": round(best, 3)})
        t += seg
    return out


def estimate_harmony(backing_path: Path) -> list[dict]:
    import librosa

    y, sr = librosa.load(str(backing_path), sr=22050, mono=True)
    hop = 512
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop)
    rms = librosa.feature.rms(y=y, hop_length=hop)[0][: chroma.shape[1]]
    quiet = 20 * np.log10(rms + 1e-9) < np.percentile(20 * np.log10(rms + 1e-9), 95) - 40
    chroma[:, quiet[: chroma.shape[1]]] = 0
    times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr, hop_length=hop)
    return chords_from_chroma(chroma, times)


def add_expression_data(ref: dict, song_dir: Path) -> dict:
    """Add loudness + harmony to a reference (also used to upgrade older cached songs)."""
    contour = ref.get("contour") or {}
    hop = contour.get("hop", HOP_SEC * 2)
    midi_c = np.array([np.nan if v is None else v for v in contour.get("midi", [])], dtype=float)
    # contour is decimated; expand back to 10 ms frames for the loudness pass
    factor = max(1, int(round(hop / HOP_SEC)))
    midi = np.repeat(midi_c, factor)
    if (song_dir / "vocals.wav").exists() and len(midi):
        rel = vocal_loudness(song_dir / "vocals.wav", midi)
        attach_note_loudness(ref["notes"], rel)
        ref["loudness"] = loudness_json(rel)
    if (song_dir / "backing.wav").exists():
        ref["harmony"] = estimate_harmony(song_dir / "backing.wav")
        ref["harmonySource"] = "estimated"
    ref["expressionVersion"] = 1
    return ref
