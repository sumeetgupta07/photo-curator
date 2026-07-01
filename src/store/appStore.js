// appStore.js — v2.8
// PURPOSE: Zustand global state for Photo Curator.
// Changelog:
//   v2.8: bandwidthToday is now server-authoritative — setUploadStatus()
//         mirrors uploadStatus.bandwidthToday (from GET /api/uploads/status,
//         computed server-side via SUM(file_size) for today's done uploads)
//         into the dedicated bandwidthToday field. addBandwidth/resetBandwidth
//         kept as manual overrides but are no longer the primary write path.
//   v2.7: Added processedIds (Set<number>) for local "Processed" filter.
//         toggleProcessed(id) adds/removes from the set.
//         Added bandwidthToday (bytes uploaded today) for bandwidth meter.
//         addBandwidth(bytes) increments it; persisted to sessionStorage so it
//         survives page refresh within the same browser session.
//   v2.6: queueItems + queueOpen for QueueDrawer.
//   v2.5: deletedItems state.
//   v2.4: dupeToast state.

import { create } from 'zustand'
import {
  saveLastItem, saveView, saveItemsCache, getItemsCache, getLastItem,
  saveSortGroup, getSortGroup,
} from '../lib/storage.js'
import { SORT_GROUP_DEFAULT } from '../lib/config.js'

// ── Bandwidth persistence (session-scoped) ────────────────────────────────────
const BW_KEY = 'pc_bw_today'
const BW_DATE_KEY = 'pc_bw_date'
function loadBandwidthToday() {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const savedDate = sessionStorage.getItem(BW_DATE_KEY)
    if (savedDate !== today) { sessionStorage.removeItem(BW_KEY); return 0 }
    return parseInt(sessionStorage.getItem(BW_KEY) || '0', 10)
  } catch { return 0 }
}
function saveBandwidthToday(bytes) {
  try {
    const today = new Date().toISOString().slice(0, 10)
    sessionStorage.setItem(BW_DATE_KEY, today)
    sessionStorage.setItem(BW_KEY, String(bytes))
  } catch {}
}

export const useAppStore = create((set, get) => ({
  // ── Auth ──────────────────────────────────────────────────────────────────
  authState: 'loading',
  setAuthState: (authState) => set({ authState }),

  // ── View ──────────────────────────────────────────────────────────────────
  view: 'grid',
  setView: (view) => { saveView(view); set({ view }) },

  // ── Sort + Group ──────────────────────────────────────────────────────────
  sortGroup: getSortGroup() || SORT_GROUP_DEFAULT,
  setSortGroup: (key) => { saveSortGroup(key); set({ sortGroup: key }) },

  // ── Active album filter ───────────────────────────────────────────────────
  // null = all; 'good'|'bad'|'duplicate' via applyGrouping; 'processed' = local
  activeAlbum: null,
  setActiveAlbum: (album) => set({ activeAlbum: album }),

  // ── Processed items (local filter, §2.5 #21) ─────────────────────────────
  // processedIds: Set<number> — upload IDs marked as processed (local only,
  // not written to Google Photos). Items in this set are hidden from default
  // grid+swipe views and visible only in the 'processed' filter.
  processedIds: new Set(),
  toggleProcessed: (uploadId) => set(s => {
    const next = new Set(s.processedIds)
    if (next.has(uploadId)) next.delete(uploadId)
    else next.add(uploadId)
    return { processedIds: next }
  }),
  clearProcessed: () => set({ processedIds: new Set() }),

  // ── Bandwidth meter (§2.8 #33) ───────────────────────────────────────────
  // bandwidthToday: bytes uploaded in current calendar day (session-persisted)
  bandwidthToday: loadBandwidthToday(),
  addBandwidth: (bytes) => set(s => {
    const next = s.bandwidthToday + bytes
    saveBandwidthToday(next)
    return { bandwidthToday: next }
  }),
  resetBandwidth: () => set(() => { saveBandwidthToday(0); return { bandwidthToday: 0 } }),

  // ── Upload queue drawer ───────────────────────────────────────────────────
  queueItems: [],
  queueOpen: false,
  setQueueItems: (updater) => set(s => ({
    queueItems: typeof updater === 'function' ? updater(s.queueItems) : updater,
  })),
  setQueueOpen: (queueOpen) => set({ queueOpen }),

  // ── Deleted items ─────────────────────────────────────────────────────────
  deletedItems: [],
  setDeletedItems: (deletedItems) => set({ deletedItems }),

  // ── Duplicate toast ───────────────────────────────────────────────────────
  dupeToast: { count: 0, visible: false },
  showDupeToast: (count) => set({ dupeToast: { count, visible: true } }),
  hideDupeToast: () => set(s => ({ dupeToast: { ...s.dupeToast, visible: false } })),

  // ── Media items ───────────────────────────────────────────────────────────
  items:        [],
  loadingItems: false,
  errorItems:   null,
  pickerState:  'idle',
  pickerError:  null,
  uploadStatus: { pending: 0, downloading: 0, uploading: 0, done: 0, failed: 0 },
  setUploadStatus: (uploadStatus) => set(s => {
    // v2.7: uploadStatus response now includes bandwidthToday (server-computed,
    // see server/src/db.js getBandwidthToday). Mirror it into the dedicated
    // bandwidthToday field so BandwidthMeter doesn't need to read uploadStatus.
    const next = { uploadStatus }
    if (typeof uploadStatus?.bandwidthToday === 'number') {
      saveBandwidthToday(uploadStatus.bandwidthToday)
      next.bandwidthToday = uploadStatus.bandwidthToday
    }
    return next
  }),

  setItems: (items) => { saveItemsCache(items); set({ items }) },
  appendItems: (newItems) => {
    const existing = new Set(get().items.map(i => i.id))
    const fresh = newItems.filter(i => !existing.has(i.id))
    if (!fresh.length) return
    const all = [...get().items, ...fresh]
    saveItemsCache(all)
    set({ items: all })
  },

  setLoadingItems: (v) => set({ loadingItems: v }),
  setErrorItems:   (v) => set({ errorItems: v }),
  setPickerState:  (v) => set({ pickerState: v }),
  setPickerError:  (v) => set({ pickerError: v }),

  // ── Swipe session ─────────────────────────────────────────────────────────
  // currentIndex: position in activeItems (filtered+sorted list), NOT in raw items[]
  currentIndex: 0,
  setCurrentIndex: (i) => {
    // Save the actual item id for resume — look up from activeItems if possible,
    // but we don't have access to activeItems here so we save by raw items[i] as
    // a best-effort (correct when no filter active; on reload hydration restores
    // by item.id scan anyway).
    const { items } = get()
    if (items[i]) saveLastItem(items[i].id)
    set({ currentIndex: i })
  },

  // ── Swipe decisions ───────────────────────────────────────────────────────
  swipeDecisions: {},
  updateSwipeDecision: (uploadId, decision) =>
    set(s => ({ swipeDecisions: { ...s.swipeDecisions, [uploadId]: decision } })),
  setSwipeDecisions: (map) => set({ swipeDecisions: map }),

  // ── Swipe history ─────────────────────────────────────────────────────────
  swipeHistory: [],
  addSwipeResult: (itemId, action) =>
    set(s => ({ swipeHistory: [...s.swipeHistory, { itemId, action }] })),

  // ── Album ID cache ────────────────────────────────────────────────────────
  albums: {},
  setAlbum: (name, id) => set(s => ({ albums: { ...s.albums, [name]: id } })),

  // ── Hydrate from localStorage ─────────────────────────────────────────────
  hydrateFromCache: () => {
    const items = getItemsCache()
    if (!items?.length) return false
    const lastItemId = getLastItem()
    const idx = lastItemId ? items.findIndex(i => i.id === Number(lastItemId)) : -1
    const decisions = {}
    for (const item of items) { if (item.swipeDecision) decisions[item.id] = item.swipeDecision }
    set({ items, currentIndex: idx !== -1 ? idx : 0, pickerState: 'done', swipeDecisions: decisions })
    return true
  },

  resetItems: () => set({
    items: [], currentIndex: 0, swipeHistory: [],
    swipeDecisions: {}, activeAlbum: null,
    deletedItems: [], queueItems: [], queueOpen: false,
    processedIds: new Set(),
    pickerState: 'idle', pickerError: null, errorItems: null,
    uploadStatus: { pending: 0, downloading: 0, uploading: 0, done: 0, failed: 0 },
  }),

  reset: () => set({
    view: 'grid', items: [], currentIndex: 0, swipeHistory: [],
    swipeDecisions: {}, albums: {}, activeAlbum: null,
    deletedItems: [], queueItems: [], queueOpen: false,
    processedIds: new Set(),
    pickerState: 'idle', pickerError: null, errorItems: null,
    uploadStatus: { pending: 0, downloading: 0, uploading: 0, done: 0, failed: 0 },
  }),
}))
