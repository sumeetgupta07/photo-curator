// storage.js — v2.0 Stage 1
const KEYS = {
  LAST_ITEM:      'pc_last_item_id',
  VIEW:           'pc_view',
  ITEMS_CACHE:    'pc_items_cache',
  PICKER_SESSION: 'pc_picker_session_id',
  ALBUM_IDS:      'pc_album_ids',
}
export function saveLastItem(mediaItemId) { if (mediaItemId) localStorage.setItem(KEYS.LAST_ITEM, mediaItemId); else localStorage.removeItem(KEYS.LAST_ITEM) }
export function getLastItem() { return localStorage.getItem(KEYS.LAST_ITEM) }
export function saveView(view) { localStorage.setItem(KEYS.VIEW, view) }
export function getSavedView() { return localStorage.getItem(KEYS.VIEW) || 'grid' }
export function saveItemsCache(items) { try { localStorage.setItem(KEYS.ITEMS_CACHE, JSON.stringify(items)) } catch {} }
export function getItemsCache() { try { const raw = localStorage.getItem(KEYS.ITEMS_CACHE); return raw ? JSON.parse(raw) : null } catch { return null } }
export function clearItemsCache() { localStorage.removeItem(KEYS.ITEMS_CACHE); localStorage.removeItem(KEYS.LAST_ITEM) }
export function savePickerSession(sessionId) { if (sessionId) localStorage.setItem(KEYS.PICKER_SESSION, sessionId); else localStorage.removeItem(KEYS.PICKER_SESSION) }
export function getPickerSession() { return localStorage.getItem(KEYS.PICKER_SESSION) }
export function getCachedAlbumId(title) { try { const raw = localStorage.getItem(KEYS.ALBUM_IDS); const map = raw ? JSON.parse(raw) : {}; return map[title] || null } catch { return null } }
export function setCachedAlbumId(title, albumId) { try { const raw = localStorage.getItem(KEYS.ALBUM_IDS); const map = raw ? JSON.parse(raw) : {}; map[title] = albumId; localStorage.setItem(KEYS.ALBUM_IDS, JSON.stringify(map)) } catch {} }
export function clearSession() { Object.values(KEYS).forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k) }) }
