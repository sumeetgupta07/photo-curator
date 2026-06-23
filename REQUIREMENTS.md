# Photo Curator — Requirements Document
**Version: v2.0 (as of Stage 3 delivery)**
**Project:** Personal photo curation PWA — single-user, self-hosted

---

## 1. Purpose

A mobile-first Progressive Web App for reviewing personal Google Photos
and sorting them into Good/Bad categories for later deletion management.
Inspired by a Tinder-style swipe interface. Not a commercial product.

---

## 2. Core Functional Requirements

### 2.1 Photo Selection
- User can select photos from their Google Photos library via the Google
  Photos Picker API (supports up to 500 photos per session).
- Selection is done via a popup window that opens Google's native picker UI.
- User can add more photos on top of an existing session ("Add More Photos").

### 2.2 Photo Display
- Photos are displayed in two views:
  - **Grid view**: chronological thumbnail grid, grouped by date.
  - **Swipe view**: one photo at a time, full-screen, Tinder-style.
- Both views display OUR re-uploaded copies (not the original Picker
  selection — see §3.4 for why) fetched via the backend image proxy.

### 2.3 Swipe Actions
- **Swipe right (→)**: mark as Good → added to a "Good" album in Google Photos.
- **Swipe left (←)**: mark as Bad → added to a "Bad" album in Google Photos.
- **Swipe up (↑)**: Skip — no album write. Decision is persisted for audit.
- **Swipe down (↓)**: Go back to previous photo.
- "Latest action wins" — if a user changes their mind and re-swipes, the
  most recent decision is what gets written. A prior album write cannot
  be undone (Google Photos API has no remove-from-album endpoint), so
  both Good and Bad albums may contain a photo if a user changes their
  mind — this is a documented, accepted limitation.

### 2.4 Album Writes
- **FIXED REQUIREMENT**: Bad-swiped photos must be reviewable and deletable
  from within Google Photos via an album. This drives the entire
  architecture of the upload pipeline (see §3.4).
- Both Good and Bad swipe results must produce real, browsable albums
  in the user's actual Google Photos library.
- Albums are named "Good" and "Bad", created automatically on first swipe.

### 2.5 Upload Pipeline (re-upload requirement)
- Immediately after picker selection completes, a background pipeline
  starts re-uploading every selected photo/video to the user's Google
  Photos library under the app's ownership.
- **Why re-upload?** Google's Library API `batchAddMediaItems` only
  accepts items the calling app itself uploaded — pre-existing Picker-
  selected photos can never be added to albums regardless of scope or
  ID. This is a hard Google platform rule, not a bug we can work around.
- Re-uploaded items land in a "Photo Curator — Inbox" working album.
- **EXIF retention is a hard requirement** — original EXIF must be
  preserved through the download → re-upload round-trip.
- Dedup: if the same photo (filename + file size + creation time) was
  already uploaded by this app before, the existing copy is reused
  with no re-download.
- **Incremental swipe availability**: the swipe stack must grow
  item-by-item as uploads complete — user can start swiping on photo #1
  while photos #2-75 are still uploading in the background.
- Upload queue concurrency: 3–5 parallel workers.
- `batchCreate` calls must be serialized (per Google's docs) even while
  byte uploads run in parallel.

### 2.6 EXIF Storage
- Full raw EXIF data (all fields, as JSON) must be stored in the backend
  database for every uploaded photo.
- Additionally, the following fields must be promoted to their own
  indexed columns for fast querying: `date_taken`, `gps_lat`, `gps_lon`,
  `camera_make`, `camera_model`.
- Purpose: both audit/verification (confirming EXIF survived the re-
  upload round-trip) and future app features (sort/filter by date,
  location-based grouping, etc.).
- Videos do not carry traditional EXIF — handled gracefully, columns
  are NULL for video rows.

### 2.7 Upload Status Monitoring
- The app must show live queue-level upload status while the pipeline
  runs: counts of pending / downloading / uploading / done / failed.
- Not per-file progress bars — queue-level counts only.
- The status display is independent of the picker UI state (pipeline
  runs in the background even after the picker is "done").

### 2.8 Session Persistence
- Swipe position must survive page reload (resume where left off).
- Swipe decisions must survive page reload (already-swiped photos
  should not be re-presented).
- Items cache survives reload.
- Picker session recovery if page reloads mid-poll.

### 2.9 Authentication
- Google OAuth 2.0, backend-managed authorization-code flow.
- The browser never holds a Google token — only an HTTP-only session
  cookie is held client-side.
- Access tokens are cached and silently refreshed server-side using the
  stored refresh token. Token expiry is handled transparently.
- Session persists for 90 days (bounded by refresh token validity).

---

## 3. Architecture Decisions (Locked)

### 3.1 Backend is required
A server-side component (Node/Express + SQLite) is necessary because:
- Google's `lh3.googleusercontent.com` CDN does not serve CORS headers
  permitting direct browser `fetch()` — images can only be loaded via
  a server-side proxy.
- Backend-managed OAuth (code flow) is the only way to get a refresh
  token — browser implicit flow never issues one.
- The re-upload pipeline (download from Google + upload to Google) is
  a server-to-server operation.

### 3.2 Google Photos Picker API (not Library `mediaItems.list`)
`mediaItems.list` returns 403 PERMISSION_DENIED for OAuth projects
created after March 2025. The Picker API is the only supported way to
read a user's library for these projects.

### 3.3 Picker session polling (not callbackUri)
`callbackUri` in session creation requires extra OAuth redirect URI
registration and caused Google to reject sessions entirely (popup
opened to an error page). Pure polling is used: `GET /sessions/{id}`
every 2.5s until `mediaItemsSet: true`.

### 3.4 Re-upload pipeline (not Picker-direct album add)
`batchAddMediaItems` only works for items the calling app created via
`mediaItems.batchCreate`. Picker item IDs are valid Library API media
item IDs, but Google rejects them with "invalid media item id" in
`batchAddMediaItems` because the app didn't upload them. Re-uploading
every selected photo under app ownership is the only path to real
Google Photos album writes.

### 3.5 Popup.closed unreliability (COOP)
Chrome's Cross-Origin-Opener-Policy (set by Google's picker domain)
makes `popup.closed` return `true` while the popup is still open.
Fix: soft safety-net requiring 12 consecutive misreads (~30s) before
acting, plus an explicit "Cancel" button as the primary abort mechanism.

### 3.6 listAlbums() is blocked
`GET /albums` requires `photoslibrary.readonly.appcreateddata` scope
which this app does not request. Instead: albums are created once on
first swipe and their IDs are cached in memory (hot) and SQLite via
`swipe_decision` lookup (cold restart recovery). No listing needed.

### 3.7 baseUrl images require Bearer token + CORS proxy
Picker API `baseUrl` values are NOT pre-authenticated CDN URLs
(contrary to early assumptions). Every fetch requires an OAuth Bearer
token in the `Authorization` header AND must be done server-side since
`lh3.googleusercontent.com` doesn't set CORS headers. Both issues are
solved by routing all image loads through `/api/image-proxy`.

### 3.8 batchCreate must be serialized
Per Google's documentation, `mediaItems:batchCreate` must not be called
concurrently for the same user. The worker pool uses a single-flight
promise chain to serialize all `batchCreate` calls while allowing
parallel byte uploads.

### 3.9 No delete API exists
Google Photos Library API has no endpoint to delete or trash a media
item, for any app, under any scope. Deletion is always manual from
within the Google Photos native app. The "Bad" album workflow is
designed around this — user reviews the Bad album and deletes manually.

---

## 4. OAuth Scopes

| Scope | Purpose |
|---|---|
| `photospicker.mediaitems.readonly` | Open Picker sessions, fetch selected items |
| `photoslibrary.appendonly` | Create albums, upload items, add to albums |
| `openid` + `email` | Identify the user for session association |

**NOT requested** (blocked for post-March-2025 projects):
- `photoslibrary.readonly` — read arbitrary library items
- `photoslibrary.readonly.appcreateddata` — list app-created albums
- `photoslibrary.edit` — edit existing items

---

## 5. Infrastructure

| Component | Detail |
|---|---|
| Host | Home PC, local IP `192.168.1.102` |
| Frontend dev server | Vite 5, port 5173 |
| Backend server | Node/Express, port 3001 |
| Reverse proxy | Caddy on `photo.sumeetg.duckdns.org` |
| Local DNS | PiHole: `photo.sumeetg.duckdns.org → 192.168.1.102` |
| Container | Docker Compose (two services: `photo-curator`, `backend`) |
| Database | SQLite via `better-sqlite3`, persisted in named Docker volume |
| Google Cloud Project | `photoscleaner-484010` |
| Enabled APIs | Google Photos Picker API, Google Photos Library API |

**Caddy routing:**
```
photo.sumeetg.duckdns.org {
    reverse_proxy /api/* 192.168.1.102:3001
    reverse_proxy 192.168.1.102:5173
}
```

---

## 6. Known Limitations

1. **Duplicate copies during sorting**: every re-uploaded photo creates
   a second copy in the user's library. The originals persist until
   manually deleted. After deleting, only the app-uploaded copies remain.

2. **"Latest action wins" is not fully reversible**: if a user swipes
   Good then Bad on the same photo, both albums contain it (Google has
   no remove-from-album API). The most recent decision is what the app
   tracks, but both album writes persist.

3. **In-memory upload state lost on backend restart**: `baseUrlMap` and
   `rowContextMap` in `worker.js` are in-memory only. Items that were
   `pending`/`downloading`/`uploading` at restart time need their picker
   session re-run. Completed (`done`) items are unaffected.

4. **Video processing is async at Google's end**: after uploading a
   video, Google returns `videoProcessingStatus: PROCESSING`. The item
   is marked `done` in our DB immediately (upload succeeded), but the
   video may not be viewable in Google Photos for a few minutes.

5. **No token expiry UI**: if a token expires mid-session, the backend
   silently refreshes it. If the refresh token itself is revoked
   (e.g. user removes app access from Google Account), the next API call
   will fail with NOT_AUTHENTICATED and the user must sign in again.

6. **DebugPanel is stale**: `DebugPanel.jsx` (v0.7) still uses the old
   Picker `item.id` shape and direct Google API calls — it's intentionally
   inert. Remove it in Phase 5 cleanup.

---

## 7. Phase Status

| Phase | Status | Notes |
|---|---|---|
| Phase 1 — Picker + Grid | ✅ Complete | v0.x — now replaced by v2.0 architecture |
| Phase 2 — Swipe view | ✅ Complete | v0.x — carried forward |
| Phase 3 — Album writes | ✅ Complete | v2.0 Stage 3 — fully working via re-upload pipeline |
| Phase 4 — Session persistence | 🟡 Partial | Items cache + swipe position work; picker mid-poll reload untested |
| Phase 5 — Polish | ⬜ Not started | Remove DebugPanel, PWA install prompt, iPhone home screen instructions |

---

## 8. What's NOT in scope

- Batch deletion from within this app (no Google API exists for it)
- Sharing albums with other users
- Multiple Google accounts on one backend instance
- Any commercial deployment or multi-tenant use
