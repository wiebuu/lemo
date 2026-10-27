"""Lyrics lookup across several free sources, asked at the same time:

  LRCLIB            community synced lyrics (lrclib.net)
  NetEase           NetEase Cloud Music's synced lyrics — a big catalogue, incl. Bollywood
  YouTube           the lyrics in the video's description, and its uploaded captions
                    (never auto-generated speech-to-text)
  lyrics.ovh        plain text only, as a last resort

Synced lyrics with a matching song length win. Every candidate is returned, so
the singer can pick another source if the first one is wrong."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = "lemo/0.1 (local singing practice)"
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"

# Credit lines some sources put first ("作词 : …" = lyricist, "作曲" = composer …).
CREDIT = re.compile(r"^\s*(作词|作曲|编曲|制作人|词|曲|混音|lyrics?|lyricist|composer|music|written by|producer|(?:performed|composed|produced|arranged|written|sung) by)\s*[:：]", re.I)
VERSION = re.compile(r"\b(remix|lo-?fi|flip|cover|slowed|reverb|instrumental|karaoke|8d|mashup|version|live)\b", re.I)
LRC_LINE = re.compile(r"^((?:\[\d+:\d+(?:[.:]\d+)?\])+)(.*)$")


def _http(url: str, data: bytes | None = None, headers: dict | None = None, timeout: float = 12) -> bytes | None:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, **(headers or {})})
    for attempt in range(2):  # these free services hiccup now and then: one retry
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if attempt or e.code < 500:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt:
                raise
    return None


def _json(url: str, **kw) -> object | None:
    raw = _http(url, **kw)
    return json.loads(raw.decode()) if raw else None


def _norm(s: str | None) -> str:
    return re.sub(r"[^a-z0-9ऀ-ॿ؀-ۿ]", "", (s or "").lower())


def base_title(title: str) -> str:
    """'Raataan Lambiyan (From "Shershaah")' → 'Raataan Lambiyan'."""
    return re.sub(r"\s*[\(\[][^)\]]*[\)\]]", "", title).strip() or title


def clean_lrc(lrc: str) -> str:
    """Drop credit lines and empty timestamps that some sources include."""
    out = []
    for line in lrc.splitlines():
        m = LRC_LINE.match(line.strip())
        if m and (not m.group(2).strip() or CREDIT.match(m.group(2))):
            continue
        out.append(line)
    return "\n".join(out).strip()


# ---- sources ----------------------------------------------------------------------


def _lrclib(title: str, artist: str, duration: float) -> list[dict]:
    base = "https://lrclib.net/api"
    def q(path: str, p: dict) -> object | None:
        try:
            return _json(f"{base}/{path}?{urllib.parse.urlencode({k: v for k, v in p.items() if v})}")
        except urllib.error.HTTPError as e:
            if e.code >= 500:  # its exact-match lookup errors for unknown songs; the searches still work
                return None
            raise

    found: list = []
    hit = q("get", {"track_name": title, "artist_name": artist, "duration": int(duration) if duration else None})
    if isinstance(hit, dict):
        found.append(hit)
    for params in ({"track_name": base_title(title), "artist_name": artist}, {"q": f"{artist} {base_title(title)}".strip()}):
        res = q("search", params)
        if isinstance(res, list):
            found += res[:8]
    return [
        {"source": "lrclib", "match": f"{r.get('artistName', '?')} – {r.get('trackName', '?')}", "track": r.get("trackName"),
         "duration": r.get("duration"), "synced": r.get("syncedLyrics"), "plain": r.get("plainLyrics")}
        for r in found if r.get("syncedLyrics") or r.get("plainLyrics")
    ]


def _netease(title: str, artist: str, duration: float) -> list[dict]:
    headers = {"User-Agent": BROWSER_UA, "Referer": "https://music.163.com"}
    body = urllib.parse.urlencode({"s": f"{base_title(title)} {artist}".strip(), "type": 1, "limit": 6}).encode()
    res = _json("https://music.163.com/api/cloudsearch/pc", data=body, headers=headers) or {}
    out = []
    for song in (res.get("result") or {}).get("songs", [])[:4]:
        lrc = ((_json(f"https://music.163.com/api/song/lyric?id={song['id']}&lv=1&kv=1&tv=-1", headers=headers) or {}).get("lrc") or {}).get("lyric")
        if not lrc or len(re.findall(r"^\[\d+:\d+", lrc, re.M)) < 5:  # instrumentals come back as one "pure music" line
            continue
        artists = ", ".join(a.get("name", "") for a in song.get("ar", []))
        out.append({"source": "netease", "match": f"{artists} – {song.get('name')}", "track": song.get("name"),
                    "duration": (song.get("dt") or 0) / 1000 or None, "synced": lrc, "plain": None})
    return out


def _vtt_to_lrc(vtt: str) -> str:
    lines, last = [], None
    for block in re.split(r"\n\s*\n", vtt):
        m = re.search(r"(\d+):(\d+):(\d+)[.,](\d+)\s+-->", block) or re.search(r"(?:^|\n)(\d+):(\d+)[.,](\d+)\s+-->", block)
        if not m:
            continue
        g = [int(x) for x in m.groups()]
        secs = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000 if len(g) == 4 else g[0] * 60 + g[1] + g[2] / 1000
        text = " ".join(re.sub(r"<[^>]+>", "", t).strip() for t in block.split("\n")[1:] if "-->" not in t).strip()
        text = re.sub(r"^[♪♫\s]+|[♪♫\s]+$", "", text)
        if text and text != last:
            lines.append(f"[{int(secs // 60):02d}:{secs % 60:05.2f}]{text}")
            last = text
    return "\n".join(lines)


LYRICS_HEAD = re.compile(r"^\s*[#*_\-–—=\s]*(?:full\s+)?lyrics?\s*(?:of the song)?\s*[:\-–—]*\s*$", re.I)
NOT_LYRICS = re.compile(r"https?://|www\.|^\s*#|@\w|subscribe|follow\b|instagram|facebook|twitter|spotify|apple music|"
                        r"^\s*(?:song|singer|artist|music|lyrics?|composer|producer|prod\.?|mix|master|director|label|written|"
                        r"video|dop|edit|credits?|copyright|℗|©)\b.*[:\-–]", re.I)


def description_lyrics(desc: str) -> str | None:
    """The lyrics block many official uploads put in their description, after a
    "LYRICS -" heading: lines up to the hashtags / links / credits that follow."""
    lines = desc.splitlines()
    start = next((i for i, ln in enumerate(lines) if LYRICS_HEAD.match(ln)), None)
    if start is None:
        return None
    out: list[str] = []
    blank = 0
    for ln in lines[start + 1 :]:
        text = ln.strip()
        if not text:
            blank += 1
            if out and blank >= 4:  # a long gap: the lyrics are over
                break
            continue
        if NOT_LYRICS.search(text):
            if out:
                break
            continue
        blank = 0
        out.append(text)
    return "\n".join(out) if len(out) >= 6 else None


def auto_caption_lrc(data: dict) -> str:
    """YouTube's automatic captions (word-timed "json3") → timed lines. They roll —
    each caption repeats the one before — so the words are rebuilt from their own
    times instead, and lines break where the singer pauses (a gap well beyond the
    song's usual gap between words). "[Music]" / "[संगीत]" markers are dropped."""
    words: list[tuple[float, str]] = []
    for ev in data.get("events") or []:
        t0 = ev.get("tStartMs")
        for seg in ev.get("segs") or []:
            w = (seg.get("utf8") or "").strip()
            if not w or t0 is None or (w.startswith("[") and w.endswith("]")):
                continue
            words.append(((t0 + (seg.get("tOffsetMs") or 0)) / 1000, w))
    words.sort()
    if len(words) < 8:
        return ""
    gaps = sorted(b[0] - a[0] for a, b in zip(words, words[1:]))
    pause = max(0.7, 2.0 * gaps[len(gaps) // 2])
    lines: list[list[tuple[float, str]]] = [[words[0]]]
    for prev, cur in zip(words, words[1:]):
        if cur[0] - prev[0] > pause or len(lines[-1]) >= 10:
            lines.append([])
        lines[-1].append(cur)
    return "\n".join(f"[{int(ln[0][0] // 60):02d}:{ln[0][0] % 60:05.2f}]{' '.join(w for _, w in ln)}" for ln in lines)


def _youtube(video_id: str) -> list[dict]:
    """From the video itself: the lyrics in its description (official uploads often have
    them), and captions the uploader added. Auto captions are skipped: speech
    recognition on singing is too unreliable to practise with."""
    r = subprocess.run([sys.executable, "-m", "yt_dlp", "-J", "--no-warnings", "--skip-download",
                        f"https://www.youtube.com/watch?v={video_id}"], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        return []
    meta = json.loads(r.stdout)
    out: list[dict] = []
    words = description_lyrics(meta.get("description") or "")
    if words:
        out.append({"source": "youtube description", "match": f"{meta.get('uploader', '?')} – {meta.get('title', '?')}",
                    "track": meta.get("track") or meta.get("title"), "duration": meta.get("duration"), "synced": None,
                    "plain": words, "fromVideo": True})
    subs = meta.get("subtitles") or {}
    order = sorted(subs, key=lambda l: (not l.startswith(("hi", "en", "ur", "pa")), l))
    for lang in order:
        vtt = next((f for f in subs[lang] if f.get("ext") == "vtt"), None)
        if not vtt:
            continue
        raw = _http(vtt["url"], timeout=15)
        lrc = _vtt_to_lrc(raw.decode(errors="replace")) if raw else ""
        if lrc.count("\n") >= 5:
            video_lang = (meta.get("language") or "").split("-")[0]
            out.append({"source": "youtube captions", "match": f"{meta.get('uploader', '?')} – {meta.get('title', '?')} ({lang})",
                        "track": meta.get("track") or meta.get("title"), "duration": meta.get("duration"), "synced": lrc, "plain": None,
                        # English captions on a Hindi / Urdu video are usually a translation, not the sung words
                        "translation": lang.startswith("en") and bool(video_lang) and not video_lang.startswith("en")})
            break
    if not any(c["source"] == "youtube captions" for c in out):
        # no captions from the uploader: YouTube's automatic ones — speech-to-text of the
        # singing, in the song's own language only ("-orig"), never its machine translations
        auto = meta.get("automatic_captions") or {}
        lang = next((k for k in auto if k.endswith("-orig")), None)
        fmt = next((f for f in auto.get(lang, []) if f.get("ext") == "json3"), None) if lang else None
        if fmt:
            try:
                raw = _http(fmt["url"], timeout=15)
                lrc = auto_caption_lrc(json.loads(raw)) if raw else ""
            except (ValueError, urllib.error.URLError, TimeoutError):
                lrc = ""
            if lrc.count("\n") >= 5:
                out.append({"source": "youtube auto captions", "match": f"{meta.get('uploader', '?')} – {meta.get('title', '?')} ({lang})",
                            "track": meta.get("track") or meta.get("title"), "duration": meta.get("duration"), "synced": lrc,
                            "plain": None, "auto": True})
    return out


def _lyrics_ovh(title: str, artist: str) -> list[dict]:
    if not artist:
        return []
    res = _json(f"https://api.lyrics.ovh/v1/{urllib.parse.quote(artist)}/{urllib.parse.quote(base_title(title))}", timeout=8)
    text = (res or {}).get("lyrics") if isinstance(res, dict) else None
    return [{"source": "lyrics.ovh", "match": f"{artist} – {title}", "track": title, "duration": None, "synced": None, "plain": text}] if text else []


# ---- choosing -----------------------------------------------------------------------


def _score(c: dict, title: str, duration: float) -> float:
    s = 0.0 if c.get("synced") else 100.0
    if duration and c.get("duration"):
        s += min(60.0, abs(float(c["duration"]) - duration))
    else:
        s += 15.0
    track = c.get("track") or ""
    if _norm(base_title(title)) not in _norm(track) and _norm(track) not in _norm(title):
        s += 40.0
    if VERSION.search(track) and not VERSION.search(title):
        s += 30.0  # a remix / lo-fi edit has different timing
    if re.search(r"[\(\[]", track) and not re.search(r"[\(\[]", title):
        s += 5.0  # "Song (Paused)", "(Acoustic)" …: the plain title is more likely the original
    if c.get("auto"):
        return 90.0  # speech-to-text: below every real lyrics source unless the singing check says otherwise
    if c["source"] == "youtube description":
        # the uploader's own words for this very video: trusted over a lyrics database's
        # guess, unless that one is synced, the same song and the same length
        return 20.0
    if c["source"] == "youtube captions":
        s += 10.0  # the uploader's own text can be a translation or have notes: prefer a lyrics database's match
        if c.get("translation"):
            s += 60.0
    return s


def readable_script(lrc: str) -> bool:
    """Mostly Latin (English, Hinglish) or Devanagari letters — not Gurmukhi, Urdu, Chinese …"""
    from .translit import DEVA, LATIN

    text = re.sub(r"\[[^\]]*\]", "", lrc)
    letters = re.findall(r"[^\W\d_]", text)
    return bool(letters) and (len(DEVA.findall(text)) + len(LATIN.findall(text))) / len(letters) >= 0.6


def find(title: str, artist: str, duration: float, video_id: str | None = None, notes: list[dict] | None = None) -> dict:
    """Every source at once. With the song's vocal `notes`, timed versions are checked
    against the singing (lyrics_fit): versions that fit come first, best fit first —
    only then the video's own description (timed to the singer), then the rest."""
    jobs = {
        "lrclib": lambda: _lrclib(title, artist, duration),
        "netease": lambda: _netease(title, artist, duration),
        "lyrics.ovh": lambda: _lyrics_ovh(title, artist),
    }
    if video_id:
        jobs["youtube"] = lambda: _youtube(video_id)
    candidates: list[dict] = []
    failed: list[str] = []
    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        futures = {name: pool.submit(fn) for name, fn in jobs.items()}
        for name, fut in futures.items():
            try:
                candidates += fut.result(timeout=70)
            except Exception:  # one source down shouldn't hide the others
                failed.append(name)
    for c in candidates:
        if c.get("synced"):
            c["synced"] = clean_lrc(c["synced"]) or None
    candidates = [c for c in candidates if c.get("synced") or c.get("plain")]
    candidates.sort(key=lambda c: _score(c, title, duration))
    if notes:
        from . import lyrics_fit

        for c in candidates:
            if c.get("synced") and not c.get("translation"):
                f, off, f0 = lyrics_fit.fit(c["synced"], notes, duration)
                c["fit"] = f
                c["fits"] = lyrics_fit.matches(f, c.get("duration"), duration)
                if c["fits"] and abs(off) >= 1.5 and f - f0 >= 0.08:  # right lyrics, shifted: move them into place
                    c["synced"] = lyrics_fit.shift_lrc(c["synced"], off)
                    c["shifted"] = off

        def group(c: dict) -> tuple:
            if c.get("fits") and c.get("auto"):  # its words can be off: only when no real lyrics fit
                return (0.5, -c["fit"])
            if c.get("fits"):
                # near-equal fits: the version in a script most singers read (Hinglish, Hindi) first
                readable = readable_script(c["synced"])
                return (0, -(lyrics_fit.rank(c["fit"], c.get("duration"), duration) + (0.03 if readable else 0)))
            if c.get("fromVideo") and c.get("plain"):
                return (1, 0)
            return (2 if c.get("synced") else 3, _score(c, title, duration))

        candidates.sort(key=group)
        if candidates and not candidates[0].get("fits") and candidates[0].get("synced") and not candidates[0].get("fromVideo") and not candidates[0].get("auto"):
            # nothing fits this recording (often another edit of the song): keep the best
            # version's words, drop its timing — the app times them to the singer instead
            top = candidates[0]
            words = "\n".join(t for _, t in lyrics_fit.lrc_lines(top["synced"]) if t)
            candidates.insert(0, {**top, "synced": None, "plain": words, "retimed": True, "fit": None, "fits": False})
    # One entry per set of words: lyrics sites keep the same lyrics many times over (one
    # per upload length); the list is already best-first, so the best-fitting copy stays.
    seen, unique = set(), []
    for c in candidates:
        words = _norm(re.sub(r"\[[^\]]*\]", "", c.get("synced") or c.get("plain") or ""))
        key = (words, bool(c.get("synced")), bool(c.get("retimed")))
        if key not in seen:
            seen.add(key)
            from .translit import script_of

            entry = {k: c.get(k) for k in ("source", "match", "duration", "synced", "plain", "fit", "fits", "retimed")}
            entry["script"] = script_of(re.sub(r"\[[^\]]*\]", "", entry["synced"] or entry["plain"] or ""))
            unique.append(entry)
    best = unique[0] if unique else {"source": None, "match": None, "synced": None, "plain": None}
    if notes and best.get("source") == "youtube auto captions" and not best.get("fits"):
        # speech-to-text that doesn't even fit the singing is noise: no lyrics rather than wrong ones
        best = {"source": None, "match": None, "synced": None, "plain": None}
    return {**best, "candidates": unique[:8], "failedSources": failed}
