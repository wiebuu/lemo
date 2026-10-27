"""Word-level lyric timing by forced alignment to the isolated vocal
(torchaudio MMS_FA — free, multilingual for romanised text). The model
(~1 GB) downloads on first use. Hindi-script words are aligned through their
Hinglish reading; lines with no readable words (e.g. Urdu script) come back as
None so the app can estimate them instead of guessing here."""

from __future__ import annotations

import unicodedata
from pathlib import Path

_model = None


def normalise(word: str) -> str:
    from .translit import DEVA, deva_to_latin

    if DEVA.search(word):  # Hindi script: align its Hinglish reading (same words, same order)
        word = deva_to_latin(word)
    w = unicodedata.normalize("NFKD", word.lower())
    return "".join(c for c in w if "a" <= c <= "z" or c == "'")


def fill_unaligned(words: list[str], times: list[tuple[float, float] | None], line_end: float) -> list[dict]:
    """Words the aligner can't read (numbers, symbols, other scripts) are kept and
    placed in the gap between their aligned neighbours instead of being dropped."""
    out: list[dict] = []
    n = len(words)
    for k, w in enumerate(words):
        t = times[k]
        if t is None:
            prev_end = next((times[j][1] for j in range(k - 1, -1, -1) if times[j]), None)
            next_start = next((times[j][0] for j in range(k + 1, n) if times[j]), None)
            a = prev_end if prev_end is not None else (next_start - 0.3 if next_start is not None else 0.0)
            b = next_start if next_start is not None else min(line_end, a + 0.5)
            t = (a, max(a + 0.05, b))
        out.append({"start": round(t[0], 3), "end": round(t[1], 3), "text": w + (" " if k < n - 1 else "")})
    return out


def _load(device: str):
    global _model
    import torchaudio

    if _model is None:
        bundle = torchaudio.pipelines.MMS_FA
        _model = (bundle.get_model(with_star=False), bundle.get_tokenizer(), bundle.get_aligner())
    m, tok, al = _model
    return m.to(device), tok, al


def align_song(song_dir: str, lines: list[dict], send) -> list[list[dict] | None]:
    """Worker-process entry point (see worker.py)."""
    from .audio import wav_stems
    from .config import torch_device

    with wav_stems(Path(song_dir), ("vocals",)) as wd:
        return align_lines(wd / "vocals.wav", lines, torch_device())


def align_lines(vocals: Path, lines: list[dict], device: str) -> list[list[dict] | None]:
    import librosa
    import torch

    sr = 16000
    y, _ = librosa.load(str(vocals), sr=sr, mono=True)
    dur = len(y) / sr
    dev = device
    model, tokenizer, aligner = _load(dev)
    out: list[list[dict] | None] = []
    for ln in lines:
        start, end, text = ln.get("start"), ln.get("end"), ln.get("text", "")
        words = text.split()
        norms = [normalise(w) for w in words]
        keep = [(w, n) for w, n in zip(words, norms) if n]
        if start is None or end is None or not keep:
            out.append(None)
            continue
        a, b = max(0.0, start - 0.25), min(dur, end + 0.25)
        if b - a < 0.3:
            out.append(None)
            continue
        seg = torch.from_numpy(y[int(a * sr) : int(b * sr)].copy()).unsqueeze(0)
        try:
            with torch.inference_mode():
                try:
                    emission, _ = model(seg.to(dev))
                except Exception:
                    if dev == "cpu":
                        raise
                    dev = "cpu"
                    model = model.to(dev)
                    emission, _ = model(seg.to(dev))
                spans = aligner(emission[0].cpu(), tokenizer([n for _, n in keep]))
        except Exception:
            out.append(None)  # too short for the text, or unalignable — let the app estimate
            continue
        ratio = seg.shape[1] / emission.shape[1] / sr
        it = iter(spans)
        times: list[tuple[float, float] | None] = []
        for nrm in norms:
            if nrm:
                sp = next(it)
                times.append((a + sp[0].start * ratio, a + sp[-1].end * ratio))
            else:
                times.append(None)
        out.append(fill_unaligned(words, times, end))
    return out


# ---- lyrics with no timing at all (pasted by the singer, or a video's description) ----------


def align_plain_song(song_dir: str, lines: list[str], span: tuple[float, float], send) -> list[dict]:
    """Worker-process entry point: time every line of plain lyrics to the vocal."""
    from .audio import wav_stems
    from .config import torch_device

    with wav_stems(Path(song_dir), ("vocals",)) as wd:
        return align_plain(wd / "vocals.wav", lines, span, torch_device())


def align_plain(vocals: Path, lines: list[str], span: tuple[float, float], device: str, chunk_sec: float = 30.0) -> list[dict]:
    """One forced alignment of all the words over the sung part of the song (`span`),
    then split back into the lines: each line gets the time of its first and last
    word, and its words. The model hears the vocal in 30-second chunks (a whole song
    at once would need several GB); their outputs join into one sequence."""
    import librosa
    import torch

    sr = 16000
    y, _ = librosa.load(str(vocals), sr=sr, mono=True)
    a = max(0.0, span[0] - 1.0)
    b = min(len(y) / sr, span[1] + 1.0)
    seg = y[int(a * sr) : int(b * sr)]
    model, tokenizer, aligner = _load(device)
    dev = device
    ems = []
    step = int(chunk_sec * sr)
    with torch.inference_mode():
        for i in range(0, len(seg), step):
            x = torch.from_numpy(seg[i : i + step].copy()).unsqueeze(0)
            if x.shape[1] < sr // 2:  # a sliver at the end: pad so the model can hear it
                x = torch.nn.functional.pad(x, (0, sr // 2 - x.shape[1]))
            try:
                em, _ = model(x.to(dev))
            except Exception:
                if dev == "cpu":
                    raise
                dev = "cpu"
                model = model.to(dev)
                em, _ = model(x.to(dev))
            ems.append(em[0].cpu())
    emission = torch.cat(ems)
    ratio = len(seg) / emission.shape[0] / sr  # seconds per emission frame (≈ 20 ms)

    words_per_line = [ln.split() for ln in lines]
    flat = [(li, w, normalise(w)) for li, ws in enumerate(words_per_line) for w in ws]
    keep = [n for _, _, n in flat if n]
    if not keep:
        raise ValueError("no words the aligner can read")
    spans = aligner(emission, tokenizer(keep))
    it = iter(spans)
    times: list[tuple[float, float] | None] = []
    for _, _, n in flat:
        if n:
            sp = next(it)
            times.append((a + sp[0].start * ratio, a + sp[-1].end * ratio))
        else:
            times.append(None)

    out: list[dict] = []
    k = 0
    for li, ws in enumerate(words_per_line):
        t = times[k : k + len(ws)]
        k += len(ws)
        known = [x for x in t if x]
        if not ws or not known:
            out.append({"text": lines[li], "start": None, "end": None, "words": None})
            continue
        start, end = known[0][0], known[-1][1]
        out.append({"text": lines[li], "start": round(start, 3), "end": round(end, 3), "words": fill_unaligned(ws, t, end)})
    return out
