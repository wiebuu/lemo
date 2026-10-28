"""A song from a link to an audio file: Google Drive, Dropbox, OneDrive, or a direct
link to an .mp3 / .m4a / …. Downloaded here (it's then analysed on the singer's device,
like an upload). Only public internet addresses are fetched, never this server's own
network, and never more than the upload limit."""

from __future__ import annotations

import ipaddress
import re
import socket
import urllib.parse
import urllib.request
from email.message import Message
from pathlib import Path

AUDIO_EXT = (".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".webm", ".mp4")


class LinkError(Exception):
    """Said to the singer as is."""


def kind(url: str) -> str | None:
    """'drive' | 'dropbox' | 'onedrive' | 'audio' for links we can get a file from, else None."""
    u = urllib.parse.urlparse(url.strip())
    if u.scheme not in {"http", "https"} or not u.hostname:
        return None
    host = u.hostname.lower()
    if host in {"drive.google.com", "drive.usercontent.google.com", "docs.google.com"}:
        return "drive"
    if host.endswith("dropbox.com") or host.endswith("dropboxusercontent.com"):
        return "dropbox"
    if host in {"1drv.ms", "onedrive.live.com"} or host.endswith(".sharepoint.com"):
        return "onedrive"
    if u.path.lower().endswith(AUDIO_EXT):
        return "audio"
    return None


def direct(url: str) -> str:
    """The share link → a link that downloads the file itself."""
    url = url.strip()
    k = kind(url)
    u = urllib.parse.urlparse(url)
    if k == "drive":
        m = re.search(r"/d/([\w-]{10,})", u.path) or re.search(r"[?&]id=([\w-]{10,})", url)
        if not m:
            raise LinkError("That Google Drive link doesn't point to a file. Open the file in Drive and use Share → Copy link.")
        return f"https://drive.usercontent.google.com/download?id={m.group(1)}&export=download&confirm=t"
    if k == "dropbox":
        q = dict(urllib.parse.parse_qsl(u.query))
        q["dl"] = "1"
        return urllib.parse.urlunparse(u._replace(query=urllib.parse.urlencode(q)))
    if k == "onedrive":
        return url + ("&" if "?" in url else "?") + "download=1"
    return url


def _public(host: str) -> None:
    try:
        addrs = {ai[4][0] for ai in socket.getaddrinfo(host, None)}
    except socket.gaierror as e:
        raise LinkError("That link's website couldn't be found.") from e
    for a in addrs:
        ip = ipaddress.ip_address(a.split("%")[0])
        if not ip.is_global:
            raise LinkError("That link can't be used.")


class _Redirects(urllib.request.HTTPRedirectHandler):
    max_redirections = 8

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urllib.parse.urlparse(newurl)
        if u.scheme not in {"http", "https"} or not u.hostname:
            raise LinkError("That link can't be used.")
        _public(u.hostname)  # every hop: never into a private network
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _filename(resp, url: str) -> str:
    cd = resp.headers.get("Content-Disposition") or ""
    if cd:
        m = Message()
        m["content-disposition"] = cd
        name = m.get_filename()
        if name:
            return Path(name).name
    return Path(urllib.parse.unquote(urllib.parse.urlparse(url).path)).name or "song"


def download(url: str, dest_dir: Path, max_bytes: int, timeout: float = 30) -> tuple[Path, str]:
    """Fetch the audio file behind the link into dest_dir. Returns (file, its name)."""
    if kind(url) is None:
        raise LinkError("That isn't a link to an audio file.")
    target = direct(url)
    _public(urllib.parse.urlparse(target).hostname or "")
    opener = urllib.request.build_opener(_Redirects())
    req = urllib.request.Request(target, headers={"User-Agent": "Lemody/1.0 (+https://lemodysounds.online)"})
    try:
        resp = opener.open(req, timeout=timeout)
    except LinkError:
        raise
    except urllib.error.HTTPError as e:
        raise LinkError("That file isn't shared publicly. Share it with “anyone with the link” and try again."
                        if e.code in {401, 403, 404} else f"The link didn't work ({e.code}).") from e
    except Exception as e:
        raise LinkError("The link couldn't be opened. Check it and try again.") from e
    with resp:
        ctype = (resp.headers.get("Content-Type") or "").lower()
        if ctype.startswith("text/html"):
            raise LinkError("That link opens a web page, not the song file. Share the file with “anyone with the link”.")
        size = int(resp.headers.get("Content-Length") or 0)
        if size > max_bytes:
            raise LinkError(f"That file is larger than {max_bytes // 2**20} MB.")
        name = _filename(resp, resp.geturl())
        ext = Path(name).suffix.lower()
        out = dest_dir / f"link{ext if ext in AUDIO_EXT else '.audio'}"
        got = 0
        with out.open("wb") as f:
            while chunk := resp.read(1 << 20):
                got += len(chunk)
                if got > max_bytes:
                    out.unlink(missing_ok=True)
                    raise LinkError(f"That file is larger than {max_bytes // 2**20} MB.")
                f.write(chunk)
    if got < 10_000:
        out.unlink(missing_ok=True)
        raise LinkError("That link didn't give a song file.")
    return out, name
