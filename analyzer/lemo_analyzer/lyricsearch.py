"""Find a song by a bit of its lyrics, the way people remember and type them:
in Hinglish, any spelling ("mohabbat" / "mohobat", "zaroori" / "jaruri"), a few
words from anywhere in a line, a word half-typed.

Every song's lyrics are read once (and again when they change), turned into
Hinglish when they're in Devanagari or Gurmukhi, and each word is kept as its
consonant skeleton. Urdu-script lyrics only match by their Latin parts."""

from __future__ import annotations

import json
import re
import threading
import time
import unicodedata
from pathlib import Path

from . import catalog, storage, translit
from .config import CONFIG

_lock = threading.Lock()
_index: dict[str, tuple[float, list[tuple[str, list[str]]], set[str]]] = {}  # id -> (mtime, [(line, skeletons)], every skeleton)
_built = {"at": 0.0}
REFRESH = 600  # look for new or changed lyrics every 10 minutes

GURMUKHI = re.compile(r"[਀-੿]")


def _gurmukhi_to_deva(text: str) -> str:
    """Gurmukhi and Devanagari share their Unicode layout, so Punjabi lyrics can go
    through the Devanagari → Hinglish rules."""
    out = []
    for c in text:
        o = ord(c)
        if c == "ੰ":  # tippi: a nasal, like anusvara
            out.append("ं")
        elif c == "ੱ":  # addak doubles the next consonant: the skeleton collapses doubles anyway
            continue
        elif c == "ੲ":
            out.append("इ")
        elif c == "ੳ":
            out.append("उ")
        elif 0x0A00 <= o <= 0x0A6F:
            out.append(chr(o - 0x100))
        else:
            out.append(c)
    return "".join(out)


def _latin(line: str) -> str:
    if GURMUKHI.search(line):
        line = _gurmukhi_to_deva(line)
    if translit.DEVA.search(line):
        return translit.deva_to_latin(line)
    return line


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def skel(word: str) -> str:
    """The consonants of a word, spelling-proof: "mohabbat", "mohobat" → "mbt";
    "zaroori", "jaruri" → "jrr"; "dil", "dill" → "dl"."""
    w = re.sub(r"[^a-z0-9]", "", _norm(word))
    w = w.replace("ph", "f").replace("f", "p").replace("z", "j").replace("q", "k").replace("v", "w").replace("x", "ks")
    w = re.sub(r"n(?=[^aeiouy])", "", w)  # a nasal before a consonant: "hain" / "hai", "sang" / "sag"
    w = re.sub(r"[aeiouyh]", "", w)
    return re.sub(r"(.)\1+", r"\1", w)


def words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", _norm(text))


def _lyric_lines(path: Path) -> list[str]:
    try:
        d = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    text = d.get("plain") or re.sub(r"\[[\d:.]+\]", "", d.get("synced") or "")
    seen, out = set(), []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line in seen:  # choruses repeat
            continue
        seen.add(line)
        out.append(line)
    return out


def _lyrics_file(song_id: str) -> Path | None:
    places = [storage.songs_root() / song_id / "lyrics.json"]
    if CONFIG.remote_store and ":" not in CONFIG.remote_store:  # the API on the VPS: songs are right here
        places.append(Path(CONFIG.remote_store) / song_id / "lyrics.json")
    return next((p for p in places if p.exists()), None)


def _refresh() -> None:
    ids = {e["id"] for e in catalog.all_songs() if catalog.is_public(e["id"])}
    for sid in list(_index):
        if sid not in ids:
            del _index[sid]
    for sid in ids:
        p = _lyrics_file(sid)
        if not p:
            continue
        mtime = p.stat().st_mtime
        if sid in _index and _index[sid][0] == mtime:
            continue
        lines = []
        for line in _lyric_lines(p):
            shown = _latin(line)
            sk = [s for s in (skel(w) for w in words(shown)) if s]
            if sk:
                lines.append((shown, sk))
        _index[sid] = (mtime, lines, {t for _, sk in lines for t in sk})
    _built["at"] = time.time()


def _close(a: str, b: str) -> bool:
    """One letter added, dropped or changed (only for longer skeletons)."""
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(x != y for x, y in zip(a, b)) == 1
    short, long_ = (a, b) if len(a) < len(b) else (b, a)
    return any(long_[:i] + long_[i + 1:] == short for i in range(len(long_)))


def _hit(q: str, t: str, last: bool) -> bool:
    if t == q:
        return True
    if len(q) >= 2 and q.replace("d", "r") == t.replace("d", "r"):  # ड़: "ladki" / "larki", "chadeya" / "charhiya"
        return True
    if last and len(q) >= 3 and t.startswith(q):  # still typing this word
        return True
    return min(len(q), len(t)) >= 2 and max(len(q), len(t)) >= 3 and _close(q, t)


GAP = 2  # words the singer has between two typed words (that the typer left out)


def _chain(qs: list[str], weight: list[float], toks: list[str], matches: list[set[str]]) -> tuple[float, int, int, int]:
    """The most typed words found in this stretch of lyrics in the order typed and
    close together (a typed word may be missing or misremembered): (weight, how many
    are spelled exactly, first and last word's place)."""
    hits = [(k, j) for k, t in enumerate(toks) for j in range(len(qs)) if t in matches[j]]
    best: dict[tuple[int, int], tuple[float, int, int]] = {}
    top = (0.0, 0, 0, 0)
    for k, j in hits:
        b = (weight[j], int(toks[k] == qs[j]), k)
        for (k2, j2), v in best.items():
            if j2 < j and k2 < k and k - k2 - 1 <= GAP + (j - j2 - 1):
                c = (v[0] + weight[j], v[1] + int(toks[k] == qs[j]), v[2])
                if c[:2] > b[:2]:
                    b = c
        best[(k, j)] = b
        if b[:2] > top[:2]:
            top = (b[0], b[1], b[2], k)
    return top


def search(query: str, limit: int = 8) -> list[dict]:
    """Songs with a line (or two lines running on) holding most of the typed words, in order."""
    qs = [s for s in (skel(w) for w in words(query)) if s]
    strong = [q for q in qs if len(q) >= 2]
    if len(qs) < 2 or not strong or (len(strong) < 2 and len(qs) < 3):
        return []
    with _lock:
        if time.time() - _built["at"] > REFRESH or not _index:
            _refresh()
        index = dict(_index)
    weight = [1.0 if len(q) >= 2 else 0.35 for q in qs]
    total = sum(weight)
    need = 0.8 if len(strong) <= 3 else 0.7
    found = []
    for sid, (_, lines, vocab) in index.items():
        # which of this song's words count as each typed word; skip songs that can't have enough
        matches = [{t for t in vocab if _hit(q, t, j == len(qs) - 1)} for j, q in enumerate(qs)]
        if sum(w for w, m in zip(weight, matches) if m) / total < need:
            continue
        best, best_line = (0.0, 0), ""
        for i, (shown, toks) in enumerate(lines):
            nxt = lines[i + 1] if i + 1 < len(lines) else None
            window = toks + (nxt[1] if nxt else [])
            got, exact, first, last = _chain(qs, weight, window, matches)
            if (got, exact) > best:
                best = (got, exact)
                # show the line the words are on (both, when they run on)
                best_line = nxt[0] if nxt and first >= len(toks) else f"{shown} / {nxt[0]}" if nxt and last >= len(toks) else shown
        if best[0] / total >= need:
            found.append((best[0] / total, best[1], sid, best_line))
    cat = catalog.load()

    def named(sid: str) -> int:  # typed words that are also in the song's name
        title = [skel(w) for w in words(cat.get(sid, {}).get("title") or "")]
        return sum(q in title for q in strong)

    found.sort(key=lambda f: (-f[0], -f[1], -named(f[2]), -int(cat.get(f[2], {}).get("plays") or 0)))
    if found:  # a song with the whole bit: leave out the ones with only some of it
        found = [f for f in found if f[0] >= found[0][0] - 0.1]
    return [{"id": sid, "line": line} for _, _, sid, line in found[:limit]]
