"""Emails to singers: "the song you asked for is in Lemody now".

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


def _send(messages: list[EmailMessage], creds: tuple[str, str]) -> None:
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=30) as s:
            s.login(*creds)
            for m in messages:
                try:
                    s.send_message(m)
                except Exception as e:  # one bad address shouldn't stop the rest
                    print(f"could not email {m['To']}: {e}", flush=True)
    except Exception as e:
        print(f"could not send song-added emails: {e}", flush=True)


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
