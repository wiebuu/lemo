"""Search and download openly licensed sounds from Openverse (no API key).

  python3 openverse.py search "whoosh" [--license commercial|cc0|all] [--max-seconds 3] [-n 20]
  python3 openverse.py get ID [ID ...] --out reels/sfx
"""

import argparse
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.openverse.org/v1/audio/"
UA = {"User-Agent": "lemody-reels/1.0"}


def call(url: str) -> dict:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return json.load(r)


def search(a) -> None:
    q = {"q": a.query, "page_size": min(a.n * 3, 50)}
    if a.license == "commercial":
        q["license_type"] = "commercial"
    elif a.license == "cc0":
        q["license"] = "cc0"
    res = call(API + "?" + urllib.parse.urlencode(q)).get("results", [])
    shown = 0
    for r in res:
        secs = (r.get("duration") or 0) / 1000
        if a.max_seconds and secs and secs > a.max_seconds:
            continue
        print(f"{r['id']}  {secs:5.1f}s  {r['license']} {r.get('license_version') or ''}  {r['title'][:50]!r} by {r.get('creator') or '?'}  {r.get('foreign_landing_url') or ''}")
        shown += 1
        if shown >= a.n:
            break
    if not shown:
        print("no results", file=sys.stderr)


def get(a) -> None:
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    credits = out / "CREDITS.txt"
    for i in a.ids:
        r = call(f"{API}{i}/")
        ext = (r.get("filetype") or Path(urllib.parse.urlparse(r["url"]).path).suffix.lstrip(".") or "mp3").lower()
        name = "".join(c if c.isalnum() else "-" for c in r["title"].lower()).strip("-")[:40] or i
        dest = out / f"{name}-{i[:8]}.{ext}"
        with urllib.request.urlopen(urllib.request.Request(r["url"], headers=UA), timeout=60) as src:
            dest.write_bytes(src.read())
        line = r.get("attribution") or f"{r['title']} by {r.get('creator')} ({r['license']} {r.get('license_version')}) {r.get('foreign_landing_url')}"
        with credits.open("a") as f:
            f.write(f"{dest.name}: {line}\n")
        print(f"{dest}  [{r['license']} {r.get('license_version') or ''}]")


p = argparse.ArgumentParser()
sub = p.add_subparsers(dest="cmd", required=True)
s = sub.add_parser("search")
s.add_argument("query")
s.add_argument("--license", default="commercial", choices=["commercial", "cc0", "all"])
s.add_argument("--max-seconds", type=float, default=0)
s.add_argument("-n", type=int, default=15)
g = sub.add_parser("get")
g.add_argument("ids", nargs="+")
g.add_argument("--out", default="sfx")
a = p.parse_args()
search(a) if a.cmd == "search" else get(a)
