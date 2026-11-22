"""Puts the 22 Nov country songs (tools/add_batch_nov22.out.json) live as they finish analysing:
each one analysed here and safe on the VPS gets un-hidden in featured.json, featured.json goes to the
VPS, and the VPS catalog gets its entry (title, singer, language), so visitors from its country see
it on their own shelf. Safe to run again and again.
  .venv/bin/python tools/sync_nov22.py"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from lemo_analyzer import catalog, remote, storage  # noqa: E402

new = {x["videoId"] for x in json.load(open(ROOT / "tools/add_batch_nov22.out.json")) if x.get("videoId")}
local = catalog.load()
ready = {v for v in new if f"yt-{v}" in local and remote.has(f"yt-{v}")}

F = json.loads(storage.FEATURED_FILE.read_text())
changed = 0
for f in F:
    if f.get("videoId") in ready and f.get("hidden"):
        f.pop("hidden"); changed += 1
storage.FEATURED_FILE.write_text("[\n" + ",\n".join("  " + json.dumps(x, ensure_ascii=False) for x in F) + "\n]\n")

host, _ = remote._host_path()
subprocess.run(["scp", "-q", *remote.SSH_OPTS.split(), str(storage.FEATURED_FILE), f"{host}:/tmp/lemo-featured.json"], check=True, timeout=60)
subprocess.run(["ssh", *remote.SSH_OPTS.split(), host, "cp /tmp/lemo-featured.json ~/lemo/analyzer/featured.json && rm /tmp/lemo-featured.json"],
               check=True, timeout=60)

entries = {}
for v in ready:
    e = dict(local[f"yt-{v}"])
    feat = next((f for f in F if f.get("videoId") == v), {})
    e.update({"title": feat.get("title") or e.get("title"), "artist": feat.get("artist") or e.get("artist"),
              "lang": feat.get("lang") or e.get("lang"), "featured": not feat.get("hidden")})
    entries[f"yt-{v}"] = e
out = remote.on_server(f"""
import json
from lemo_analyzer import catalog
new = json.loads({json.dumps(json.dumps(entries, ensure_ascii=False))})
cat = catalog.load()
for sid, e in new.items():
    cat[sid] = {{**cat.get(sid, {{}}), **e}}
catalog._save(cat)
print(len(new), "in the VPS catalog")
""", timeout=120)
print(f"{len(ready)} of {len(new)} ready; {changed} newly shown; VPS: {out.strip()}")
