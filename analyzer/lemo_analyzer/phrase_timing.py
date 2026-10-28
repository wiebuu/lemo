"""Plain lyrics timed to the singer without the alignment model (no torch): for a small
server. The song's stored notes say when the singer is singing; the lines are laid
over that sung time in order, each taking a share by its number of words, and each
line starts on the nearest sung phrase. Rougher than forced alignment (no per-word
timing), but every line shows up around where it's sung."""

from __future__ import annotations

import bisect
import re

JOIN_GAP = 0.3  # notes closer than this are one stretch of singing
PHRASE_GAP = 0.9  # a breath at least this long starts a new phrase
MIN_LINE = 0.4  # seconds: a line is never shorter


def _weight(text: str) -> float:
    return max(1.0, len(re.findall(r"\w+", text))) + 0.5


def phrases(notes: list[dict]) -> list[tuple[float, float]]:
    """Sung phrases (start, end) from the reference's notes."""
    out: list[list[float]] = []
    for n in sorted((n for n in notes if n.get("sung", True)), key=lambda n: n["startTime"]):
        s, e = float(n["startTime"]), float(n["endTime"])
        if out and s - out[-1][1] < PHRASE_GAP:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return [(s, e) for s, e in out if e - s > 0.15]


def time_lines(texts: list[str], notes: list[dict], duration: float) -> list[dict]:
    texts = [t for t in (str(x).strip() for x in texts) if t]
    if not texts:
        return []
    ph = phrases(notes) or [(0.0, max(duration, 1.0))]
    lens = [e - s for s, e in ph]
    total = sum(lens)
    weights = [_weight(t) for t in texts]
    wsum = sum(weights)

    def at(pos: float) -> float:
        """A point `pos` seconds into the sung time → a time in the song."""
        for (s, _), ln in zip(ph, lens):
            if pos < ln - 1e-6:  # exactly at a phrase's end: the next phrase
                return s + pos
            pos -= ln
        return ph[-1][1]

    starts_of_phrases = [s for s, _ in ph]
    starts: list[float] = []
    acc = 0.0
    for w in weights:
        t = at(acc / wsum * total)
        # start on a phrase when one begins close by (lines usually start after a breath)
        k = bisect.bisect_left(starts_of_phrases, t)
        near = [starts_of_phrases[j] for j in (k - 1, k) if 0 <= j < len(starts_of_phrases)]
        best = min(near, key=lambda p: abs(p - t)) if near else t
        if abs(best - t) <= 1.5:
            t = best
        if starts and t < starts[-1] + MIN_LINE:
            t = starts[-1] + MIN_LINE
        starts.append(t)
        acc += w

    out = []
    for i, (text, s) in enumerate(zip(texts, starts)):
        nxt = starts[i + 1] if i + 1 < len(starts) else max(ph[-1][1], s + MIN_LINE)
        # the line ends when its phrase ends, or when the next line starts
        k = bisect.bisect_right(starts_of_phrases, s) - 1
        phrase_end = ph[k][1] if k >= 0 else nxt
        end = min(nxt, max(phrase_end, s + MIN_LINE))
        out.append({"start": round(s, 2), "end": round(max(end, s + MIN_LINE), 2), "text": text})
    return out
