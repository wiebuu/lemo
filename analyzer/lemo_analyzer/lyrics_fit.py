"""Does a timed lyrics version belong to this recording? Checked against when the
singer actually sings (the song's analysed vocal notes):

  - its lines should sit on singing (a line's time is mostly sung),
  - the singing should be covered by lines (no long sung stretch without words),
  - lines should start where phrases start.

A version that's right but shifted (a longer intro, another edit of the song) is
found by trying offsets of up to ±6 s. Plain lyrics (no timing) can't be checked
this way; they're timed to the vocal instead (lyric_align.align_plain)."""

from __future__ import annotations

import re

import numpy as np

STEP = 0.1  # seconds per cell of the singing timeline
LRC = re.compile(r"^\[(\d+):(\d+(?:\.\d+)?)\](.*)$")
MATCHES = 0.6  # a fit at least this good (and about the right length) matches this recording
SURE = 0.75  # this good matches even when the length differs (another upload of the same edit)


def lrc_lines(lrc: str) -> list[tuple[float, str]]:
    out = []
    for raw in lrc.splitlines():
        m = LRC.match(raw.strip())
        if m:
            out.append((int(m.group(1)) * 60 + float(m.group(2)), m.group(3).strip()))
    return sorted(out)


def sung_timeline(notes: list[dict], duration: float) -> np.ndarray:
    mask = np.zeros(int(np.ceil(duration / STEP)) + 1, dtype=bool)
    for n in notes:
        if n.get("sung", True):
            mask[int(n["startTime"] / STEP) : int(np.ceil(n["endTime"] / STEP)) + 1] = True
    # bridge breaths inside a phrase (≤ 0.3 s) so a phrase reads as one stretch
    gaps = np.flatnonzero(np.diff(mask.astype(np.int8)))
    for a, b in zip(gaps[1::2], gaps[2::2]):
        if (b - a) * STEP <= 0.3:
            mask[a + 1 : b + 1] = True
    return mask


def phrase_starts(mask: np.ndarray) -> np.ndarray:
    on = np.flatnonzero(mask[1:] & ~mask[:-1]) + 1
    if mask[0]:
        on = np.concatenate([[0], on])
    return on * STEP


def fit(lrc: str, notes: list[dict], duration: float, max_shift: float = 6.0) -> tuple[float, float, float]:
    """(how well these timed lyrics fit the singing 0..1, the shift in seconds that fits
    best, and the fit without any shift)."""
    lines = [(t, txt) for t, txt in lrc_lines(lrc) if txt]
    sung = [n for n in notes if n.get("sung", True)]
    if len(lines) < 4 or len(sung) < 10 or not duration:
        return 0.0, 0.0, 0.0
    mask = sung_timeline(sung, duration)
    total = mask.sum()
    starts = phrase_starts(mask)
    t = np.array([x for x, _ in lines])
    ends = np.minimum(np.append(t[1:], t[-1] + 6.0), t + 7.0)
    best = (0.0, 0.0)
    unshifted = 0.0
    for off in np.arange(-max_shift, max_shift + 1e-9, STEP):
        a = np.clip(((t + off) / STEP).astype(int), 0, len(mask) - 1)
        b = np.clip(((ends + off) / STEP).astype(int), 0, len(mask) - 1)
        covered = np.zeros_like(mask)
        on_singing = []
        for i, j in zip(a, b):
            seg = mask[i : max(j, i + 1)]
            on_singing.append(seg.mean() if len(seg) else 0.0)
            covered[i : max(j, i + 1)] = True
        inside = float(np.mean(on_singing))
        coverage = float((covered & mask).sum() / total) if total else 0.0
        # lines start where phrases start: full marks on the spot, none 0.8 s away
        onset = float(np.mean([max(0.0, 1 - np.min(np.abs(starts - (x + off))) / 0.8) for x in t])) if len(starts) else 0.0
        score = 0.4 * inside + 0.3 * coverage + 0.3 * onset
        if abs(off) < 1e-6:
            unshifted = score
        if score > best[0]:
            best = (score, float(round(off, 1)))
    if best[0] - unshifted < 0.02:  # no shift unless one clearly fits better
        best = (unshifted, 0.0)
    return round(best[0], 3), best[1], round(unshifted, 3)


def matches(score: float, lyrics_duration: float | None, duration: float) -> bool:
    if score >= SURE:
        return True
    return score >= MATCHES and (not lyrics_duration or abs(lyrics_duration - duration) <= 8)


def rank(score: float, lyrics_duration: float | None, duration: float) -> float:
    """Among matching versions: the best fit, a length close to the song's breaking ties."""
    diff = abs((lyrics_duration or duration) - duration)
    return score - 0.004 * min(diff, 30)


def shift_lrc(lrc: str, by: float) -> str:
    """Move every timestamp by `by` seconds (never before 0)."""
    def move(m: re.Match) -> str:
        secs = max(0.0, int(m.group(1)) * 60 + float(m.group(2)) + by)
        return f"[{int(secs // 60):02d}:{secs % 60:05.2f}]"

    return re.sub(r"\[(\d+):(\d+(?:\.\d+)?)\]", move, lrc)
