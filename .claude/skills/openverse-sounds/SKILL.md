---
name: openverse-sounds
description: Find and download free, openly licensed sound effects (whooshes, hits, risers, pops, chimes, ambiences) from Openverse for a video, with their licences recorded. Use when a reel, Short or other video needs sound effects and no local library has the right sound, or when the user asks for free SFX, CC0 sounds or Openverse.
---

# Openverse sounds

Openverse (WordPress) indexes 5M+ openly licensed audio files (mostly Freesound, Jamendo, Wikimedia). Its API is free and needs **no key** for normal use (anonymous: up to 240 results per search, rate-limited).

## Search and download

```
python3 .claude/skills/openverse-sounds/openverse.py search "whoosh" --license commercial --max-seconds 3
python3 .claude/skills/openverse-sounds/openverse.py get <id> [<id> ...] --out reels/sfx
```

- `search` prints id, title, licence, creator, length and source page. `--license commercial` keeps only licences that allow commercial use (CC0, BY, BY-SA); `--license cc0` keeps public-domain ones only. Prefer CC0: no credit needed.
- `get` downloads each file to `--out` and appends its credit line to `<out>/CREDITS.txt`.

## Rules

- **Check every sound's licence before using it.** CC0 needs nothing. CC BY / BY-SA need a credit: put the CREDITS.txt lines in the video description. Never use NC (non-commercial) or ND sounds in promo videos for Lemody.
- You cannot hear the sound. Pick by title, tags and length, then tell the user which sounds to listen to before publishing.
- Keep SFX quiet under music: for Lemody reels the song is the point, so a whoosh at a cut or a soft hit on the end card at about -18 dB under the song is enough.
- The raw API, if the script is unavailable: `GET https://api.openverse.org/v1/audio/?q=<words>&license_type=commercial&page_size=20` (fields: id, title, url, license, license_version, creator, duration in ms, foreign_landing_url, attribution).

Pairs with the `real-sfx` skill (places sounds on the exact frame; it ships only ~78 UI sounds, so it needs a library like this for whooshes and hits) and the `earshot` MCP (measures and critiques the sound of an edit), when those are installed.
