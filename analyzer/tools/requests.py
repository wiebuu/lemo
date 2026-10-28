"""Songs singers asked Lemody to add: see the list, and add them.

    .venv/bin/python -m tools.requests                      # what's waiting (most asked-for first)
    .venv/bin/python -m tools.requests add all              # every waiting YouTube song
    .venv/bin/python -m tools.requests add yt-…             # just these
    .venv/bin/python -m tools.requests add rq-… <YouTube link>   # a Spotify / other link: add it as this video

Run on the machine that analyses songs. The list lives in the server's database (read
over SSH). Added songs join the analyzer's queue (featured.json, hidden: not on the
shelves) and start within 10 minutes; when a song is ready, the server puts it in the
song list of everyone who asked, and it's in search and Explore for everyone.
"""

from __future__ import annotations

import json
import re
import shlex
import subprocess
import sys
import time

from lemo_analyzer import remote, storage, youtube


def _on_server(code: str) -> str:
    """Run Python next to the server's database and return what it prints last."""
    host, _ = remote._host_path()
    if not host:
        r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60)
    else:
        cmd = f"cd ~/lemo/analyzer && .venv/bin/python -c {shlex.quote(code)}"
        r = subprocess.run(["ssh", *remote.SSH_OPTS.split(), host, cmd], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        sys.exit(f"couldn't reach the server's database: {r.stderr.strip()[-300:]}")
    return r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""


def pending() -> list[dict]:
    return json.loads(_on_server("import json; from lemo_analyzer import userdata; print(json.dumps(userdata.pending_requests()))"))


def show(items: list[dict]) -> None:
    if not items:
        print("no songs waiting")
        return
    queued = {f"yt-{f['videoId']}" for f in storage.prepare_list() if f.get("videoId")}
    for r in items:
        days = (time.time() - r["firstAt"]) / 86400
        mark = "queued" if r["target"] in queued else ("waiting" if r["target"] else "needs a YouTube link")
        name = " · ".join(x for x in (r.get("title"), r.get("artist")) if x) or "(no title)"
        print(f"{r['songId']:<20} {r['people']:>2} asked  {days:4.1f} d  {mark:<20}  {name}  {r['url']}")


def queue(video_ids: list[str]) -> int:
    have = {f.get("videoId") for f in storage.prepare_list()}
    new = [{"videoId": v, "hidden": True, "requested": True} for v in dict.fromkeys(video_ids) if v not in have]
    if new:
        items = storage.prepare_list() + new
        storage.FEATURED_FILE.write_text("[\n" + ",\n".join("  " + json.dumps(f, ensure_ascii=False) for f in items) + "\n]\n")
    return len(new)


def main(args: list[str]) -> None:
    items = pending()
    if args[:1] != ["add"] or len(args) < 2:
        return show(items)
    if len(args) == 3 and args[1].startswith("rq-"):  # another site's link → this YouTube video
        vid = youtube.video_id(args[2])
        if not vid or not re.fullmatch(r"rq-[\w-]+", args[1]):
            sys.exit("usage: add rq-… <YouTube link>")
        n = _on_server(f"from lemo_analyzer import userdata; print(userdata.set_target({args[1]!r}, {'yt-' + vid!r}))")
        print(f"{args[1]}: will be added as yt-{vid} ({n} request(s)); queued {queue([vid])} new song(s), starting within 10 minutes")
        return
    want = [r for r in items if r["target"] and ("all" in args[1:] or r["songId"] in args[1:] or r["target"] in args[1:])]
    print(f"queued {queue([r['target'][3:] for r in want])} new song(s) of {len(want)}; they start within 10 minutes")
    skipped = [r["songId"] for r in items if not r["target"] and ("all" in args[1:] or r["songId"] in args[1:])]
    if skipped:
        print("needs a YouTube link first (add rq-… <link>): " + ", ".join(skipped))


if __name__ == "__main__":
    main(sys.argv[1:])
