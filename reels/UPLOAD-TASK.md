# Daily upload task (new-layout Shorts)

Schedule: every day at 07:00 IST, 11–20 Nov (cron `0 7 11-20 11 *`).

Upload and schedule the pending Lemody YouTube Shorts (new layout) on the Lemody channel, earliest slot first, until YouTube's daily upload limit stops you.

- Queue: reels/reels-v2-queue.json (`id`, `out`, `date`, `time` in IST, `title`, `description`).
- Done list: reels/scheduled-v2.txt ("<id> <date> <time> <link>"); an entry is pending when its id isn't there. Append right after scheduling each one.
- Skip entries whose slot is under 30 min away or past; skip missing mp4s; report both.
- Check the Shorts tab in Studio first so nothing is uploaded twice (finish drafts instead).
- Flow: upload with file_upload on the dialog's file input → title (cmd+a, type) → description → close the hashtag list by clicking the "Details" heading (never Escape: it closes the dialog) → "No, it's not Made for Kids" → Next ×3 → expand Schedule → type the date in "Enter date" + Return → pick the exact time from the list → check GMT+0530 → Schedule → confirm the dialog → log it.
- If the dialog closes early the video is a Draft: open studio.youtube.com/video/<id>/edit → "Edit draft".
- "Daily upload limit reached" → stop. Never verify the account, type passwords, accept terms, or touch other videos.
