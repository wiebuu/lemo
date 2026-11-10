"""Hinglish lyrics for the reels: writes lyrics.latin.json next to each song's lyrics.json,
with the same timing (Devanagari and Urdu lines converted by the analyzer's translit).

  ../analyzer/.venv/bin/python latin_lyrics.py songs/yt-…  [more song folders]
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "analyzer"))
from lemo_analyzer.translit import convert_line, script_of  # noqa: E402


def main() -> None:
    for folder in sys.argv[1:]:
        src = Path(folder) / "lyrics.json"
        if not src.exists():
            print(f"{folder}: no lyrics")
            continue
        lines = json.loads(src.read_text()).get("timed") or []
        out = []
        for line in lines:
            text = line.get("text", "")
            latin = text if script_of(text) == "latin" else (convert_line(text, "latin") or text)
            words = line.get("words") or []
            parts = latin.split()
            # same number of words: each keeps its timing; otherwise the line's timing only
            if words and len(parts) == len(words):
                words = [{**w, "text": p + (" " if i < len(parts) - 1 else "")} for i, (w, p) in enumerate(zip(words, parts))]
            else:
                words = []
            out.append({**line, "text": latin, "words": words})
        (Path(folder) / "lyrics.latin.json").write_text(json.dumps({"timed": out}, ensure_ascii=False))
        print(f"{folder}: {len(out)} lines")


if __name__ == "__main__":
    main()
