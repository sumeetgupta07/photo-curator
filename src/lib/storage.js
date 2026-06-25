// storage.js — v2.3
// PURPOSE: localStorage helpers.
// v2.3: added sortGroup preference persistence.

const KEYS = {
  LAST_ITEM:      'pc_last_item_id',
  VIEW:           'pc_view',
  ITEMS_CACHE:    'pc_items_cache',
  PICKER_SESSION: 'pc_picker_session_id',
  ALBUM_IDS:      'pc_album_ids',
  SORT_GROUP:     'pc_sort_group',
}

export function saveLastItem(id)     { if (id) localStorage.setItem(KEYS.LAST_ITEM, id); else localStorage.removeItem(KEYS.LAST_ITEM) }
export function getLastItem()        { return localStorage.getItem(KEYS.LAST_ITEM) }
export function saveView(view)       { localStorage.setItem(KEYS.VIEW, view) }
export function getSavedView()       { return localStorage.getItem(KEYS.VIEW) || 'grid' }
export function saveItemsCache(items){ try { localStorage.setItem(KEYS.ITEMS_CACHE, JSON.stringify(items)) } catch {} }
export function getItemsCache()      { try { const r = localStorage.getItem(KEYS.ITEMS_CACHE); return r ? JSON.parse(r) : null } catch { return null } }
export function clearItemsCache()    { localStorage.removeItem(KEYS.ITEMS_CACHE); localStorage.removeItem(KEYS.LAST_ITEM) }
export function savePickerSession(id){ if (id) localStorage.setItem(KEYS.PICKER_SESSION, id); else localStorage.removeItem(KEYS.PICKER_SESSION) }
export function getPickerSession()   { return localStorage.getItem(KEYS.PICKER_SESSION) }
export function getCachedAlbumId(title) {
  try { const m = JSON.parse(localStorage.getItem(KEYS.ALBUM_IDS) || '{}'); return m[title] || null } catch { return null }
}
export function setCachedAlbumId(title, albumId) {
  try { const m = JSON.parse(localStorage.getItem(KEYS.ALBUM_IDS) || '{}'); m[title] = albumId; localStorage.setItem(KEYS.ALBUM_IDS, JSON.stringify(m)) } catch {}
}
// v2.3: sort+group preference
export function saveSortGroup(key)   { localStorage.setItem(KEYS.SORT_GROUP, key) }
export function getSortGroup()       { return localStorage.getItem(KEYS.SORT_GROUP) || null }
export function clearSession()       { Object.values(KEYS).forEach(k => { localStorage.removeItem(k); sessionStorage.removeItem(k) }) }
