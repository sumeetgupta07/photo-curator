# Photo Curator Backend — v2.0 Stage 2

## What this stage adds (on top of Stage 1)
The download → dedup → EXIF-extract → re-upload pipeline:
- Every photo/video selected via the Picker is automatically downloaded
  (original quality, EXIF-preserving) and re-uploaded to your Google
  Photos library under this app's ownership — into a working album called
  **"Photo Curator — Inbox"**.
- This is what makes Stage 3's swipe-to-album-write actually work: Google's
  Library API only allows `batchAddMediaItems` for items the calling app
  created itself, never for pre-existing photos merely *selected* via the
  Picker (see Session Handover notes on this — it's a hard platform rule,
  not a bug we can work around any other way).
- **Dedup**: if the same photo (matched by filename + file size + creation
  time) was already uploaded by this app before, it's instantly reused —
  no re-download, no re-upload, no duplicate in your library.
- **EXIF**: full raw EXIF is extracted and stored in SQLite as JSON, with
  date-taken/GPS/camera-make/camera-model also promoted to their own
  columns for fast querying later.
- The swipe stack now grows **incrementally** — you can start swiping on
  photo #1 while photos #2-75 are still uploading in the background.

**Still NOT in this stage:** the actual Good/Bad swipe routing into
separate albums (`/api/swipe`) — everything currently lands in the single
"Inbox" working album. That's Stage 3.

## New dependency
`exifr` (pure JS, no native compile needed) was added for EXIF extraction.
If you're updating from Stage 1, delete `server/package-lock.json` before
running `npm install` / `docker compose build` so it resolves correctly.

## Setup (same as Stage 1 — no new env vars or Caddy changes needed)
No changes required to your `.env`, Google Cloud Console config, or
Caddyfile from Stage 1. Just rebuild:
```bash
docker compose up -d --build
```

## How to verify Stage 2 works

1. **Sanity check the new album exists.** After your first picker
   selection + a few seconds, check Google Photos in your browser/app for
   an album called **"Photo Curator — Inbox"** — it should appear and
   start filling with photos as the background pipeline completes them.

2. **Watch the upload status panel.** In the app, right below the picker
   status bar, you should see "Uploading to Google Photos… X/Y done" while
   the pipeline runs, then it disappears once everything completes (or
   shows "N failed" if anything errored).

3. **Confirm incremental swipe availability** — per the agreed design, you
   should be able to enter swipe view and start swiping before all photos
   finish uploading; the grid/swipe count should grow as more complete.

4. **Verify EXIF retention — this is the most important check.** Pick a
   photo with known EXIF (e.g. one with GPS data, taken on a specific
   date/camera). After it uploads, open it in Google Photos (via the
   "Inbox" album) and check its info panel (date, location) matches the
   original. This is the empirical verification flagged earlier as
   needed — Google's docs say `=d`/`=dv` download parameters preserve
   metadata, but it's worth confirming directly rather than trusting docs
   alone for something this important.

5. **Test dedup** — run the picker again and select a photo you already
   uploaded in a previous run. It should appear as "ready" almost
   instantly (no real download/upload), and backend logs
   (`docker compose logs -f backend`) should show a line like
   `duplicate of #N, skipped download`.

6. **Inspect EXIF in the database directly** (optional, for verification):
   ```bash
   docker compose exec backend node -e "
     const db = require('better-sqlite3')('/app/data/photo-curator.db');
     console.log(db.prepare('SELECT filename, exif_date_taken, exif_gps_lat, exif_gps_lon, exif_camera_make, exif_camera_model FROM uploads LIMIT 5').all());
   "
   ```

## Known limitations in this stage
- **In-memory state lost on backend restart**: `baseUrlMap` and
  `rowContextMap` in `worker.js` are in-memory only. If the backend
  restarts while items are still `pending`/`downloading`/`uploading`,
  those specific items will need their picker session re-run (re-select
  the same photos) — completed (`done`) items are unaffected since they're
  fully persisted in SQLite. Acceptable for a personal tool; could be
  hardened later by persisting baseUrls too (they're valid for 60 min) if
  this becomes annoying in practice.
- **Concurrency is global, not per-session**: capped at 4 concurrent
  downloads/uploads across the whole backend process, not per Google
  account. Irrelevant for a single-user personal tool; would need revisiting
  if multiple people ever used the same backend instance simultaneously.
- **Working album is one shared "Inbox"** — Good/Bad separation comes in
  Stage 3.


## One-time setup (Stage 1 — skip if already done)

### 1. Create `server/.env`
Copy the template and fill in real values:
```bash
cd photo-curator/server
cp .env.example .env
```
Edit `server/.env`:
- `GOOGLE_CLIENT_ID` — same value as your old `src/lib/config.js` GOOGLE_CLIENT_ID
- `GOOGLE_CLIENT_SECRET` — the new secret you generated in Google Cloud Console
- `GOOGLE_REDIRECT_URI` — leave as `https://photo.sumeetg.duckdns.org/api/oauth/callback`

### 2. Add the new Authorized Redirect URI in Google Cloud Console
Go to **console.cloud.google.com/apis/credentials** → your OAuth client → **Authorized redirect URIs** → add:
```
https://photo.sumeetg.duckdns.org/api/oauth/callback
```
Save. (Keep the old `oauth-callback.html` URI too for now — no need to remove it yet.)

### 3. Update your Caddyfile
Add a route so `/api/*` goes to the new backend container instead of Vite.
Your Caddyfile currently has:
```
photo.sumeetg.duckdns.org {
    reverse_proxy 192.168.1.102:5173
}
```
Change it to:
```
photo.sumeetg.duckdns.org {
    reverse_proxy /api/* 192.168.1.102:3001
    reverse_proxy 192.168.1.102:5173
}
```
This routes anything starting with `/api/` to the backend (port 3001), and
everything else continues to Vite (port 5173) as before. Reload Caddy after
saving (`caddy reload` or restart the Caddy service, depending on how you
run it).

### 4. Extract the tarball and rebuild
The delivered tarball contains BOTH the new `server/` folder AND updated
frontend files (`src/hooks/`, `src/lib/`, `src/store/`, `src/components/`,
`vite.config.js`, `docker-compose.yml`) — extract it over your project root
to apply everything in one step:
```bash
cd ~/path/to/photo-curator  # parent of your existing photo-curator/ folder
tar -xzf photo-curator-vX.Y.tar.gz
docker compose up -d --build
```
This builds both the `photo-curator` and `backend` services. The SQLite DB
persists in a named Docker volume (`backend-data`) across restarts.

## How to verify Stage 1 works

1. Visit `https://photo.sumeetg.duckdns.org` — clicking sign-in should
   redirect to `/api/oauth/start` → Google consent screen → back to
   `/api/oauth/callback` → redirected to `/` now signed in.
2. Check `GET https://photo.sumeetg.duckdns.org/api/me` directly in a browser
   tab (while signed in) — should return `{"authenticated":true,...}`.
3. Open the picker, select photos — thumbnails should now load via the
   proxy with no CORS errors in DevTools Console (previously: `Access to
   fetch ... blocked by CORS policy`).
4. Check backend logs: `docker compose logs -f backend` — should show no
   `[image-proxy] upstream error` or `[oauth/callback] failed` lines during
   normal use.

## Troubleshooting
- **`auth_error=no_refresh_token` in the URL after login**: Google didn't
  issue a refresh token. This can happen if `prompt=consent` somehow didn't
  apply. Try revoking the app's access at
  myaccount.google.com/permissions and signing in again.
- **`/api/me` returns `authenticated:false` right after a successful-looking
  login**: check that the redirect URI in `server/.env` exactly matches what's
  registered in Google Cloud Console (trailing slashes matter).
- **Image proxy returns 401**: session cookie isn't being sent — check that
  the frontend's fetch calls to `/api/*` include `credentials: 'include'`.
