"""Songs singers asked Lemody to add: see the list, and add them.

    .venv/bin/python -m tools.requests            # what's waiting (most asked-for first)
    .venv/bin/python -m tools.requests add all    # analyse every waiting song
    .venv/bin/python -m tools.requests add yt-…   # just these

Run on the machine that analyses songs. The list lives in the server's database
(read over SSH). Added songs join the analyzer's queue (featured.json, hidden: not on the
shelves) and start within 10 minutes; when a song is ready, the server puts it in the
song list of everyone who asked, and it's in search and Explore for everyone.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time

from lemo_analyzer import remote, storage

LIST = ("cd ~/lemo/analyzer && .venv/bin/python -c "
        "'import json; from lemo_analyzer import userdata; print(json.dumps(userdata.pending_requests()))'")


def pending() -> list[dict]:
    host, _ = remote._host_path()
    if not host:
        from lemo_analyzer import userdata

        return userdata.pending_requests()
    r = subprocess.run(["ssh", *remote.SSH_OPTS.split(), host, LIST], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        sys.exit(f"couldn't read the requests from the server: {r.stderr.strip()[-300:]}")
    return json.loads(r.stdout.strip().splitlines()[-1])


def show(items: list[dict]) -> None:
    if not items:
        print("no songs waiting")
        return
    queued = {f"yt-{f['videoId']}" for f in storage.prepare_list() if f.get("videoId")}
    for r in items:
        days = (time.time() - r["firstAt"]) / 86400
        mark = "queued" if r["songId"] in queued else "waiting"
        name = " · ".join(x for x in (r.get("title"), r.get("artist")) if x) or "(no title)"
        print(f"{r['songId']:<16} {r['people']:>2} asked  {days:4.1f} d  {mark:<7}  {name}  {r['url']}")


def add(items: list[dict], which: list[str]) -> None:
    want = [r for r in items if "all" in which or r["songId"] in which]
    have = {f.get("videoId") for f in storage.prepare_list()}
    new = [{"videoId": r["songId"][3:], "hidden": True, "requested": True} for r in want if r["songId"][3:] not in have]
    if new:
        items_all = storage.prepare_list() + new
        storage.FEATURED_FILE.write_text("[\n" + ",\n".join("  " + json.dumps(f, ensure_ascii=False) for f in items_all) + "\n]\n")
    print(f"added {len(new)} song(s) to the analyzer's queue ({len(want) - len(new)} already there); they start within 10 minutes")


if __name__ == "__main__":
    args = sys.argv[1:]
    items = pending()
    if args[:1] == ["add"] and args[1:]:
        add(items, args[1:])
    else:
        show(items)
