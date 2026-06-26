// appStore.js — v2.6
// PURPOSE: Zustand global state for Photo Curator.
// v2.6: added queueItems + queueOpen for the QueueDrawer panel.
// v2.5: added deletedItems state.
// v2.4: added dupeToast state.

import { create } from 'zustand'
import { saveLastItem, saveView, saveItemsCache, getItemsCache, getLastItem, saveSortGroup, getSortGroup } from '../lib/storage.js'
import { SORT_GROUP_DEFAULT } from '../lib/config.js'

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
  // null = all photos; 'good'|'bad'|'duplicate' = filtered view
  activeAlbum: null,
  setActiveAlbum: (album) => set({ activeAlbum: album }),

  // ── Upload queue drawer ───────────────────────────────────────────────────
  // queueItems: [{ id, filename, status }] — per-item queue for QueueDrawer
  // done items are removed after 2s by useMediaItems
  queueItems: [],
  queueOpen: false,
  setQueueItems: (updater) => set(s => ({
    queueItems: typeof updater === 'function' ? updater(s.queueItems) : updater
  })),
  setQueueOpen: (queueOpen) => set({ queueOpen }),

  // ── Deleted items (detected as removed from Google Photos) ───────────────
  deletedItems: [],
  setDeletedItems: (deletedItems) => set({ deletedItems }),

  // ── Duplicate toast ───────────────────────────────────────────────────────
  // dupeToast: { count, visible } — shown when duplicates are skipped during upload
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
  setUploadStatus: (uploadStatus) => set({ uploadStatus }),

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
  currentIndex: 0,
  setCurrentIndex: (i) => {
    const { items } = get()
    if (items[i]) saveLastItem(items[i].id)
    set({ currentIndex: i })
  },

  // ── Swipe decisions map ───────────────────────────────────────────────────
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
    const idx = lastItemId ? items.findIndex(i => i.id === lastItemId) : -1
    const decisions = {}
    for (const item of items) { if (item.swipeDecision) decisions[item.id] = item.swipeDecision }
    set({ items, currentIndex: idx !== -1 ? idx : 0, pickerState: 'done', swipeDecisions: decisions })
    return true
  },

  resetItems: () => set({
    items: [], currentIndex: 0, swipeHistory: [],
    swipeDecisions: {}, activeAlbum: null,
    deletedItems: [], queueItems: [], queueOpen: false,
    pickerState: 'idle', pickerError: null, errorItems: null,
    uploadStatus: { pending: 0, downloading: 0, uploading: 0, done: 0, failed: 0 },
  }),

  reset: () => set({
    view: 'grid', items: [], currentIndex: 0, swipeHistory: [],
    swipeDecisions: {}, albums: {}, activeAlbum: null,
    deletedItems: [], queueItems: [], queueOpen: false,
    pickerState: 'idle', pickerError: null, errorItems: null,
    uploadStatus: { pending: 0, downloading: 0, uploading: 0, done: 0, failed: 0 },
  }),
}))
