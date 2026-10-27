"""Lead-vocal separation with Demucs (htdemucs), processed in chunks so the
job can report progress and be cancelled."""

from __future__ import annotations

from pathlib import Path
from typing import Callable

import soundfile as sf

from .audio import write_wav

_model = None


class Cancelled(Exception):
    pass


def _load_model():
    global _model
    if _model is None:
        from demucs.pretrained import get_model

        _model = get_model("htdemucs")  # downloads ~80 MB on first use
        _model.eval()
    return _model


def unload() -> None:
    """Free the model before the next stage (keeps the worker's peak memory down)."""
    global _model
    _model = None
    import gc

    import torch

    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()


def separate_vocals(
    mix_path: Path,
    vocals_out: Path,
    backing_out: Path,
    device: str,
    progress: Callable[[float, str], None],
    cancelled: Callable[[], bool],
) -> None:
    import torch
    from demucs.apply import apply_model

    progress(0.0, "loading separation model (first run downloads ~80 MB)")
    model = _load_model()
    wav, sr = sf.read(str(mix_path), dtype="float32", always_2d=True)
    if sr != model.samplerate:
        raise RuntimeError(f"expected {model.samplerate} Hz audio, got {sr}")
    mix = torch.from_numpy(wav.T.copy())  # (2, n)
    if mix.shape[0] == 1:
        mix = mix.repeat(2, 1)
    n = mix.shape[1]
    ref = mix.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    x = (mix - mean) / std

    vidx = model.sources.index("vocals")
    chunk, overlap = 40 * sr, 2 * sr
    vocals = torch.zeros_like(x)
    weight = torch.zeros(n)

    def run(seg, dev):
        model.to(dev)
        with torch.no_grad():
            return apply_model(model, seg[None], device=dev, split=True, overlap=0.25, progress=False)[0][vidx].cpu()

    dev = device
    start = 0
    while True:
        if cancelled():
            raise Cancelled()
        end = min(n, start + chunk)
        seg = x[:, start:end]
        try:
            voc = run(seg, dev)
        except Exception:
            if dev == "cpu":
                raise
            dev = "cpu"  # some ops are unsupported on MPS for some torch versions
            progress(start / n, "GPU separation failed, continuing on CPU")
            voc = run(seg, dev)
        w = torch.ones(end - start)
        if start > 0:
            w[:overlap] = torch.linspace(0, 1, overlap)
        if end < n:
            w[-overlap:] = torch.linspace(1, 0, overlap)
        vocals[:, start:end] += voc * w
        weight[start:end] += w
        progress(end / n, f"separating vocals ({dev})")
        if end >= n:
            break
        start = end - overlap

    vocals = vocals / weight.clamp(min=1e-6)
    vocals = vocals * std + mean
    backing = mix - vocals
    write_wav(vocals_out, vocals.mean(0, keepdim=True).numpy(), sr)  # mono guide
    write_wav(backing_out, backing.numpy(), sr)
