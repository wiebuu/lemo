"""Emails to singers: "the song you asked for is in Lemody now", and to Lemody's owner
(LEMO_OWNER_EMAIL) about each song a singer asks for.

Two ways to send, from analyzer/.env:
- MAIL_RELAY_URL + MAIL_RELAY_SECRET: a Google Apps Script web app on the Gmail account
  (tools/mail-relay.gs) that sends what it's given, over HTTPS. For the VPS, whose host
  blocks the mail ports (465 / 587).
- EMAIL_USER / EMAIL_PASS: Gmail SMTP with an app password.
Without either nothing is sent. Sending happens in a background thread, so a slow or
failing mail server never holds up the song list."""

from __future__ import annotations

import html
import os
import smtplib
import ssl
import json
import threading
import urllib.request
from email.message import EmailMessage

from . import config  # noqa: F401  (loads analyzer/.env into the environment)

SITE = "https://lemodysounds.online"


def _creds() -> tuple[str, str] | None:
    user = os.environ.get("EMAIL_USER", "").strip()
    pw = os.environ.get("EMAIL_PASS", "").replace(" ", "").strip()
    return (user, pw) if user and pw else None


def _relay() -> tuple[str, str] | None:
    url = os.environ.get("MAIL_RELAY_URL", "").strip()
    secret = os.environ.get("MAIL_RELAY_SECRET", "").strip()
    return (url, secret) if url.startswith("https://") and secret else None


def can_send() -> bool:
    """Email can go out from here: through the relay, or a Gmail account."""
    return _relay() is not None or _creds() is not None


def _from() -> str:
    """The address emails are from (with the relay, Gmail sends them as its own account)."""
    c = _creds()
    return c[0] if c else os.environ.get("MAIL_FROM", "wiecodes@gmail.com").strip()


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


def _send(messages: list[EmailMessage]) -> bool:
    """Send through the relay if there is one, else Gmail SMTP. False when nothing went out."""
    relay = _relay()
    if relay:
        return _send_relay(messages, *relay)
    creds = _creds()
    if not creds:
        return False
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


def _send_relay(messages: list[EmailMessage], url: str, secret: str) -> bool:
    """Each message to the Apps Script relay as JSON. True when at least one went out."""
    ok = False
    for m in messages:
        html_part = m.get_body(("html",))
        body = {
            "secret": secret,
            "to": str(m["To"]),
            "subject": str(m["Subject"]),
            "text": m.get_body(("plain",)).get_content(),
            "html": html_part.get_content() if html_part else "",
        }
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:  # Apps Script answers via a redirect: followed
                answer = r.read().decode(errors="replace").strip()
            if answer == "ok":
                ok = True
            else:
                print(f"mail relay refused {m['To']}: {answer[:200]}", flush=True)
        except Exception as e:
            print(f"could not reach the mail relay for {m['To']}: {e}", flush=True)
    return ok


def song_already_message(sender: str, to: str, name: str | None, asked: str | None, title: str, artist: str | None) -> EmailMessage:
    """The song a singer asked for was in Lemody already (under another name, perhaps):
    what to search for. It's in their song list too."""
    song = " · ".join(x for x in (title, artist) if x)
    hi = f"Hi {name.split()[0]}," if name and name.strip() else "Hi,"
    was = f" ({asked})" if asked and asked.strip().lower() != title.strip().lower() else ""
    msg = EmailMessage()
    msg["Subject"] = f"Your song is already in Lemody: {title}"
    msg["From"] = f"Lemody <{sender}>"
    msg["To"] = to
    msg.set_content(f"{hi}\n\nThe song you asked for{was} is already in Lemody, as \"{song}\".\n\n"
                    f"Search for \"{title}\" to find it. It's in your song list too, ready to sing.\n\n{SITE}\n\nHappy singing,\nLemody")
    msg.add_alternative(
        f"""<p>{html.escape(hi)}</p>
<p>The song you asked for{html.escape(was)} is already in Lemody, as <b>{html.escape(song)}</b>.</p>
<p>Search for <b>“{html.escape(title)}”</b> to find it. It's in your song list too, ready to sing.</p>
<p><a href="{SITE}">Sing it now</a></p>
<p>Happy singing,<br>Lemody</p>""",
        subtype="html",
    )
    return msg


def notify_song_already(people: list[dict], asked: str | None, title: str, artist: str | None) -> int:
    """Tell everyone who asked that the song was here already. Returns how many emails went out."""
    if not can_send():
        return 0
    msgs = [song_already_message(_from(), p["email"], p.get("name"), asked, title, artist)
            for p in people if p.get("email") and "@" in p["email"]]
    return len(msgs) if msgs and _send(msgs) else 0


def notify_song_added(people: list[dict], title: str | None, artist: str | None, song_id: str, wait: bool = False) -> int:
    """Email everyone in `people` ({email, name}) that their requested song is in. Returns
    how many emails are going out."""
    if not can_send():
        return 0
    msgs = [song_added_message(_from(), p["email"], p.get("name"), title, artist, song_id)
            for p in people if p.get("email") and "@" in p["email"]]
    if msgs:
        t = threading.Thread(target=_send, args=(msgs,), daemon=True, name="lemo-mail")
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
    owner = os.environ.get("LEMO_OWNER_EMAIL", "").strip()
    if not can_send() or "@" not in owner:
        return False
    return not requests or _send([song_requested_message(_from(), owner, r) for r in requests])
