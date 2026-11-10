"""Hand-written Hinglish for the lines a reel shows.

  python3 hinglish.py songs/yt-… '{"47.0": "Kaatun kaise raatan, o saanware", ...}'

Keys are line start times (as printed by --show); each matching line gets the new text, and its
word timings are dropped (the reel then spreads the words evenly over the line). Writes
lyrics.latin.json next to lyrics.json. With --show it prints the lines and their start times.
"""

import json
import sys
from pathlib import Path

folder = Path(sys.argv[1])
src = folder / "lyrics.json"
lines = json.loads(src.read_text()).get("timed") or []
if sys.argv[2:] == ["--show"]:
    for l in lines:
        print(f"{l['start']:.1f}-{l['end']:.1f} {l['text']}")
    sys.exit()
fix = {float(k): v for k, v in json.loads(sys.argv[2]).items()}
out = []
for l in lines:
    k = next((k for k in fix if abs(k - l["start"]) < 0.06), None)
    out.append({**l, "text": fix[k], "words": []} if k is not None else l)
(folder / "lyrics.latin.json").write_text(json.dumps({"timed": out}, ensure_ascii=False))
print(f"{folder}: {sum(1 for l in lines if any(abs(k - l['start']) < 0.06 for k in fix))} lines rewritten")
