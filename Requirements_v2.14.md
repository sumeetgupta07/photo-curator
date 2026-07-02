
# Photo Curator — Requirements Document
**Version: v2.14**
**Project:** Personal photo curation PWA — single-user, self-hosted
**Target Dataset Scale:** 130,000+ media items / ~700 GB

---

## 1. Purpose

A mobile-first Progressive Web App for reviewing personal Google Photos and sorting them into Good/Bad categories for later deletion management. Inspired by a Tinder-style swipe interface. Optimized to process high-volume, multi-hundred gigabyte local and cloud libraries safely on consumer hardware without exceeding API constraints.

---

## 2. Core Functional Requirements

### 2.1 Photo Selection (Google Photos API)
1. **Google Photos Picker API**: User selects photos via the Google Photos Picker API (up to 500 per session) in a popup window that opens Google's native picker UI.
2. **Fixed Navigation Pill**: "Add More Photos" button is fixed in the header (non-scrolling) and appends to the existing curation session without clearing already-uploaded items.
3. **Session Polling**: Picker sessions are polled every 2.5s until `mediaItemsSet: true`.

### 2.2 Local Disk Ingestion *(Phase 5 — not yet built)*
4. **Multi-Target Ingestion**: The system accepts uploads directly from local storage, allowing selection of individual files or entire directory trees via drag-and-drop or filesystem pickers.
5. **Local Live Photo Pair Detection**: If a file pair is present with an image and video extension sharing the exact same base name (e.g., `IMG_0123.HEIC` and `IMG_0123.MOV`), the engine muxes them locally into a single Live Photo instead of two separate items.
6. **Metadata & Quality Preservation**: Local imports must preserve all native EXIF data intact and utilize lossless processing tracks to avoid visual degradation.
7. **Source File Management (`.curated_done`)**: Once a local file or directory has been successfully fully processed, the backend automatically moves the original source files into a `.curated_done/` subfolder within that directory.

### 2.3 Photo Display & Navigation
8. **Virtualized Grid View** *(Phase 6 — not yet built)*: Chronological thumbnail grid, grouped and sortable by date, album, or decision. DOM virtualization required for 130,000+ item scale.
9. **Grid-to-Swipe Synchronization**: Clicking any photo in the grid must open that exact photo in swipe mode in the same sort/filter sequence. `currentIndex` always refers to position in `activeItems` (the filtered+sorted list), never the raw `items[]` array.
10. **Media Type Indicators**: Live Photos display a `◎ Live` pill badge and videos display a `▶ Video` pill badge in the top-left corner of thumbnails in both grid and swipe card views.
11. **Deleted Asset Tracking**: Items detected as deleted from Google Photos appear at the bottom of the grid at 60% opacity with a 🗑 indicator.

### 2.4 Swipe Actions & Inputs
12. **Swipe Right (→)**: Categorize as Good → triggers `batchAddMediaItems` to the "Good" album.
13. **Swipe Left (←)**: Categorize as Bad → triggers `batchAddMediaItems` to the "Bad" album.
14. **Swipe Up (↑)**: Skip — no remote album write; local decision is persisted.
15. **Swipe Down (↓)**: Revert — return to the previous photo in the sequence.
16. **State Override**: "Latest action wins." Remote album additions cannot be undone (no remove-from-album API). A re-swiped photo may appear in both Google Photos albums permanently; only local state reflects the latest decision.
17. **Desktop Keyboard Shortcuts**: Active in swipe view (window-level listener, no card focus required): `Q`=Good, `D`=Bad, `↑`/`→`=Skip, `↓`/`←`=Previous, `?`=toggle guide.
18. **Shortcut Guide UI**: `?` button in swipe HUD opens a modal overlay showing all key mappings.

### 2.5 Album Organization & State Isolation
19. **Automated Provisioning**: Good, Bad, and Duplicates albums are auto-created on first use. Album IDs cached in `user_albums` SQLite table keyed by `(google_email, album_title)`. On a 404 (stale ID), cache row is cleared, album recreated under the same title, write retried once.
20. **The "Delete" Album**: Contains all deleted photos discovered by the background verification engine.
21. **The "Processed" Filter** *(local only)*: Items toggled into Processed state are hidden from default Grid and Swipe views. A "Processed" filter pill reveals them. Removing from Processed returns them to the active view.

### 2.6 Dual-Track Processing & Upload Pipeline
22. **Asymmetric Processing Architecture**: 4 concurrent muxing workers (CPU/disk) + 4 concurrent upload workers (network), serialized `batchCreate`.
23. **Pipeline Sequential Progression**:
    * **Step 1**: Fetch/read still bytes. `picker_base_url` written to DB immediately on enqueue.
    * **Step 2 (Live Photo Probe)**: Attempt `baseUrl=dv`. If `video/quicktime` >10KB returned, mux into Motion Photo v2 via `exiftool` GCamera XMP injection. Upload filename always `.jpg` (§3.15).
    * **Step 3**: dHash perceptual deduplication.
    * **Step 4**: Generate local thumbnails (400px + 1600px) via `sharp`/`ffmpeg`, stored at `/app/data/thumbs/{400|1600}/{uploadId}.jpg`.
    * **Step 5**: Extract EXIF via `exifr`.
    * **Step 6**: Upload bytes via `/v1/uploads`.
    * **Step 7**: Commit via `mediaItems:batchCreate` (serialized). Row gets `curation_session_id` stamped.
24. **Crash Recovery**: `picker_base_url` in DB enables worker resumption within the 60-minute baseUrl validity window.
25. **Metadata Preservation**: Original EXIF must survive the download → re-upload round-trip.

### 2.7 Perceptual Deduplication
27. **Matching Index**: dHash scoped by `google_email`. Global across all curation sessions.
28. **State Exclusion**: Dedup only matches `status='done'` and `deleted_at IS NULL`.
29. **Bandwidth Optimization**: Matching active dHash skips the upload entirely.
30. **Deleted Asset Reprocessing**: Matching a deleted dHash (`deleted_at IS NOT NULL`) bypasses skip logic.

### 2.8 Queue Monitoring UI & Data Cap Handling
31. **Live Operational Dashboard**: QueueDrawer shows per-item filename and status.
32. **Metric Telemetry**: UploadStatusPanel shows live counts (pending/downloading/uploading/done/failed). Done items auto-evict after 2 seconds.
33. **Bandwidth & Data Cap Management**: BandwidthMeter shows bytes uploaded today vs 15 GB daily cap, server-computed via `SUM(file_size)` on rows that hit `status='done'` today. Warning at >80% (amber), >95% (red).

### 2.9 Google API Quota & Rate Limit Resilience
34. **Telemetry Logging**: All Google API traffic recorded in `quota_log` table, bucketed daily.
35. **Graceful Limit Handling**: HTTP 429 triggers exponential backoff: 8s → 16s → 32s → 64s.

### 2.10 Background Verification
36. **Stale Asset Cleanup**: Cron worker runs every 2 hours, checks active assets against Google API in batches.
37. **Purge Window**: Inaccessible items tagged with `deleted_at`. Records purged from SQLite after 15 days.

### 2.11 Named Curation Sessions
38. **Session Model**: Each set of ingested photos belongs to a named `curation_sessions` row. Exactly one session per user is `is_active=1`. All `uploads` rows carry a `curation_session_id` FK.
39. **Session Operations**: Auto-naming (`"Session — <date>"`), rename, start new (preserves old), switch (full grid swap), delete (blocks on active session, HTTP 409).
40. **Session Menu**: Bottom sheet (≡ icon in grid header) — list, switch, rename, delete sessions.
41. **Bootstrap Migration**: On first boot of v2.11+, orphaned uploads adopted into an auto-named session.
42. **Scope**: Album writes and dHash dedup are global across sessions.

### 2.12 Interface Controls
43. **Sort / Filter Pills**: In grid header — sort and filter (All, Good, Bad, Dupes, Processed). Same `applyGrouping()` call used by both grid and swipe.
44. **"Start New Session"**: At base of grid scroll. Single tap, non-destructive.

---

## 3. Architecture Decisions (Locked)

### 3.1 SQLite WAL Mode
`better-sqlite3` runs in WAL mode to prevent `SQLITE_BUSY` under parallel writes.

### 3.2 Backend Proxy Requirements
Google CDN lacks CORS headers. All image display goes through locally generated thumbnails at `/api/thumbs/{400|1600}/{uploadId}.jpg`.

### 3.3 Thumbnail Cache Scalability
130,000+ items → 260,000 files. Reserve 25–40 GB SSD for `/app/data/thumbs/`.

### 3.4 Read Constraints
`mediaItems.list` returns 403 for post-March-2025 projects. Picker API is the only supported cloud read path.

### 3.5 Picker Session Polling
Pure polling every 2.5s. 12-poll soft-close grace window for COOP popup detection.

### 3.6 Re-upload Pipeline
`batchAddMediaItems` only accepts app-created IDs. Every Picker-selected photo must be re-uploaded. Duplicate rows always get fresh uploads — never reuse another row's `our_media_item_id`.

### 3.7 Cross-Origin Popups
Chrome COOP makes `popup.closed` unreliable. 12 consecutive reads (~30s) required before acting, plus explicit Cancel button.

### 3.8 Album Caching + Self-Healing
Album IDs in `user_albums` SQLite table keyed by `(google_email, album_title)`. On 404, stale row deleted, album recreated, write retried once. Inbox album also persisted here (not in-memory variable).

### 3.9 Media Item Reads
`getMediaItem` blocked. Local thumbnails from `sharp`/`ffmpeg` are the only display path.

### 3.10 Write Serialization
`mediaItems:batchCreate` never runs in parallel. Single-flight promise chain in `worker.js`.

### 3.11 No Delete API
Google Photos has no delete/trash endpoint. All deletion is manual via the native Google Photos app.

### 3.12 currentIndex Contract
`currentIndex` always indexes into `activeItems` (from `applyGrouping()`), never raw `items[]`. Both `GridView.openSwipe()` and `useSwipeActions` compute `activeItems` identically.

### 3.13 Curation Session Isolation
`GET /api/uploads/all` and `reloadFromBackend()` are scoped to the active `curation_session_id`. Session switch triggers a full backend re-fetch.

### 3.14 google_email Resilience
`/api/swipe` must not hard-fail when `google_email` is null in the `sessions` table (can happen if OAuth userinfo fetch failed during login). Three defence layers:
1. `sessionEmail()` reads from session row
2. `getSessionEmail(sessionId)` re-reads directly from DB
3. `getUploadByOurMediaItemId` falls back to `our_media_item_id`-only lookup (IDs are globally unique Google UUIDs)

`/api/me` heals null `google_email` by re-fetching from Google userinfo and persisting the result back to the sessions row.

### 3.15 Live Photo Upload Filename
Muxed Live Photo files must be uploaded with a `.jpg` extension regardless of source MIME type. Google Motion Photo v2 requires a JPEG outer container — uploading as `.heic` causes Google Photos to ignore the embedded video.

---

## 4. OAuth Scopes

| Scope | Purpose |
|---|---|
| `photospicker.mediaitems.readonly` | Picker sessions and item fetch |
| `photoslibrary.appendonly` | Upload bytes, batchCreate, batchAddMediaItems, createAlbum |
| `openid` + `email` | User identity for session association |

---

## 5. Infrastructure

| Component | Detail |
|---|---|
| Host | Home PC, local IP `192.168.1.102` |
| Frontend | Vite 5, port 5173 |
| Backend | Node.js / Express, port 3001 |
| Reverse Proxy | Caddy on `photo.sumeetg.duckdns.org` |
| Local DNS | PiHole: `photo.sumeetg.duckdns.org → 192.168.1.102` |
| Containers | Docker Compose: `photo-curator` (UI) + `backend` |
| Database | SQLite via `better-sqlite3` (WAL), volume `backend-data` |
| Thumbnails | `/app/data/thumbs/{400,1600}/` in backend container |
| Google Cloud | Project ID: `photoscleaner-484010` |

---

## 6. Known Limitations

1. **Library Duplication**: Re-uploads create a second copy in Google Photos until manually deleted.
2. **Immutable Album Writes**: No remove-from-album API. Re-swiping Good→Bad leaves the photo in both albums permanently.
3. **Token Lifespans**: `picker_base_url` valid for 60 minutes. Items in-flight during a restart must be re-picked if the window expires.
4. **Async Video Processing**: Google marks videos as `PROCESSING` after upload; viewable after a few minutes.
5. **Processed Filter is Local Only**: `processedIds` is Zustand store only — not persisted. Page refresh resets it.
6. **Live Photo Detection Unverified**: `=dv` probe diagnostic logging added in v2.13. End-to-end Google Photos Live Photo playback not yet confirmed. Check `docker compose logs backend | grep live-photo` after picking known Live Photos.

---

## 7. Phase Status

| Phase | Status | Notes |
|---|---|---|
| Phase 1 — Picker + Grid | ✅ Complete | |
| Phase 2 — Swipe view | ✅ Complete | Grid→swipe sync fixed (v2.9) |
| Phase 3 — Album writes | ✅ Complete | Self-healing on stale album IDs (v2.10) |
| Phase 4 — Session persistence | ✅ Complete | Named curation sessions (v2.11) |
| Phase 5 — Local Disk Ingestion | ⬜ Not started | See §2.2 |
| Phase 6 — Virtualized Grid | ⬜ Not started | See §2.3 #8; @tanstack/virtual |
ENDDOC
echo "REQUIREMENTS.md written"
