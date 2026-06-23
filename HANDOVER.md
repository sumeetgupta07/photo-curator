# Photo Curator — Session Handover
**Package version: v2.0-stage3**
**Date: June 2026**

---

## How to resume

Paste this document into a new session, then state what you want to work on.
Always check `REQUIREMENTS.md` for architecture decisions before suggesting changes.

---

## Current state — v2.0 Stage 3 (JUST DELIVERED, NOT YET TESTED)

All three planned stages are now implemented and build-verified (`vite build`
clean, all backend files syntax-checked). **No end-to-end testing has been
done yet.** See test plan below.

### What works (by design, needs real-device verification):
- ✅ Backend OAuth (authorization-code flow, refresh tokens, 90-day sessions)
- ✅ Image proxy (`/api/image-proxy`, `/api/image-proxy/by-id`) — solves CORS
- ✅ Picker session flow (all calls proxied through backend, zero tokens in browser)
- ✅ Background re-upload pipeline (3–5 concurrent workers, dedup, EXIF extraction)
- ✅ Incremental swipe stack (photos become swipeable as uploads complete)
- ✅ Upload status panel (queue-level counts: pending/downloading/uploading/done/failed)
- ✅ Good/Bad swipe routing → real Google Photos album writes (via `batchAddMediaItems`
  using `our_media_item_id` — the app-created IDs that Google accepts)
- ✅ Skip swipe (persisted, no album write)
- ✅ "Latest action wins" queue with localStorage persistence + retry
- ✅ Swipe decisions persisted server-side (SQLite `swipe_decision` column)
- ✅ Full EXIF stored in SQLite (raw JSON + promoted columns)

### Intentionally inert / known gaps:
- 🔴 `DebugPanel.jsx` (v0.7) — stale since Stage 1, uses old item shape and
  dead `token` variable. Inert but won't crash. Remove in Phase 5.
- 🟡 `swipe-decisions` hydration on page reload — `/api/swipe-decisions` endpoint
  exists but `useMediaItems.js` doesn't yet call it to restore swipe position
  after a page reload. Swipe decisions are persisted server-side but aren't
  re-applied to restore `currentIndex` on mount. Phase 4 task.
- 🟡 Picker session recovery if page reloads mid-poll — logic exists in
  `useMediaItems.js`, untested.

---

## Architecture overview (v2.0)

```
Browser                     Backend (port 3001)           Google APIs
────────────────────────    ──────────────────────────    ─────────────────────
useAuth.js                  /api/oauth/start              accounts.google.com
  → /api/oauth/start   →   /api/oauth/callback      →    token exchange
  ← session cookie     ←                            ←    access + refresh token

useMediaItems.js            /api/picker/sessions/*        photospicker API
  → /api/picker/sessions →  createPickerSession      →
  ← { id, pickerUri }  ←                            ←
  [user picks photos in popup]
  → /api/picker/.../items → fetchPickerItems         →
  → /api/.../start-upload → worker pool kicks off    →    /v1/uploads (bytes)
                                                     →    mediaItems:batchCreate
  ← poll /api/uploads/ready ← as items complete     ←

useSwipeActions.js          /api/swipe                    photoslibrary API
  → { ourMediaItemId,  →   batchAddMediaItems        →    /albums/{id}:batch...
      decision }       ←   ← { ok, albumId }
```

**Key invariant:** `our_media_item_id` in the `uploads` table is the ONLY ID
that works with `batchAddMediaItems`. The original Picker `item.id` (which IS
a valid Library API media item ID) is rejected by Google with "invalid media
item id" because the app didn't create it. This is why the re-upload pipeline
is not optional.

---

## File map

```
photo-curator/
├── REQUIREMENTS.md                ← Requirements doc (new)
├── HANDOVER.md                    ← This file (new)
├── Dockerfile                     ← Frontend Docker (unchanged)
├── docker-compose.yml             ← v2.0 Stage 1 — adds backend service
├── vite.config.js                 ← v2.0 Stage 1 — adds allowedHosts
├── package.json                   ← Frontend deps (unchanged from v0.x)
├── index.html
├── public/
│   ├── oauth-callback.html        ← UNUSED — old implicit flow, safe to delete
│   └── picker-callback.html       ← UNUSED — callbackUri approach abandoned
├── server/                        ← NEW in v2.0 Stage 1
│   ├── Dockerfile
│   ├── package.json               ← express, better-sqlite3, exifr, dotenv, etc.
│   ├── .env.example               ← Template — copy to .env with real values
│   ├── README.md                  ← Setup + verification steps
│   ├── data/                      ← SQLite DB volume mount point (Docker)
│   └── src/
│       ├── index.js               ← v2.0 Stage 3 — all routes
│       ├── db.js                  ← v2.0 Stage 3 — sessions + uploads schema
│       ├── google-auth.js         ← v2.0 Stage 1 — OAuth code flow helpers
│       ├── picker.js              ← v2.0 Stage 1 — Picker API proxy functions
│       ├── library-upload.js      ← v2.0 Stage 3 — uploadBytes, batchCreate,
│       │                                             batchAddMediaItems, createAlbum
│       ├── worker.js              ← v2.0 Stage 2 — parallel download/upload pool
│       └── exif.js                ← v2.0 Stage 2 — EXIF extraction via exifr
└── src/
    ├── App.jsx                    ← v2.0 Stage 1
    ├── main.jsx
    ├── index.css
    ├── store/
    │   └── appStore.js            ← v2.0 Stage 2 — added uploadStatus state
    ├── lib/
    │   ├── backendApi.js          ← v2.0 Stage 3 — all /api/* client calls
    │   ├── api.js                 ← v2.0 Stage 1 — groupByDate only (Picker
    │   │                                            functions removed)
    │   ├── config.js              ← v2.0 Stage 1 — IMG_SIZES, album names
    │   └── storage.js             ← v2.0 Stage 1 — localStorage helpers
    ├── hooks/
    │   ├── useAuth.js             ← v2.0 Stage 1 — redirect to /api/oauth/start
    │   ├── useMediaItems.js       ← v2.0 Stage 2 — Picker + upload pipeline poll
    │   ├── useSwipeActions.js     ← v2.0 Stage 3 — calls /api/swipe, queue, retry
    │   └── useAuthedImage.js      ← v2.0 Stage 2 — URL builders for image proxy
    └── components/
        ├── LoginScreen.jsx        ← unchanged
        ├── LoadingScreen.jsx      ← unchanged
        ├── GridView.jsx           ← v2.0 Stage 2
        ├── SwipeView.jsx          ← v2.0 Stage 2
        ├── SwipeCard.jsx          ← v2.0 Stage 2
        ├── SwipeHUD.jsx           ← unchanged
        ├── SwipeSummary.jsx       ← unchanged
        ├── UploadStatusPanel.jsx  ← v2.0 Stage 2 — new
        └── DebugPanel.jsx         ← v0.7 STALE — remove in Phase 5
```

---

## SQLite schema (photo-curator.db)

### sessions
| Column | Type | Notes |
|---|---|---|
| session_id | TEXT PK | HTTP-only cookie value |
| google_email | TEXT | From id_token |
| refresh_token | TEXT | Long-lived Google refresh token |
| access_token | TEXT | Cached, refreshed ~60min |
| access_token_exp | INTEGER | Unix timestamp |
| created_at, updated_at | INTEGER | Unix timestamps |

### uploads
| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | Upload row ID — used as `item.id` in frontend |
| session_id | TEXT | Links to sessions table |
| picker_session_id | TEXT | Which picker session created this |
| picker_item_id | TEXT | Original Picker API id (for reference only) |
| filename, file_size, creation_time | TEXT/INTEGER | Dedup key |
| mime_type | TEXT | image/jpeg, video/mp4, etc. |
| status | TEXT | pending\|downloading\|uploading\|done\|failed |
| our_media_item_id | TEXT | **App-owned Library API id** — used for album writes |
| swipe_decision | TEXT | good\|bad\|skip\|null — set on swipe |
| is_duplicate | INTEGER | 1 if dedup-matched an existing row |
| duplicate_of_id | INTEGER | uploads.id this was matched against |
| exif_raw | TEXT | Full EXIF as JSON |
| exif_date_taken | TEXT | ISO timestamp, indexed |
| exif_gps_lat, exif_gps_lon | REAL | Decimal degrees, indexed |
| exif_camera_make, exif_camera_model | TEXT | |
| error_message | TEXT | Last error for this row |
| retry_count | INTEGER | |
| created_at, updated_at | INTEGER | Unix timestamps |

---

## Backend API routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/oauth/start` | — | Begin OAuth flow (redirect to Google) |
| GET | `/api/oauth/callback` | — | Exchange code, set session cookie |
| GET | `/api/me` | — | `{ authenticated, email }` |
| POST | `/api/logout` | cookie | Clear session |
| GET | `/api/image-proxy?baseUrl=&size=` | cookie | Proxy Picker baseUrl image |
| GET | `/api/image-proxy/by-id?mediaItemId=&size=` | cookie | Proxy re-uploaded item image |
| POST | `/api/picker/sessions` | cookie | Create Picker session |
| GET | `/api/picker/sessions/:id` | cookie | Poll Picker session |
| GET | `/api/picker/sessions/:id/items` | cookie | Fetch normalized items |
| DELETE | `/api/picker/sessions/:id` | cookie | Cleanup |
| POST | `/api/picker-session/:id/start-upload` | cookie | Enqueue items for re-upload |
| GET | `/api/uploads/status?pickerSessionId=` | cookie | Queue counts |
| GET | `/api/uploads/ready?pickerSessionId=` | cookie | Done items (swipeable) |
| POST | `/api/uploads/:id/retry` | cookie | Retry failed upload row |
| POST | `/api/swipe` | cookie | `{ ourMediaItemId, decision }` → album write |
| GET | `/api/swipe-decisions?pickerSessionId=` | cookie | Persisted decisions for hydration |

---

## Item shape (frontend)

Items in the Zustand store (`appStore.items`) after Stage 2:
```js
{
  id: 42,                          // uploads.id (stable React key)
  ourMediaItemId: "ANeCUaM...",    // app-owned Library API id — used for album writes + image display
  pickerItemId: "ANeCUaM...",      // original Picker id (reference only)
  filename: "IMG_3778.JPG",
  isDuplicate: false,
  mediaMetadata: {
    creationTime: "2026-06-20T11:24:20.654Z",  // from EXIF if available
    gpsLat: 52.1234,
    gpsLon: 4.5678,
    cameraMake: "Apple",
    cameraModel: "iPhone 15 Pro",
  }
}
```
Note: **no `baseUrl` field** — images are fetched via `/api/image-proxy/by-id?mediaItemId={ourMediaItemId}`.

---

## Delivery conventions (standing rules)

- ≤4 changed files → deliver as individual files.
- >4 changed files → deliver as `photo-curator-vX.Y.tar.gz` (full project).
- Never silently delete files — flag and explain first.
- Every changed file gets a version header comment in its first few lines.
- Always bump the version on every delivered package.
- Read `REQUIREMENTS.md` before suggesting any architectural change.
- Run `vite build` to verify before delivering any frontend change.
- Run `node --check` on all changed backend `.js` files before delivering.

---

## Immediate next steps (recommended test sequence)

### Step 1 — Basic auth (Stage 1)
1. Extract `photo-curator-v2.0-stage3.tar.gz` over project root.
2. Create `server/.env` from `server/.env.example` (fill in `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`).
3. Add `https://photo.sumeetg.duckdns.org/api/oauth/callback` to
   Authorized Redirect URIs in Google Cloud Console.
4. Update Caddyfile: `reverse_proxy /api/* 192.168.1.102:3001` before
   the existing Vite proxy line.
5. `docker compose up -d --build`
6. Visit app → sign in → confirm `/api/me` returns `{ authenticated: true }`.
7. Open picker, select 3–5 photos → confirm thumbnails load (no CORS errors).

### Step 2 — Upload pipeline (Stage 2)
8. After selecting photos, watch the UploadStatusPanel counts change.
9. Open Google Photos → check "Photo Curator — Inbox" album appears
   and fills with photos.
10. Check EXIF: open an uploaded photo in Google Photos → confirm date
    taken and location (if the original had GPS) are correct.
    **This is the critical EXIF retention verification.**
11. Select the same photos again → confirm dedup fires
    (`docker compose logs backend | grep duplicate`).

### Step 3 — Swipe routing (Stage 3)
12. Enter swipe view → swipe a photo Right (Good).
13. Check `docker compose logs backend | grep Swipe` — should show
    `✓ written to "Good"`.
14. Open Google Photos → "Good" album should contain the photo.
15. Swipe a photo Left (Bad) → verify "Bad" album in Google Photos.
16. Swipe Up (Skip) → confirm no album write, no error.
17. Swipe Down → confirm goes back to previous photo.
18. Reload the page → confirm swipe position is remembered.

---

## Phase 5 — Polish (not yet started)

- Remove `DebugPanel.jsx` and `picker-callback.html`/`oauth-callback.html`
- PWA install prompt / iPhone home screen instructions
- Restore swipe position + decisions on page reload from `/api/swipe-decisions`
  (endpoint exists, frontend doesn't yet call it on mount)
- Handle revoked refresh token gracefully (currently surfaces as a generic
  API error — should redirect to sign-in with a clear message)
- Consider: should the "Inbox" working album be hidden/cleaned up after
  Good/Bad decisions are made? Open question.
- Move `server/.env`'s `GOOGLE_CLIENT_ID` into the Dockerfile/compose
  environment (it's not a secret, just a config value — having two places
  to set it is mildly annoying)
