"""Time lyrics by their words alone — no audio model, so it runs on the small VPS.

Every song keeps timed lyrics (lyrics.json: found online and timed on the Mac, or
transcribed from the singing), with each word's start and end. Lyrics a singer pastes
are nearly always that same song — corrected, spelled another way, or in another
script — so each pasted word is matched to the song's timed words in order (a
sequence alignment, like comparing two texts) and takes its time from there. Words
with no match are spread between the matched words around them.

Spellings differ a lot ("mujhe" / "mujhey", "तेरा" / "tera"), so words are compared in
Latin letters (Devanagari is romanised first) by how alike they are, not exactly.
When too few words match (other lyrics, Urdu script), it returns None.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher

from .translit import deva_to_latin, script_of

MIN_SHARE = 0.45  # at least this share of the pasted words must match the song's words
GOOD = 0.6  # two words this alike count as the same word


def _key(word: str) -> str:
    """A word in comparable Latin letters: romanised, lower case, letters only, runs of
    the same letter and the h in kh / gh / bh … folded (spellings vary)."""
    w = word.strip()
    if script_of(w) == "deva":
        w = deva_to_latin(w)
    w = re.sub(r"[^a-z]", "", w.lower())
    w = re.sub(r"(.)\1+", r"\1", w)  # aa → a, ee → e
    w = re.sub(r"(?<=[kgcjtdpb])h", "", w)  # kh → k, bh → b …
    return w.replace("w", "v").replace("z", "j").replace("q", "k")


def _sim(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def _align(p: list[str], r: list[str]) -> list[int | None]:
    """For each pasted word, the song word it lines up with (or None): the best order-
    keeping match (Needleman–Wunsch), with a band so long songs stay fast."""
    n, m = len(p), len(r)
    GAP = -0.45
    band = max(60, abs(n - m) + 60)
    NEG = float("-inf")
    score = [[NEG] * (m + 1) for _ in range(n + 1)]
    move = [[0] * (m + 1) for _ in range(n + 1)]  # 1 diagonal, 2 skip pasted, 3 skip song
    score[0][0] = 0.0
    for j in range(1, m + 1):
        score[0][j], move[0][j] = 0.0, 3  # the paste may start anywhere in the song
    for i in range(1, n + 1):
        centre = i * m / max(n, 1)
        lo, hi = max(1, int(centre - band)), min(m, int(centre + band))
        score[i][0], move[i][0] = score[i - 1][0] + GAP, 2
        for j in range(lo, hi + 1):
            s = _sim(p[i - 1], r[j - 1])
            best, mv = score[i - 1][j - 1] + (2 * s - 1 if s >= 0.35 else -1.0), 1
            if score[i - 1][j] + GAP > best:
                best, mv = score[i - 1][j] + GAP, 2
            if score[i][j - 1] + (0.0 if i == n else GAP) > best:  # the paste may end before the song does
                best, mv = score[i][j - 1] + (0.0 if i == n else GAP), 3
            score[i][j], move[i][j] = best, mv
    out: list[int | None] = [None] * n
    i, j = n, max(range(m + 1), key=lambda k: score[n][k])
    while i > 0 and j >= 0:
        mv = move[i][j]
        if mv == 1:
            if _sim(p[i - 1], r[j - 1]) >= GOOD:
                out[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif mv == 2 or j == 0:
            i -= 1
        else:
            j -= 1
    return out


def time_lines(lines: list[str], timed: list[dict]) -> list[dict] | None:
    """Pasted lines → [{start, end, text, words: [{start, end, text}]}], timed from the
    song's own timed lyrics (`timed`, as lyrics.json keeps them). None when they don't
    match well enough to trust."""
    ref = [w for ln in timed for w in (ln.get("words") or []) if w.get("text", "").strip()]
    if not ref:  # lines only: each line's words spread over it
        ref = []
        for ln in timed:
            ws = ln.get("text", "").split()
            if not ws or ln.get("start") is None or ln.get("end") is None:
                continue
            step = (ln["end"] - ln["start"]) / len(ws)
            ref += [{"start": ln["start"] + k * step, "end": ln["start"] + (k + 1) * step, "text": w} for k, w in enumerate(ws)]
    words = [(li, w) for li, line in enumerate(lines) for w in line.split()]
    if not ref or not words:
        return None
    match = _align([_key(w) for _, w in words], [_key(w["text"]) for w in ref])
    hits = [k for k, x in enumerate(match) if x is not None]
    if len(hits) < MIN_SHARE * len(words):
        return None

    # every word a time: matched ones from the song, the rest spread between neighbours
    times: list[tuple[float, float]] = []
    for k in range(len(words)):
        if match[k] is not None:
            times.append((ref[match[k]]["start"], ref[match[k]]["end"]))
            continue
        before = next((b for b in range(k - 1, -1, -1) if match[b] is not None), None)
        after = next((a for a in range(k + 1, len(words)) if match[a] is not None), None)
        t0 = ref[match[before]]["end"] if before is not None else ref[match[after]]["start"] - 0.4 * (after - k)
        t1 = ref[match[after]]["start"] if after is not None else ref[match[before]]["end"] + 0.4 * (k - before)
        gap = after - before - 1 if before is not None and after is not None else 1
        pos = k - before - 1 if before is not None else 0
        step = max(0.0, t1 - t0) / max(gap, 1)
        s = t0 + pos * step
        times.append((s, s + max(step, 0.15)))

    # keep time moving forward (a repeated chorus can pull a word back)
    last = 0.0
    for k, (s, e) in enumerate(times):
        s = max(s, last)
        times[k] = (s, max(e, s + 0.1))
        last = s

    out: list[dict] = []
    for li, line in enumerate(lines):
        ks = [k for k, (wl, _) in enumerate(words) if wl == li]
        if not ks:
            continue
        ws = [{"start": round(times[k][0], 3), "end": round(times[k][1], 3), "text": words[k][1] + " "} for k in ks]
        ws[-1]["text"] = ws[-1]["text"].rstrip()
        out.append({"start": ws[0]["start"], "end": ws[-1]["end"], "text": line, "words": ws})
    return out
