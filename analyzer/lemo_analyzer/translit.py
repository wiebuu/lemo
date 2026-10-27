"""Show lyrics in the script the singer reads best: Hinglish (romanised), Hindi
(Devanagari) or Urdu (Nastaliq).

  Devanagari → Hinglish   rules below (Devanagari is phonetic), with the usual
                          spellings: मुझको → mujhko, कोई → koi, में → mein
  Hinglish → Hindi / Urdu Google input tools (free; cached on disk)
  Devanagari → Urdu       via Hinglish
  Urdu → anything         not possible reliably (Urdu leaves out most vowels):
                          those lines come back as None and stay as they are

A line that already carries the wanted script next to another one (captions
often show "ایسا دیکھا نہیں · aisa dekha naheen") just keeps that part."""

from __future__ import annotations

import json
import re
import threading
import unicodedata
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from .config import CONFIG

DEVA = re.compile(r"[ऀ-ॿ]")
URDU = re.compile(r"[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]")
LATIN = re.compile(r"[A-Za-z]")


def script_of(text: str) -> str:
    d, u, l = len(DEVA.findall(text)), len(URDU.findall(text)), len(LATIN.findall(text))
    if max(d, u, l) == 0:
        return "none"
    return "deva" if d >= max(u, l) else "urdu" if u >= l else "latin"


def word_script(w: str) -> str:
    return script_of(w)


# ---- Devanagari → Hinglish -------------------------------------------------------------

CONS = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "ळ": "l", "व": "v",
    "श": "sh", "ष": "sh", "स": "s", "ह": "h",
    # with nukta
    "क़": "q", "ख़": "kh", "ग़": "gh", "ज़": "z", "फ़": "f", "ड़": "r", "ढ़": "rh", "य़": "y",
}
VOWELS = {"अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "o", "ऍ": "e"}
MATRAS = {"ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e"}
VIRAMA, NUKTA, ANUSVARA, CANDRA, VISARGA = "्", "़", "ं", "ँ", "ः"


def _deva_word(word: str) -> str:
    word = unicodedata.normalize("NFC", word)
    # units: [consonant or "", vowel ("a" inherent, explicit, or "" for virama), nasal, independent?]
    units: list[list] = []
    i = 0
    while i < len(word):
        ch = word[i]
        nxt = word[i + 1] if i + 1 < len(word) else ""
        if nxt == NUKTA and ch + NUKTA in CONS:
            ch, i = ch + NUKTA, i + 1
            nxt = word[i + 1] if i + 1 < len(word) else ""
        if ch in CONS:
            units.append([CONS[ch], "a", "", False])
        elif ch in VOWELS:
            units.append(["", VOWELS[ch], "", True])
        elif ch in MATRAS and units:
            units[-1][1] = MATRAS[ch]
        elif ch == VIRAMA and units:
            units[-1][1] = ""
        elif ch in (ANUSVARA, CANDRA) and units:
            units[-1][2] = "n"
        elif ch == VISARGA and units:
            units[-1][2] = "h"
        elif ch.isdigit() or ch in "'-":
            units.append([ch, "", "", False])
        i += 1
    if not units:
        return word
    inherent = [u[0] != "" and u[1] == "a" for u in units]  # schwa still "a" from the consonant
    # word-final schwa is silent (except one-letter words: न → na)
    if len(units) > 1 and inherent[-1] and not units[-1][2]:
        units[-1][1] = ""
    # V C ə C V → V C C V  (मुझको → mujhko, इतना → itna)
    for k in range(len(units) - 2, 0, -1):
        if inherent[k] and not units[k][2] and units[k - 1][1] and units[k + 1][0] and units[k + 1][1]:
            units[k][1] = ""
    out = []
    for k, (c, v, nasal, independent) in enumerate(units):
        last = k == len(units) - 1
        if c == "v" and k == 0 and v in ("o", "a", "ai"):  # वो → wo, वह → woh-ish
            c = "w"
        if independent and k > 0 and units[k - 1][1]:  # vowel after a vowel: बताए → bataye, कोई → koi
            v = {"e": "ye", "ee": "i", "i": "i", "aa": "aa", "o": "o"}.get(v, v)
            if out and out[-1].endswith("aa"):
                out[-1] = out[-1][:-1]
        if nasal == "n":
            if v == "e" and last:  # में → mein, तुम्हें → tumhein
                v = "ei"
            nxt = units[k + 1][0] if not last else ""
            nasal = "m" if nxt[:1] in ("p", "b", "m") else "n"
        if last and not nasal:
            v = {"aa": "a", "ee": "i"}.get(v, v)  # इतना → itna, कोई → koi
        out.append(c + v + nasal)
    return "".join(out)


def deva_to_latin(text: str) -> str:
    words = re.split(r"(\s+)", text)
    res = []
    for w in words:
        if DEVA.search(w):
            core = re.match(r"^([^ऀ-ॿ]*)(.*?)([^ऀ-ॿ]*)$", w)
            pre, mid, post = core.groups() if core else ("", w, "")
            res.append(pre + _deva_word(mid) + post.replace("।", ""))
        else:
            res.append(w)
    out = "".join(res).replace("।", "").strip()
    return out[:1].upper() + out[1:] if out else out


# ---- Hinglish → Hindi / Urdu (Google input tools) -------------------------------------------

_cache_lock = threading.Lock()
_cache: dict[str, str] | None = None


def _cache_file():
    return CONFIG.data_dir / "translit-cache.json"


def _load_cache() -> dict[str, str]:
    global _cache
    if _cache is None:
        try:
            _cache = json.loads(_cache_file().read_text())
        except (OSError, json.JSONDecodeError):
            _cache = {}
    return _cache


def _save_cache() -> None:
    with _cache_lock:
        _cache_file().write_text(json.dumps(_load_cache(), ensure_ascii=False))


def _google(text: str, lang: str) -> str | None:
    key = f"{lang}|{text}"
    cache = _load_cache()
    if key in cache:
        return cache[key]
    q = urllib.parse.urlencode({"text": text, "itc": f"{lang}-t-i0-und", "num": 1, "cp": 0, "cs": 1, "ie": "utf-8", "oe": "utf-8", "app": "lemo"})
    req = urllib.request.Request(f"https://inputtools.google.com/request?{q}", headers={"User-Agent": "lemo/0.1"})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read().decode())
    if data[0] != "SUCCESS" or not data[1]:
        return None
    out = " ".join(seg[1][0] for seg in data[1] if seg[1])
    with _cache_lock:
        cache[key] = out
    return out


# ---- per line -------------------------------------------------------------------------------


# Common English words that aren't also everyday Hinglish ("is", "main", "to", "na" are left out).
ENGLISH = set("""the a an of and or but with without we you your yours they their them she her hers he his him it its
this that these those have has had was were been being are am will would shall should could can may might must
never ever always such as for from into onto upon over under about above below than then there here where when what
which who whom whose why how all any some every each one ones only also just very more most less least much many
my mine our ours me us i'm you're it's don't can't won't let love like know see seen look beauty beautiful heart
eyes life world night day light time away again still even because so if not no yes oh""".split())


def _cut_translation(words: list[str]) -> list[str]:
    """Captions often put an English translation after the romanised lyric: drop it."""
    eng = [w.lower().strip(".,!?;:'\"()") in ENGLISH for w in words]
    for k in range(2, len(words) - 2):
        window = eng[k : k + 4]
        if eng[k] and sum(window) >= 3:
            return words[:k]
    return words


def _part_in(text: str, script: str) -> str | None:
    """From a line mixing scripts, the words in `script` — if they're a real share of it."""
    words = text.split()
    keep = [w for w in words if word_script(w) == script]
    if not keep or len(keep) < 0.3 * len(words) or len(keep) == len(words):
        return None
    if script == "latin":
        keep = _cut_translation(keep)
    return " ".join(keep)


def convert_line(text: str, to: str) -> str | None:
    """to: 'latin' | 'deva' | 'urdu'. None when it can't be done honestly."""
    if not text.strip():
        return text
    src = script_of(text)
    target = {"latin": "latin", "deva": "deva", "urdu": "urdu"}[to]
    if src == target or src == "none":
        mixed = _part_in(text, target)
        return mixed if mixed else text
    part = _part_in(text, target)
    if part:
        return part
    if to == "latin":
        return deva_to_latin(text) if src == "deva" else None
    latin = text if src == "latin" else deva_to_latin(text) if src == "deva" else None
    if latin is None:
        return None
    return _google(re.sub(r"[^\w\s']", " ", latin).strip(), "hi" if to == "deva" else "ur")


def convert_lines(lines: list[str], to: str) -> list[str | None]:
    with ThreadPoolExecutor(max_workers=6) as pool:
        out = list(pool.map(lambda t: _safe(t, to), lines))
    _save_cache()
    return out


def _safe(text: str, to: str) -> str | None:
    try:
        return convert_line(text, to)
    except Exception:  # offline / rate-limited: leave the line as it is
        return None
