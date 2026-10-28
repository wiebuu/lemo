"""lemo analyzer HTTP API (FastAPI). Runs locally; the web app proxies /api here."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import tempfile
from pathlib import Path

import threading
import time

from fastapi import Body, FastAPI, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from starlette.requests import Request

from starlette.concurrency import run_in_threadpool
from . import audio, auth, catalog, device, jobs, lyrics, remote, storage, userdata, worker, youtube
from .config import CONFIG, FFMPEG, RUBBERBAND, device_name

app = FastAPI(title="Lemody analyzer", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(CONFIG.cors_origins),
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)

# Only the health check is open; everything else needs a Google sign-in (see auth.py).
OPEN_PATHS = {"/api/health"}


@app.middleware("http")
async def require_google_sign_in(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.url.path not in OPEN_PATHS and request.method != "OPTIONS":
        try:
            request.state.user = auth.verify(request.headers.get("authorization"))
        except auth.AuthError as e:
            return JSONResponse({"detail": str(e)}, status_code=401)
    return await call_next(request)


@app.on_event("shutdown")
def _shutdown() -> None:
    worker.log("analyzer shutting down (it was asked to stop: Ctrl-C, a closed terminal, or a kill)")


@app.on_event("startup")
def _startup() -> None:
    def tidy() -> None:
        storage.migrate()
        storage.trim()
        # songs not yet on the VPS (from before it was set up, or whose copy failed) — and
        # every 5 minutes after, so a dropped connection sorts itself out
        remote.keep_in_sync(storage.songs_root())
        catalog.backfill()  # previews + search entries for songs from before search existed
        # songs another machine added to the VPS since: listed within 10 minutes
        def relist() -> None:
            while True:
                time.sleep(600)
                try:
                    catalog.backfill()
                    storage.trim()
                except Exception as e:
                    print(f"could not refresh the song list: {e}", flush=True)

        threading.Thread(target=relist, daemon=True, name="lemo-relist").start()
        from . import lyrics_prep

        lyrics_prep.catch_up_forever()  # stored songs still without lyrics, while idle
        remote.push_models(CONFIG.data_dir / "models")  # for browsers that analyse songs themselves
        if CONFIG.enable_youtube and CONFIG.server_analysis:
            # resume featured songs that weren't finished, and look again every 10 minutes
            # (newly added ones, or one that failed earlier)
            while True:
                _queue_featured()
                time.sleep(600)

    worker.log("analyzer started")
    threading.Thread(target=tidy, daemon=True, name="lemo-tidy").start()


# When a singer last used the app.
_activity = {"at": 0.0}


def _active() -> None:
    _activity["at"] = time.time()


SONG_ID = re.compile(r"^(yt|up)-[A-Za-z0-9_-]{8,40}$")


def _song(song_id: str) -> Path:
    if not SONG_ID.match(song_id):
        raise HTTPException(400, "invalid song id")
    return jobs.song_dir(song_id)


def _here(d: Path) -> bool:
    """Make sure this machine has the song's files (fetching them back from the VPS if needed)."""
    return (d / "reference.json").exists() or remote.pull(d)


@app.get("/api/health")
def health() -> dict:
    yt_ok, yt_reason = youtube.available()
    if not CONFIG.enable_youtube:
        yt_ok, yt_reason = False, "YouTube import is off. Set LEMO_ENABLE_YOUTUBE=true in analyzer/.env and restart the analyzer."
    import importlib.util

    separation = CONFIG.server_analysis and importlib.util.find_spec("demucs") is not None

    return {
        "ok": True,
        "youtube": yt_ok and bool(FFMPEG),
        "youtubeReason": yt_reason,
        "separation": separation,
        "melody": CONFIG.melody_model,
        "rubberband": bool(RUBBERBAND),
        "ffmpeg": bool(FFMPEG),
        "device": device_name(),
        "storage": {**storage.usage(), "freeMb": round(storage.free_mb())},
        "signIn": "google" if auth.configured() else "not set up",
        "userData": userdata.status(),
        # how long a new song takes here: about this × its length (learned from finished songs)
        "analysisRate": round(sum(jobs.rates().values()), 2),
        "analysisFixedSec": jobs.FETCH_FIXED,
        # songs ahead in the server's queue right now, and roughly how long they'll take
        "queue": jobs.MANAGER.queue(),
    }


def _require_space(song_id: str) -> None:
    """New songs are refused once lemo's song storage reaches its limit (LEMO_SONG_LIMIT_GB).
    A song that's already stored is fine: it doesn't take more space."""
    if (jobs.song_dir(song_id) / "reference.json").exists() or remote.has(song_id) or not storage.full():
        return
    used = storage.songs_bytes() / 1024**3
    raise HTTPException(
        507,
        {
            "code": "storage_full",
            "message": f"Lemody's song storage is full ({used:.1f} of {CONFIG.song_limit_gb:g} GB used), so new songs can't be added right now.",
            "usedGb": round(used, 2),
            "limitGb": CONFIG.song_limit_gb,
        },
    )


def _make_room(song_id: str) -> None:
    """A singer's own song goes first: stop background preparation of a featured
    song (it's picked up again later, when nobody is practising)."""
    _active()
    keep = storage.prepare_ids()
    if song_id in keep:
        return
    for sid, job in list(jobs.MANAGER.jobs.items()):
        if sid in keep and job.stage not in {"done", "failed", "cancelled"}:
            jobs.MANAGER.cancel(sid)


def _no_server_analysis() -> None:
    if not CONFIG.server_analysis:
        raise HTTPException(503, {
            "code": "server_analysis_off",
            "message": "Lemody's server doesn't analyse new songs. Paste the song's YouTube link and choose \u201cthis computer\u201d or \u201cthis phone\u201d to analyse it on your device.",
        })


@app.post("/api/songs/analyze")
async def analyze(url: str | None = Form(None), file: UploadFile | None = None) -> dict:
    if url:
        if not CONFIG.enable_youtube:
            raise HTTPException(403, "YouTube import is disabled (LEMO_ENABLE_YOUTUBE=false).")
        vid = youtube.video_id(url)
        if not vid:
            raise HTTPException(400, "Not a valid YouTube video URL.")
        if not CONFIG.server_analysis and (st := jobs.MANAGER.status(f"yt-{vid}")) and st["stage"] == "done":
            return st  # already in Lemody
        _no_server_analysis()
        _require_space(f"yt-{vid}")
        _make_room(f"yt-{vid}")
        return jobs.MANAGER.submit(f"yt-{vid}", {"kind": "youtube", "videoId": vid})

    if file is None:
        raise HTTPException(400, "Send either a YouTube `url` or an audio `file`.")
    ext = Path(file.filename or "").suffix.lower()
    if ext not in audio.ALLOWED_EXT and not (file.content_type or "").startswith("audio/"):
        raise HTTPException(415, f"Unsupported file type. Use one of: {', '.join(sorted(audio.ALLOWED_EXT))}")

    limit = CONFIG.max_upload_mb * 1024 * 1024
    h = hashlib.sha1()
    size = 0
    tmp = Path(tempfile.mkstemp(suffix=ext or ".audio", dir=CONFIG.data_dir)[1])
    try:
        with tmp.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"File is larger than {CONFIG.max_upload_mb} MB.")
                h.update(chunk)
                out.write(chunk)
        song_id = f"up-{h.hexdigest()[:16]}"
        d = jobs.song_dir(song_id)
        if (d / "reference.json").exists():
            tmp.unlink()
            return jobs.MANAGER.status(song_id)
        _no_server_analysis()
        _require_space(song_id)  # the upload is discarded (finally below) when storage is full
        d.mkdir(parents=True, exist_ok=True)
        dest = d / f"source{ext or '.audio'}"
        shutil.move(str(tmp), dest)
        _make_room(song_id)
        return jobs.MANAGER.submit(song_id, {"kind": "upload", "path": str(dest), "name": file.filename})
    finally:
        tmp.unlink(missing_ok=True)


# ---- analysing on the singer's own device (no waiting in the queue) — see device.py ----

MODELS = {"htdemucs.onnx", "crepe-full.onnx"}


@app.get("/api/models/{name}")
def model_file(name: str):
    """The two models a browser needs to analyse a song itself (~263 MB; the browser keeps them)."""
    if name not in MODELS:
        raise HTTPException(404, "unknown model")
    f = CONFIG.data_dir / "models" / name
    if remote.enabled() and remote.has_model(name, f):
        return RedirectResponse(remote.signed_url("_models", name, ttl=3600), status_code=307)
    if not f.exists():
        raise HTTPException(404, "model not installed on the server")
    return FileResponse(f, media_type="application/octet-stream", headers={"Cache-Control": "private, max-age=86400"})


@app.post("/api/songs/device/start")
def device_start(url: str = Form(...)) -> dict:
    """Step 1: the server gets the song's audio (quick, no queue) for the browser to analyse."""
    if not CONFIG.enable_youtube:
        raise HTTPException(403, "YouTube import is disabled (LEMO_ENABLE_YOUTUBE=false).")
    vid = youtube.video_id(url)
    if not vid:
        raise HTTPException(400, "Not a valid YouTube video URL.")
    song_id = f"yt-{vid}"
    d = jobs.song_dir(song_id)
    if (d / "reference.json").exists() or remote.has(song_id):
        return {"id": song_id, "state": "done", "progress": 1, "message": "ready"}
    _require_space(song_id)
    _active()
    job = jobs.MANAGER.jobs.get(song_id)
    if job and job.stage not in {"done", "failed", "cancelled"}:
        if job.stage != "queued":
            return {**job.public(), "state": "server"}  # the server is already on it: just wait for that
        # still waiting in the queue: this device goes ahead; the queued job skips it once it's done
    return device.start(song_id, vid)


@app.post("/api/songs/device/upload")
async def device_upload(file: UploadFile) -> dict:
    """Step 1, from the singer's own audio file: it's kept here (to check the result
    against) and handed back to the browser to analyse."""
    ext = Path(file.filename or "").suffix.lower()
    if ext not in audio.ALLOWED_EXT and not (file.content_type or "").startswith("audio/"):
        raise HTTPException(415, f"Unsupported file type. Use one of: {', '.join(sorted(audio.ALLOWED_EXT))}")
    limit = CONFIG.max_upload_mb * 1024 * 1024
    h = hashlib.sha1()
    size = 0
    tmp = Path(tempfile.mkstemp(suffix=ext or ".audio", dir=CONFIG.data_dir)[1])
    try:
        with tmp.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"File is larger than {CONFIG.max_upload_mb} MB.")
                h.update(chunk)
                out.write(chunk)
        song_id = f"up-{h.hexdigest()[:16]}"
        if (jobs.song_dir(song_id) / "reference.json").exists() or remote.has(song_id):
            return {"id": song_id, "state": "done", "progress": 1, "message": "ready"}
        _require_space(song_id)
        _active()
        return device.start_upload(song_id, tmp, file.filename or "my song")  # takes the file over
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


@app.get("/api/songs/device/{song_id}")
def device_status(song_id: str) -> dict:
    _song(song_id)
    st = device.status(song_id)
    if st is None:
        if (jobs.song_dir(song_id) / "reference.json").exists() or remote.has(song_id):
            return {"id": song_id, "state": "done", "progress": 1, "message": "ready"}
        raise HTTPException(404, "no analysis on a device for this song")
    return st


@app.get("/api/songs/device/{song_id}/audio")
def device_audio(song_id: str) -> FileResponse:
    _song(song_id)
    f = device.source_file(song_id)
    if not f:
        raise HTTPException(404, "the song's audio isn't ready")
    return FileResponse(f, media_type="audio/mp4")


@app.post("/api/songs/device/{song_id}/result")
async def device_result(song_id: str, vocals: UploadFile, backing: UploadFile, f0: UploadFile, periodicity: UploadFile) -> dict:
    """Step 3: the browser's result. Checked against the original before it's kept."""
    _song(song_id)
    limit = CONFIG.max_upload_mb * 1024 * 1024

    async def read(up: UploadFile) -> bytes:
        data = await up.read(limit + 1)
        if len(data) > limit:
            raise HTTPException(413, f"{up.filename} is larger than {CONFIG.max_upload_mb} MB")
        return data

    def ext(up: UploadFile) -> str:
        e = Path(up.filename or "").suffix.lower()
        return e if e in {".m4a", ".mp4", ".webm", ".ogg", ".mp3", ".wav"} else ".audio"

    parts = (await read(vocals), ext(vocals)), (await read(backing), ext(backing))
    pitch, per = await read(f0), await read(periodicity)
    try:
        return await run_in_threadpool(device.accept, song_id, parts[0], parts[1], pitch, per)
    except device.Rejected as e:
        raise HTTPException(422, {"code": "rejected", "message": str(e)}) from e


@app.get("/api/catalog")
def song_catalog() -> list[dict]:
    """Every stored YouTube song, for search. Opening one never re-analyses it."""
    return [{**{k: e.get(k) for k in ("id", "title", "artist", "duration", "lang", "featured", "preview")}, "plays": int(e.get("plays") or 0)}
            for e in catalog.all_songs() if catalog.is_public(e["id"])]


@app.post("/api/songs/{song_id}/played")
def song_played(song_id: str, request: Request) -> dict:
    """A singer got a result on this song: counts towards Explore's "most played"."""
    _song(song_id)
    user = getattr(request.state, "user", None) or {}
    who = str(user.get("uid") or user.get("user_id") or user.get("sub") or request.client.host if request.client else "?")
    n = catalog.played(song_id, who)
    return {"counted": n is not None, "plays": n}


@app.get("/api/songs/{song_id}/preview")
def preview(song_id: str):
    """10 seconds of the song (the most-sung part), to check it's the right one."""
    d = _song(song_id)
    f = d / catalog.PREVIEW
    if not f.exists() and (d / "reference.json").exists():
        catalog.make_preview(d)
    if f.exists():
        return FileResponse(f, media_type="audio/mp4", headers={"Cache-Control": "private, max-age=86400"})
    if remote.has(song_id):
        return RedirectResponse(remote.signed_url(song_id, catalog.PREVIEW), status_code=307)
    raise HTTPException(404, "no preview for this song")


@app.get("/api/songs/{song_id}/status")
def status(song_id: str) -> dict:
    _song(song_id)
    st = jobs.MANAGER.status(song_id)
    if not st:
        raise HTTPException(404, "unknown song")
    return st


@app.post("/api/songs/{song_id}/cancel")
def cancel(song_id: str) -> dict:
    _song(song_id)
    st = jobs.MANAGER.cancel(song_id)
    if not st:
        raise HTTPException(404, "unknown song")
    return st


@app.get("/api/songs/{song_id}/reference")
def reference(song_id: str) -> dict:
    d = _song(song_id)
    f = d / "reference.json"
    if not _here(d):
        raise HTTPException(404, "analysis not finished")
    ref = json.loads(f.read_text())
    if ref.get("expressionVersion") != 1:
        # Songs analysed before dynamics/harmony existed: upgrade from the cached stems (a few seconds, once).
        from . import melody

        with audio.wav_stems(d) as wd:
            ref = melody.add_expression_data(ref, wd)
        f.write_text(json.dumps(ref))
    storage.touch(d)
    _active()
    ref["featured"] = d.name in storage.featured_ids()
    return ref


@app.get("/api/songs/{song_id}/audio/{stem}")
def stem_audio(
    song_id: str,
    stem: str,
    speed: float = Query(1.0, ge=0.5, le=1.25),
    semitones: int = Query(0, ge=-12, le=12),
) -> FileResponse:
    if stem not in {"backing", "vocals"}:
        raise HTTPException(400, "stem must be backing or vocals")
    d = _song(song_id)
    speed = round(speed, 2)
    if audio.stem_file(d, stem) is None:
        if speed == 1 and semitones == 0 and remote.has(song_id):
            # not on this machine: the browser downloads it straight from the VPS (signed link)
            return RedirectResponse(remote.signed_url(song_id, f"{stem}{audio.STEM_EXT}"), status_code=307)
        if not remote.pull(d) or audio.stem_file(d, stem) is None:
            raise HTTPException(404, "stem not found")
    try:
        path = audio.render_variant(d, stem, speed, semitones)
    except audio.AudioError as e:
        raise HTTPException(500, str(e)) from e
    storage.touch(d)
    _active()
    if path.parent.name == "variants":
        storage.trim()
    media = "audio/wav" if path.suffix == ".wav" else "audio/mp4"
    # Revalidate (cheap 304 via ETag) rather than trusting a cached copy: a song's
    # files can change under the same address (re-analysis, compression).
    return FileResponse(path, media_type=media, headers={"Cache-Control": "no-cache"})


@app.get("/api/songs/{song_id}/render-status")
def render_status(
    song_id: str,
    stem: str,
    speed: float = Query(1.0, ge=0.5, le=1.25),
    semitones: int = Query(0, ge=-12, le=12),
) -> dict:
    """Progress of a key / speed render (for the progress bar while the audio converts)."""
    if stem not in {"backing", "vocals"}:
        raise HTTPException(400, "stem must be backing or vocals")
    return audio.render_status(_song(song_id), stem, round(speed, 2), semitones)


@app.post("/api/songs/{song_id}/restore")
async def restore(song_id: str, reference: UploadFile, backing: UploadFile, vocals: UploadFile) -> dict:
    """A browser hands over its old copy of a song (songs used to be kept on phones; they now
    live on the server and the VPS)."""
    d = _song(song_id)
    if remote.has(song_id) or ((d / "reference.json").exists() and all(audio.stem_file(d, s) for s in audio.STEMS)):
        storage.touch(d)
        return {"ok": True, "restored": False}
    limit = CONFIG.max_upload_mb * 1024 * 1024
    try:
        ref = json.loads(await reference.read(limit + 1))
    except json.JSONDecodeError as e:
        raise HTTPException(400, "reference is not JSON") from e
    if not isinstance(ref, dict) or ref.get("id") != song_id or not isinstance(ref.get("notes"), list):
        raise HTTPException(400, "reference does not match this song")
    d.mkdir(parents=True, exist_ok=True)
    try:
        for stem, up in (("backing", backing), ("vocals", vocals)):
            data = await up.read(limit + 1)
            if len(data) > limit:
                raise HTTPException(413, f"{stem} is larger than {CONFIG.max_upload_mb} MB")
            (d / f"{stem}{audio.STEM_EXT}").write_bytes(data)
            (d / f"{stem}.wav").unlink(missing_ok=True)
        ref.pop("featured", None)
        (d / "reference.json").write_text(json.dumps(ref))
    except BaseException:
        if not (d / "reference.json").exists():
            shutil.rmtree(d, ignore_errors=True)
        raise
    storage.touch(d)
    catalog.finish(d)
    remote.push_later(d)  # safe on the VPS from now on
    storage.trim()
    return {"ok": True, "restored": True}


@app.post("/api/activity")
def activity() -> dict:
    """Heartbeat from an open song: background preparation waits while you practise."""
    _active()
    return {"ok": True}


# ---- your own data (local PostgreSQL): settings, song list, per-song edits & scores ----------------------

PREF_KEY = re.compile(r"^[\w.\-: ]{1,200}$")


def _uid(request: Request) -> str:
    c = request.state.user
    return c.get("uid") or c["user_id"]


def _data(fn):
    """Run a database call; 503 (not a crash) when the database can't be reached."""
    try:
        return fn()
    except userdata.Unavailable as e:
        raise HTTPException(503, str(e)) from e


@app.get("/api/me")
def me(request: Request) -> dict:
    """Your profile is created / refreshed; returns your settings and song list."""
    def run():
        s = userdata.touch_user(request.state.user)
        return {**s, "songs": userdata.list_songs(_uid(request))}

    return _data(run)


@app.put("/api/me/settings")
def me_settings(request: Request, body: dict = Body(...)) -> dict:
    settings, at = body.get("settings"), body.get("updatedAt")
    if not isinstance(settings, dict) or not isinstance(at, (int, float)) or len(json.dumps(settings)) > 50_000:
        raise HTTPException(400, "send {settings: {...}, updatedAt: ms}")
    return _data(lambda: userdata.save_settings(_uid(request), settings, float(at)))


@app.get("/api/me/prefs/{song_id}")
def me_prefs(request: Request, song_id: str) -> dict:
    if not PREF_KEY.match(song_id):
        raise HTTPException(400, "invalid song id")
    doc = _data(lambda: userdata.get_prefs(_uid(request), song_id))
    if not doc:
        raise HTTPException(404, "nothing saved for this song")
    return doc


@app.put("/api/me/prefs/{song_id}")
def me_save_prefs(request: Request, song_id: str, body: dict = Body(...)) -> dict:
    prefs, at = body.get("prefs"), body.get("updatedAt")
    if not PREF_KEY.match(song_id) or not isinstance(prefs, dict) or not isinstance(at, (int, float)):
        raise HTTPException(400, "send {prefs: {...}, updatedAt: ms}")
    if len(json.dumps(prefs)) > userdata.MAX_DOC_BYTES:
        raise HTTPException(413, "too much data for one song")
    return _data(lambda: userdata.save_prefs(_uid(request), song_id, prefs, float(at)))


@app.put("/api/me/songs/{song_id}")
def me_save_song(request: Request, song_id: str, body: dict = Body(...)) -> dict:
    if not PREF_KEY.match(song_id):
        raise HTTPException(400, "invalid song id")
    _data(lambda: userdata.save_song(_uid(request), song_id, body))
    return {"ok": True}


@app.delete("/api/me/songs/{song_id}")
def me_remove_song(request: Request, song_id: str) -> dict:
    if not PREF_KEY.match(song_id):
        raise HTTPException(400, "invalid song id")
    _data(lambda: userdata.remove_song(_uid(request), song_id))
    return {"ok": True}


@app.get("/api/featured")
def featured_list() -> list[dict]:
    out = []
    for f in storage.featured():
        sid = f"yt-{f['videoId']}" if f.get("videoId") else None
        st = jobs.MANAGER.status(sid) if sid else None
        ref = jobs.song_dir(sid) / "reference.json" if sid else None
        dur = None
        if ref and ref.exists():
            try:
                dur = json.loads(ref.read_text()).get("duration")
            except (OSError, json.JSONDecodeError):
                pass
        out.append({
            "id": sid, "title": f["title"], "artist": f.get("artist"), "lang": f.get("lang"), "group": f.get("group"),
            "duration": dur, "ready": bool(st and st["stage"] == "done"),
            "stage": st["stage"] if st else ("waiting" if _prepare_lock.locked() else None),
            "progress": st["progress"] if st else 0,
        })
    return out


_prepare_lock = threading.Lock()
# "prepare now": the singer asked for it, so don't wait for them to stop practising
_prepare_now = {"on": False}


def _queue_featured() -> None:
    """Prepare featured songs one by one, whenever no other song is being analysed."""
    if not _prepare_lock.acquire(blocking=False):
        return  # already running
    try:
        try:
            storage.resolve_featured()
        except Exception as e:  # offline: prepare the ones already resolved
            print(f"could not look up featured songs: {e}", flush=True)
        failed: set[str] = set()
        while True:
            todo = [
                f for f in storage.prepare_list()
                if f.get("videoId") and f"yt-{f['videoId']}" not in failed
                and not (jobs.song_dir(f"yt-{f['videoId']}") / "reference.json").exists()
            ]
            if not todo:
                break
            f = todo[0]
            sid = f"yt-{f['videoId']}"
            if storage.full():
                worker.log("song storage is full: featured songs not prepared")
                break
            while jobs.MANAGER.busy():  # a singer's own song goes first
                time.sleep(5)
            jobs.MANAGER.submit(sid, {"kind": "youtube", "videoId": f["videoId"], "title": f["title"], "artist": f.get("artist")})
            while (st := jobs.MANAGER.status(sid)) and st["stage"] not in {"done", "failed", "cancelled"}:
                time.sleep(3)
            if st and st["stage"] == "failed":
                failed.add(sid)  # don't retry in a loop; the next prepare tries again
    finally:
        _prepare_now["on"] = False
        _prepare_lock.release()


@app.post("/api/featured/prepare")
def featured_prepare(now: bool = False) -> dict:
    """Analyse every featured song that isn't ready yet (one at a time, in the background).
    now=true: start right away, even while someone is practising."""
    if not CONFIG.enable_youtube:
        raise HTTPException(403, "YouTube import is disabled (LEMO_ENABLE_YOUTUBE=false).")
    _no_server_analysis()
    if now:
        _prepare_now["on"] = True

    threading.Thread(target=_queue_featured, daemon=True).start()
    return {"ok": True, "message": "preparing featured songs in the background"}


@app.delete("/api/songs/{song_id}")
def delete(song_id: str) -> dict:
    d = _song(song_id)
    if song_id in storage.featured_ids():
        raise HTTPException(403, "featured songs stay on the server")
    jobs.MANAGER.cancel(song_id)
    jobs.MANAGER.jobs.pop(song_id, None)
    shutil.rmtree(d, ignore_errors=True)
    remote.remove(song_id)
    catalog.remove(song_id)
    return {"ok": True}


@app.get("/api/lyrics")
def find_lyrics(title: str, artist: str = "", duration: float = 0, videoId: str = "", songId: str = "") -> dict:
    """Ask every lyrics source at once; all candidates listed, best first. With the
    song's id, versions are checked against its singing: the ones that fit come first."""
    if not CONFIG.lrclib_enabled:
        raise HTTPException(403, "Online lyrics lookup is disabled (LEMO_ENABLE_LRCLIB=false).")
    vid = videoId if re.fullmatch(r"[A-Za-z0-9_-]{11}", videoId or "") else None
    notes = None
    if songId and SONG_ID.match(songId):
        d = jobs.song_dir(songId)
        if _here(d):
            # found and timed ahead of time (tools/prepare_lyrics.py, where YouTube and the
            # alignment model are available): every source's versions, the best one timed
            try:
                return json.loads((d / "lyrics.json").read_text())
            except (OSError, ValueError):
                pass
            try:
                ref = json.loads((d / "reference.json").read_text())
                notes, duration = ref.get("notes"), float(ref.get("duration") or duration)
            except (OSError, ValueError):
                notes = None
    try:
        return lyrics.find(title.strip(), artist.strip(), duration, vid, notes)
    except Exception as e:
        raise HTTPException(502, f"lyrics lookup failed: {e}") from e


@app.post("/api/lyrics/script")
def lyrics_script(body: dict = Body(...)) -> dict:
    """Lyrics lines in another script: to = latin (Hinglish) | deva (Hindi) | urdu.
    Lines that can't be converted honestly come back as null."""
    from . import translit

    lines, to = body.get("lines"), body.get("to")
    if to not in {"latin", "deva", "urdu"} or not isinstance(lines, list) or len(lines) > 600:
        raise HTTPException(400, "send {lines: [text], to: latin | deva | urdu}")
    return {"lines": translit.convert_lines([str(t) for t in lines], to)}


# ---- word-level lyric alignment -------------------------------------------------

_align_lock = threading.Lock()
_align_jobs: dict[str, dict] = {}


@app.post("/api/songs/{song_id}/align-plain")
def align_plain_lyrics(song_id: str, body: dict = Body(...)) -> dict:
    """Lyrics with no timing (pasted, or from a video's description): time every line to
    the singer. Call again with the same lines to poll."""
    d = _song(song_id)
    lines = [str(x) for x in (body.get("lines") or []) if str(x).strip()]
    if not lines or len(lines) > 400:
        raise HTTPException(400, "send {lines: [text, …]}")
    if not _here(d):
        raise HTTPException(404, "unknown song")
    if audio.stem_file(d, "vocals") is None and not (remote.pull(d) and audio.stem_file(d, "vocals")):
        raise HTTPException(404, "no vocal stem for this song")
    ref = json.loads((d / "reference.json").read_text())
    sung = [n for n in ref.get("notes", []) if n.get("sung", True)]
    span = (sung[0]["startTime"], sung[-1]["endTime"]) if sung else (0.0, float(ref.get("duration") or 0))
    storage.touch(d)
    _active()
    key = "plain-" + hashlib.sha1(json.dumps(lines).encode()).hexdigest()[:16]
    cache = d / f"align-{key}.json"
    if cache.exists():
        return {"status": "done", "lines": json.loads(cache.read_text())}
    if not _can_align():  # no alignment model here: lines timed to the sung phrases instead
        from . import phrase_timing

        return {"status": "done", "lines": phrase_timing.time_lines(lines, ref.get("notes", []), float(ref.get("duration") or 0))}
    with _align_lock:
        job = _align_jobs.get(key)
        if job and job["status"] == "failed":
            _align_jobs.pop(key)
            return {"status": "failed", "error": job["error"]}
        if not job:
            job = {"status": "running"}
            _align_jobs[key] = job

            def run() -> None:
                from . import lyric_align

                try:
                    res = worker.run(lyric_align.align_plain_song, str(d), lines, span)
                    cache.write_text(json.dumps(res))
                    _align_jobs.pop(key, None)
                except Exception as e:  # report, don't fabricate
                    job.update(status="failed", error=str(e))

            threading.Thread(target=run, daemon=True).start()
    return {"status": "running", "message": "timing the lyrics to the singer"}


def _can_align() -> bool:
    """Word timing runs the MMS model (torch): only where torch is installed."""
    import importlib.util

    return importlib.util.find_spec("torchaudio") is not None


@app.post("/api/songs/{song_id}/align")
def align_lyrics(song_id: str, body: dict = Body(...)) -> dict:
    """Idempotent: call again with the same lines to poll. Returns per-line words (or null)."""
    d = _song(song_id)
    lines = body.get("lines")
    if not isinstance(lines, list) or not lines or len(lines) > 400:
        raise HTTPException(400, "send {lines: [{start, end, text}]}")
    if audio.stem_file(d, "vocals") is None and not (remote.pull(d) and audio.stem_file(d, "vocals")):
        raise HTTPException(404, "no vocal stem for this song")
    storage.touch(d)
    _active()
    key = hashlib.sha1(json.dumps(lines, sort_keys=True).encode()).hexdigest()[:16]
    cache = d / f"align-{key}.json"
    if cache.exists():
        return {"status": "done", "lines": json.loads(cache.read_text())}
    if not _can_align():
        return {"status": "unavailable"}  # line timing stays; words are estimated in the browser
    with _align_lock:
        job = _align_jobs.get(key)
        if job and job["status"] == "failed":
            _align_jobs.pop(key)
            return {"status": "failed", "error": job["error"]}
        if not job:
            job = {"status": "running"}
            _align_jobs[key] = job

            def run() -> None:
                from . import lyric_align

                try:
                    res = worker.run(lyric_align.align_song, str(d), lines)
                    cache.write_text(json.dumps(res))
                    _align_jobs.pop(key, None)
                except Exception as e:  # report, don't fabricate
                    msg = str(e)
                    if "No space left" in msg or "Errno 28" in msg:
                        msg = "not enough free disk space to download the word-alignment model (~1.2 GB) — word timing stays estimated"
                    job.update(status="failed", error=msg)

            threading.Thread(target=run, daemon=True).start()
    first = not any((Path.home() / ".cache" / "torch" / "hub" / "checkpoints").glob("*.pt"))  # torchaudio keeps MMS_FA there
    return {"status": "running", "message": "timing each word to the singer" + (" (first time: downloading the ~1 GB model)" if first else "")}
