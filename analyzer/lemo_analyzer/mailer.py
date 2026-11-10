"""Emails to singers: "the song you asked for is in Lemody now", and to Lemody's owner
(LEMO_OWNER_EMAIL) about each song a singer asks for.

Sent through Gmail SMTP with EMAIL_USER / EMAIL_PASS (an app password) from analyzer/.env.
Without them nothing is sent. Sending happens in a background thread, so a slow or
failing mail server never holds up the song list."""

from __future__ import annotations

import html
import os
import smtplib
import ssl
import threading
from email.message import EmailMessage

from . import config  # noqa: F401  (loads analyzer/.env into the environment)

SITE = "https://lemodysounds.online"


def _creds() -> tuple[str, str] | None:
    user = os.environ.get("EMAIL_USER", "").strip()
    pw = os.environ.get("EMAIL_PASS", "").replace(" ", "").strip()
    return (user, pw) if user and pw else None


def song_added_message(sender: str, to: str, name: str | None, title: str | None, artist: str | None, song_id: str) -> EmailMessage:
    song = " · ".join(x for x in (title, artist) if x) or "The song you asked for"
    link = SITE  # it's already in their song list there
    hi = f"Hi {name.split()[0]}," if name and name.strip() else "Hi,"
    msg = EmailMessage()
    msg["Subject"] = f"Your song is in Lemody: {title or song}"
    msg["From"] = f"Lemody <{sender}>"
    msg["To"] = to
    msg.set_content(f"{hi}\n\n{song} is now in Lemody. It's in your song list, ready to sing.\n\n{link}\n\nHappy singing,\nLemody")
    msg.add_alternative(
        f"""<p>{html.escape(hi)}</p>
<p><b>{html.escape(song)}</b> is now in Lemody. It's in your song list, ready to sing.</p>
<p><a href="{link}">Sing it now</a></p>
<p>Happy singing,<br>Lemody</p>""",
        subtype="html",
    )
    return msg


def _send(messages: list[EmailMessage], creds: tuple[str, str]) -> bool:
    """False when the mail server couldn't be reached (the VPS, for one, can't: its host
    blocks mail ports)."""
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=30) as s:
            s.login(*creds)
            for m in messages:
                try:
                    s.send_message(m)
                except Exception as e:  # one bad address shouldn't stop the rest
                    print(f"could not email {m['To']}: {e}", flush=True)
        return True
    except Exception as e:
        print(f"could not send emails: {e}", flush=True)
        return False


def notify_song_added(people: list[dict], title: str | None, artist: str | None, song_id: str, wait: bool = False) -> int:
    """Email everyone in `people` ({email, name}) that their requested song is in. Returns
    how many emails are going out."""
    creds = _creds()
    if not creds:
        return 0
    msgs = [song_added_message(creds[0], p["email"], p.get("name"), title, artist, song_id)
            for p in people if p.get("email") and "@" in p["email"]]
    if msgs:
        t = threading.Thread(target=_send, args=(msgs, creds), daemon=True, name="lemo-mail")
        t.start()
        if wait:
            t.join()
    return len(msgs)


def song_requested_message(sender: str, to: str, r: dict) -> EmailMessage:
    """r: one request ({title, artist, url, name, email, waiting})."""
    song = " · ".join(x for x in (r.get("title"), r.get("artist")) if x) or r["url"]
    by = " ".join(x for x in (r.get("name"), f"<{r['email']}>" if r.get("email") else None) if x) or "A guest singer"
    more = f" ({r['waiting']} singers are waiting for it now)" if r.get("waiting", 1) > 1 else ""
    msg = EmailMessage()
    msg["Subject"] = f"Song request: {r.get('title') or song}"
    msg["From"] = f"Lemody <{sender}>"
    msg["To"] = to
    msg.set_content(f"{by} asked for a song{more}:\n\n{song}\n{r['url']}\n\nAdd it to analyzer/featured.json and it goes into their song list once it's analysed.")
    msg.add_alternative(
        f"""<p>{html.escape(by)} asked for a song{html.escape(more)}:</p>
<p><b>{html.escape(song)}</b><br><a href="{html.escape(r['url'])}">{html.escape(r['url'])}</a></p>
<p>Add it to analyzer/featured.json and it goes into their song list once it's analysed.</p>""",
        subtype="html",
    )
    return msg


def tell_owner(requests: list[dict]) -> bool:
    """Email the owner (LEMO_OWNER_EMAIL) one message per request, right away. True when
    they went out; False when they couldn't (no account or owner set, or no mail server)."""
    creds, owner = _creds(), os.environ.get("LEMO_OWNER_EMAIL", "").strip()
    if not creds or "@" not in owner:
        return False
    return not requests or _send([song_requested_message(creds[0], owner, r) for r in requests], creds)
