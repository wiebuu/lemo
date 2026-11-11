"""Lyrics heard from the singing: the last resort when no lyrics site has a song.

Whisper (free, open-source; mlx-whisper runs it on the Mac's GPU) listens to the song's
separated vocal — no music in the way — and writes down the words with their timing.
It can mishear a word, so these lyrics are marked as transcribed and the singer can
fix them ("wrong lyrics?").

Languages Whisper doesn't know (Garhwali, Haryanvi …) are written as the closest one it
does (Hindi, in Devanagari), which reads well and converts to Hinglish / Urdu script.
"""

from __future__ import annotations

import importlib.util
import os
import re
from pathlib import Path

MODEL = os.environ.get("LEMO_WHISPER_MODEL", "mlx-community/whisper-large-v3-turbo")
SOURCE = "the singing (transcribed — may have small mistakes)"

# the song's language (catalog) → what Whisper is asked to write. Punjabi and Urdu in
# Devanagari too: those scripts (Gurmukhi, Nastaliq) can't be converted for the singer.
LANGUAGE = {"hi": "hi", "gw": "hi", "hr": "hi", "bh": "hi", "raj": "hi", "pa": "hi", "ur": "hi", "ne": "ne", "en": "en"}

# things Whisper "hears" in music or silence that nobody sang
JUNK = re.compile(r"subscribe|thanks? for watching|like and share|सब्सक्राइब|♪|\[.*?\]|\(.*?music.*?\)", re.I)


def available() -> bool:
    return importlib.util.find_spec("mlx_whisper") is not None


def language_for(lang: str | None) -> str | None:
    """None: let Whisper tell (songs in other languages: Japanese, Spanish, Bengali …)."""
    code = (lang or "").lower()
    if code in LANGUAGE:
        return LANGUAGE[code]
    from mlx_whisper.tokenizer import LANGUAGES

    return code if code in LANGUAGES else None


def transcribe(vocals: Path, lang: str | None) -> list[dict]:
    """Timed lines, as lyrics.json keeps them: [{start, end, text, words: [{start, end, text}]}]."""
    import mlx_whisper

    r = mlx_whisper.transcribe(
        str(vocals), path_or_hf_repo=MODEL, language=language_for(lang), task="transcribe",
        word_timestamps=True,
        condition_on_previous_text=False,  # one misheard line doesn't snowball into the next
        hallucination_silence_threshold=2.0, no_speech_threshold=0.6, verbose=None,
    )
    return clean(r.get("segments") or [])


def clean(segments: list[dict]) -> list[dict]:
    """Drop what wasn't sung: empty or junk lines, and one line repeated on and on over
    silence (a known Whisper slip; a chorus repeats a few times, not ten)."""
    out: list[dict] = []
    for s in segments:
        text = " ".join(str(s.get("text") or "").split())
        if len(re.sub(r"\W", "", text)) < 2 or JUNK.search(text):
            continue
        if sum(1 for o in out[-6:] if o["text"] == text) >= 4:
            continue
        words = [
            {"start": round(float(w["start"]), 3), "end": round(float(w["end"]), 3), "text": str(w.get("word") or "").strip() + " "}
            for w in s.get("words") or [] if str(w.get("word") or "").strip()
        ]
        if words:
            words[-1]["text"] = words[-1]["text"].rstrip()
        out.append({"start": round(float(s["start"]), 3), "end": round(float(s["end"]), 3), "text": text, "words": words})
    return out


def as_lrc(lines: list[dict]) -> str:
    return "\n".join(f"[{int(ln['start'] // 60):02d}:{ln['start'] % 60:06.3f}]{ln['text']}" for ln in lines)
