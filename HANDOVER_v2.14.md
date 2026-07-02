# Photo Curator — Session Handover
**Package version: v2.14**
**Date: July 2026**

---

## How to resume

Paste this document into a new session, then state what you want to work on.
Always check `REQUIREMENTS.md` for architecture decisions before suggesting changes.
Fetch files directly from `https://raw.githubusercontent.com/sumeetgupta07/photo-curator/v2.8/`
as the baseline, then layer in-session changes on top.

---

## Current state — v2.14

All changes are build-verified (`vite build` clean, `node --check` pass on all
backend files). v2.14 fixes the swipe 404 bug that was blocking all swipe actions.
Not all changes from v2.9–v2.14 have been end-to-end tested on device.

---

## What was built this session (v2.9 → v2.14)

### v2.9 — Grid→swipe sync fix + keyboard shortcuts + bandwidth meter
- **Root bug fixed**: `currentIndex` now always means position in `activeItems`
  (from `applyGrouping()`), not position in raw `items[]`. Both `GridView.openSwipe()`
  and `useSwipeActions` compute `activeItems` identically — consistent regardless
  of active sort/filter.
- `GridView.jsx` v2.9: `openSwipe(itemId)` → `activeItems.findIndex()`
- `useSwipeActions.js` v2.4: window-level keyboard shortcuts (Q=Good, D=Bad,
  ↑/→=Skip, ↓/←=Prev, ?=overlay)
- `SwipeHUD.jsx` v2.9: `?` button + shortcut guide modal
- `SwipeView.jsx` v2.5: passes `showShortcuts`/`onToggleShortcuts` to SwipeHUD
- `SwipeCard.jsx` v2.3: removed local `onKeyDown` (conflicted with window shortcuts)
- `appStore.js` v2.8: `processedIds` Set for local Processed filter; `bandwidthToday`
  mirrored from server `uploadStatus.bandwidthToday`
- `BandwidthMeter.jsx` + CSS v1.0: new — daily upload bytes vs 15GB cap
- `GridView.module.css`: pill-style sort/filter bar; "Add More Photos" in fixed header

### v2.10 — Album 404 self-healing + Inbox album persistence fix
- `library-upload.js` v2.4: thrown errors carry `.status` (HTTP code)
- `db.js` v2.10: `deleteCachedAlbumId(email, title)` added
- `index.js` v2.10: on 404 from `batchAddMediaItems`, clears stale `user_albums` row,
  recreates album under same title, retries once
- `worker.js` v2.4: same self-heal for Duplicates album path
- **Inbox album bug fixed**: `getOrCreateWorkingAlbum` now uses `user_albums` DB
  (was a bare `let workingAlbumId` in-process variable — new album created on every
  backend restart)

### v2.11 — Named curation sessions
**Root bug fixed**: "previous session comes back on refresh" — `/api/uploads/all`
was returning ALL uploads for the user. Now scoped to active `curation_session_id`.

- `db.js` v2.11: `curation_sessions` table + `curation_session_id` FK on `uploads`.
  Bootstrap migration adopts orphaned uploads into an auto-named session.
  Full CRUD: `createCurationSession`, `listCurationSessions`, `setActiveCurationSession`,
  `renameCurationSession`, `deleteCurationSession` (blocks if active, HTTP 409),
  `getUploadsForActiveSession`
- `index.js` v2.11: 5 new routes — GET/POST `/api/curation-sessions`,
  POST `/api/curation-sessions/start-new`, POST `/:id/activate`,
  PATCH `/:id/rename`, DELETE `/:id`
- `backendApi.js` v2.4: matching client functions
- `useMediaItems.js` v2.6: `reloadFromBackend()` replaces localStorage hydration
  (fetches active session rows on mount + after session switch); `startNewSession()`
- `App.jsx` v2.5: `SessionMenu` wired; `DebugPanel` removed entirely
- `GridView.jsx` v2.10: ≡ sessions icon in header; "Start New Session" at scroll bottom
- `SessionMenu.jsx` + CSS v1.0: new bottom-sheet — list, switch, rename, delete

### v2.12 — Media type badges + DebugPanel cleanup
- `SwipeCard.jsx` v2.4: `◎ Live` / `▶ Video` pill badge top-left of card
- `SwipeCard.module.css`: `.mediaBadge` pill styles
- `GridView.module.css`: `.videoIcon` + `.livePhotoBadge` restyled as pills (top-left)
- `GridView.jsx`: badge markup updated to pill with label text
- `App.jsx` v2.5: `DebugPanel` removed
- **Files deleted from repo**: `src/components/DebugPanel.jsx`,
  `public/oauth-callback.html`, `public/picker-callback.html`

### v2.13 — Live Photo pipeline fixes
- `live-photo.js` v1.1: full diagnostic logging on every `=dv` probe (status,
  content-type, size) — confirms in docker logs whether Picker API baseUrls
  support `=dv`. Returns `{ buffer, filename }` instead of bare `Buffer`.
  Filename is always `.jpg` regardless of source MIME (§3.15).
- `worker.js` v2.5: destructures `{ buffer, filename }` from `muxLivePhoto`.
  Uses `uploadFilename` (not `row.filename`) for both `uploadBytes` and
  `createMediaItem` — ensures muxed files are registered with Google Photos as `.jpg`.

### v2.14 — Swipe 404 fix (google_email null in sessions table)
**Root bug fixed**: Every swipe returned 404 "Not Found". Cause: `sessions.google_email`
was NULL (OAuth userinfo fetch failed silently during login). The swipe route did
`email ? getUploadByOurMediaItemId(email, id) : null` — when email is null, it
skipped the query entirely and always returned 404.

- `db.js` v2.14: `getUploadByOurMediaItemId` now has two layers:
  1. Email-scoped query (preferred, same as before)
  2. `our_media_item_id`-only fallback when email is null or email-scoped query
     returns nothing (safe — Google media item IDs are globally unique UUIDs)
  Also added `getSessionEmail(sessionId)` for re-reading email from DB.
- `index.js` v2.14:
  - `/api/me` heals null `google_email` by re-fetching from Google userinfo on
    each request where email is missing, then persists result back to sessions row.
    So the first page load after deploy automatically fixes the session.
  - `/api/swipe` uses three-layer email resolution: `sessionEmail()` → `getSessionEmail()`
    → `our_media_item_id`-only fallback in DB query. Swipes now succeed even with
    a completely null-email session.

---

## Architecture overview (v2.14)

```
Browser                          Backend (port 3001)             Google APIs
─────────────────────────        ──────────────────────────      ────────────
useAuth                          /api/oauth/*                    accounts.google.com
  /api/me                 →      heal null google_email    →     userinfo API
useMediaItems
  reloadFromBackend()     →      /api/uploads/all          →     DB (active session)
  startPickerSession()    →      /api/picker/*             →     photospicker API
  startNewSession()       →      /api/curation-sessions/start-new
SessionMenu               →      /api/curation-sessions/*        DB only
useSwipeActions
  activeItems=applyGrouping()
  currentIndex=pos in activeItems
                          →      /api/swipe                →     batchAddMediaItems
                                   3-layer email lookup           self-heal on 404
                                   our_media_item_id fallback
```

**Key invariants (do not revisit):**
- `currentIndex` = position in `activeItems` (applyGrouping output), never raw `items[]`
- `our_media_item_id` = only valid ID for `batchAddMediaItems` (app-created)
- Album IDs in `user_albums` SQLite, self-heal on 404
- `batchCreate` serialized (single-flight chain in worker.js)
- Thumbnails: `/api/thumbs/{400|1600}/{uploadId}.jpg` — no `getMediaItem` calls
- Active session scoping: `getUploadsForActiveSession(email)` — grid shows active session only
- Live Photo upload filename: always `.jpg` regardless of source MIME type

---

## SQLite schema (v2.14)

### sessions
`session_id, google_email, refresh_token, access_token, access_token_exp, needs_reauth_scope, created_at, updated_at`
- `google_email` can be NULL for sessions created before v2.14 fix
- `/api/me` heals NULL on first load after v2.14 deploy

### curation_sessions *(new in v2.11)*
`id, google_email, name, is_active, created_at, updated_at`
- Exactly one row per user has `is_active=1`
- Auto-named: `"Session — Jun 30, 2026"` (counter suffix if same day)

### uploads
All columns from v2.8 plus `curation_session_id INTEGER` (FK to curation_sessions)

### user_albums
`google_email, album_title, album_id` (PK: `google_email, album_title`)
Covers: "Good", "Bad", "Duplicates", "Photo Curator — Inbox"

### quota_log
`date, api_calls, updated_at`

---

## Backend API routes (v2.14)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/me` | Heals null google_email if needed |
| GET | `/api/uploads/all` | Scoped to active curation session |
| POST | `/api/swipe` | 3-layer email + our_media_item_id fallback lookup |
| GET/POST | `/api/curation-sessions` | List / create |
| POST | `/api/curation-sessions/start-new` | Save current, create fresh, mark active |
| POST | `/api/curation-sessions/:id/activate` | Switch active session |
| PATCH | `/api/curation-sessions/:id/rename` | Rename |
| DELETE | `/api/curation-sessions/:id` | Delete (409 if active) |
| GET | `/api/uploads/status` | Counts + `bandwidthToday` |
| GET | `/api/thumbs/{size}/{id}.jpg` | Static thumbnail (no auth) |
| *(all others)* | | Unchanged from v2.8 |

---

## File map (changed files — v2.9 through v2.14)

```
src/
  App.jsx                        v2.5
  store/appStore.js              v2.8
  hooks/
    useSwipeActions.js           v2.4
    useMediaItems.js             v2.6
  lib/
    backendApi.js                v2.4
  components/
    GridView.jsx                 v2.10
    GridView.module.css          v2.12
    SwipeView.jsx                v2.5
    SwipeHUD.jsx                 v2.9
    SwipeCard.jsx                v2.4
    SwipeCard.module.css         v2.4
    BandwidthMeter.jsx           v1.0  (new)
    BandwidthMeter.module.css    v1.0  (new)
    SessionMenu.jsx              v1.0  (new)
    SessionMenu.module.css       v1.0  (new)

server/src/
  db.js                          v2.14
  index.js                       v2.14
  worker.js                      v2.5
  library-upload.js              v2.4
  live-photo.js                  v1.1

DELETED:
  src/components/DebugPanel.jsx
  public/oauth-callback.html
  public/picker-callback.html
```

---

## Outstanding issues

- **Live Photo end-to-end**: Detection probe diagnostic logging added (v2.13).
  After deploying, pick known Live Photos and run:
  `docker compose logs backend | grep live-photo`
  Look for `Live Photo confirmed!` vs `not video` to determine if `=dv` works
  on Picker API baseUrls. If probe always returns non-video, a different detection
  strategy is needed (filename heuristic for HEIC files from Apple devices).

- **`processedIds` not persisted**: Lives in Zustand store only. Page refresh
  clears it. Future: persist to localStorage or a `processed_items` DB table.

- **Bandwidth meter missing pause/resume**: BandwidthMeter shows the counter
  but the manual pause/resume switch for the upload network track (§2.8 #33)
  is not yet built.

---

## Deploy sequence for v2.14

1. Extract tarball over project root (server/src only — no frontend changes)
2. `docker compose up -d --build backend`
3. Open app → visit `/api/me` endpoint or just load the app
4. Check logs: `docker compose logs backend | grep "healed null google_email"`
   — if you see this, the session was healed and swipes should work immediately
5. Pick 3–5 photos → swipe one → confirm no 404 error banner

---

## Next phases

### Phase 5 — Local Disk Ingestion
Hand Claude: this HANDOVER + REQUIREMENTS.md + these v2.8 files:
`server/src/index.js`, `server/src/worker.js`, `server/src/db.js`,
`server/src/thumbs.js`, `server/src/live-photo.js`,
`src/hooks/useMediaItems.js`, `src/lib/backendApi.js`,
`src/store/appStore.js`, `src/components/GridView.jsx`

Tell Claude: "Implement §2.2 local disk ingestion. Backend receives multipart
file uploads. Detects HEIC+MOV pairs by basename. Runs same worker pipeline as
Picker items. Frontend: drag-and-drop zone on GridView empty state and a folder
picker button in header. `.curated_done` file move after successful upload."

### Phase 6 — Virtualized Grid
Hand Claude: `GridView.jsx`, `appStore.js`, `grouping.js`, `GridView.module.css`

Tell Claude: "Replace the current grid render with @tanstack/virtual row
virtualization. Items pre-flattened from applyGrouping output into a single
array with type='header'|'row' entries (3 thumbs per row). Date headers sticky.
openSwipe, AlbumDot, and media type badges unchanged — purely a rendering swap."