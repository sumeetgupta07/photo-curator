// storage.js — v2.0 Stage 1
//
// localStorage/sessionStorage helpers: swipe position, view, items cache,
// picker session ID, album-ID cache.
//
// v0.7: added a persistent album-ID cache (ALBUM_IDS) to avoid needing
// listAlbums() (a scope this app doesn't have) on every session.
//
// v2.0 Stage 1: removed saveToken/getToken/clearToken entirely. The
// backend now owns the only Google token (server/src/db.js's sessions
// table) — the browser never holds one, so there's nothing to store here
// anymore. TOKEN/TOKEN_EXP keys removed from KEYS.
const KEYS = {
  LAST_ITEM:      'pc_last_item_id',
  VIEW:           'pc_view',
  ITEMS_CACHE:    'pc_items_cache',
  PICKER_SESSION: 'pc_picker_session_id',  // active picker session id
  ALBUM_IDS:      'pc_album_ids',          // { [albumTitle]: albumId }
}

// ── Swipe position ────────────────────────────────────────────────────────────

export function saveLastItem(mediaItemId) {
  if (mediaItemId) localStorage.setItem(KEYS.LAST_ITEM, mediaItemId)
  else             localStorage.removeItem(KEYS.LAST_ITEM)
}

export function getLastItem() {
  return localStorage.getItem(KEYS.LAST_ITEM)
}

// ── View ──────────────────────────────────────────────────────────────────────

export function saveView(view) {
  localStorage.setItem(KEYS.VIEW, view)
}

export function getSavedView() {
  return localStorage.getItem(KEYS.VIEW) || 'grid'
}

// ── Media items cache ─────────────────────────────────────────────────────────
// Stores the flat array of picker-selected media items so the app can
// resume after a page reload without re-opening the picker.

export function saveItemsCache(items) {
  try {
    localStorage.setItem(KEYS.ITEMS_CACHE, JSON.stringify(items))
  } catch (_) {
    // Quota exceeded — skip silently
  }
}

export function getItemsCache() {
  try {
    const raw = localStorage.getItem(KEYS.ITEMS_CACHE)
    return raw ? JSON.parse(raw) : null
  } catch (_) {
    return null
  }
}

export function clearItemsCache() {
  localStorage.removeItem(KEYS.ITEMS_CACHE)
  localStorage.removeItem(KEYS.LAST_ITEM)
}

// ── Picker session ID ─────────────────────────────────────────────────────────
// Saved so we can poll an in-flight session across renders.

export function savePickerSession(sessionId) {
  if (sessionId) localStorage.setItem(KEYS.PICKER_SESSION, sessionId)
  else           localStorage.removeItem(KEYS.PICKER_SESSION)
}

export function getPickerSession() {
  return localStorage.getItem(KEYS.PICKER_SESSION)
}

// ── Album ID cache ────────────────────────────────────────────────────────────
// Maps album title (e.g. "Good", "Bad") -> Google Photos album ID. Persisted
// so we never need to call listAlbums() — see header comment above.

export function getCachedAlbumId(title) {
  try {
    const raw = localStorage.getItem(KEYS.ALBUM_IDS)
    const map = raw ? JSON.parse(raw) : {}
    return map[title] || null
  } catch (_) {
    return null
  }
}

export function setCachedAlbumId(title, albumId) {
  try {
    const raw = localStorage.getItem(KEYS.ALBUM_IDS)
    const map = raw ? JSON.parse(raw) : {}
    map[title] = albumId
    localStorage.setItem(KEYS.ALBUM_IDS, JSON.stringify(map))
  } catch (_) {
    // Quota exceeded — skip silently, will just re-create album next call
  }
}

// ── Full reset ────────────────────────────────────────────────────────────────

export function clearSession() {
  Object.values(KEYS).forEach(k => {
    localStorage.removeItem(k)
    sessionStorage.removeItem(k)
  })
}
