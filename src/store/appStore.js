// appStore.js — v2.0 Stage 2
//
// PURPOSE: Zustand global state for the app.
//
// v2.0 Stage 1: removed `token`/`setToken` entirely. The backend now owns
// the only Google token (in SQLite, see server/src/db.js) — the browser
// never holds one. `authState` ('loading' | 'authenticated' |
// 'unauthenticated') is now the sole signal other hooks/components check,
// set by useAuth.js based on the backend's /api/me response.
//
// v2.0 Stage 2: added uploadStatus (queue counts from /api/uploads/status)
// for the new UploadStatusPanel. `items` now holds READY (re-uploaded)
// items rather than raw Picker selections — see useMediaItems.js v2.0
// Stage 2 header for the full flow change. pickerState gained a new
// 'uploading' value (items enqueued, background pipeline running, but
// picker UI flow itself has completed).
import { create } from 'zustand'
import { saveLastItem, saveView, saveItemsCache, getItemsCache, getLastItem } from '../lib/storage.js'

export const useAppStore = create((set, get) => ({
  // ── Auth ─────────────────────────────────────────────────────────────────────
  authState: 'loading',
  setAuthState: (authState) => set({ authState }),

  // ── View ─────────────────────────────────────────────────────────────────────
  view: 'grid',
  setView: (view) => { saveView(view); set({ view }) },

  // ── Media items ───────────────────────────────────────────────────────────────
  items:       [],
  loadingItems: false,
  errorItems:   null,
  pickerState: 'idle', // 'idle' | 'creating' | 'waiting' | 'loading' | 'uploading' | 'done'
  pickerError: null,
  uploadStatus: { pending: 0, downloading: 0, uploading: 0, done: 0, failed: 0 },
  setUploadStatus: (uploadStatus) => set({ uploadStatus }),

  setItems: (items) => {
    saveItemsCache(items)
    set({ items })
  },

  // Phase 4: append preserves currentIndex so swipe position is unaffected
  appendItems: (newItems) => {
    const all = [...get().items, ...newItems]
    saveItemsCache(all)
    set({ items: all })   // currentIndex intentionally NOT reset
  },

  setLoadingItems: (v)   => set({ loadingItems: v }),
  setErrorItems:   (v)   => set({ errorItems: v }),
  setPickerState:  (v)   => set({ pickerState: v }),
  setPickerError:  (v)   => set({ pickerError: v }),

  // ── Swipe session ─────────────────────────────────────────────────────────────
  currentIndex: 0,
  setCurrentIndex: (i) => {
    const { items } = get()
    // Only persist valid indices (not the past-end summary index)
    if (items[i]) saveLastItem(items[i].id)
    set({ currentIndex: i })
  },

  // ── Swipe history ─────────────────────────────────────────────────────────────
  swipeHistory: [],
  addSwipeResult: (itemId, action) =>
    set(s => ({ swipeHistory: [...s.swipeHistory, { itemId, action }] })),

  // ── Album ID cache ────────────────────────────────────────────────────────────
  albums: {},
  setAlbum: (name, id) => set(s => ({ albums: { ...s.albums, [name]: id } })),

  // ── Hydrate from localStorage on boot ────────────────────────────────────────
  hydrateFromCache: () => {
    const items = getItemsCache()
    if (!items?.length) return false

    const lastItemId = getLastItem()
    const idx = lastItemId ? items.findIndex(i => i.id === lastItemId) : -1

    set({
      items,
      currentIndex: idx !== -1 ? idx : 0,
      pickerState:  'done',
    })
    return true
  },

  // ── Reset items only (keep auth + albums cache) ───────────────────────────────
  resetItems: () => set({
    items:        [],
    currentIndex: 0,
    swipeHistory: [],
    pickerState:  'idle',
    pickerError:  null,
    errorItems:   null,
    uploadStatus: { pending: 0, downloading: 0, uploading: 0, done: 0, failed: 0 },
  }),

  // ── Full reset ────────────────────────────────────────────────────────────────
  reset: () => set({
    view:         'grid',
    items:        [],
    currentIndex: 0,
    swipeHistory: [],
    albums:       {},
    pickerState:  'idle',
    pickerError:  null,
    errorItems:   null,
    uploadStatus: { pending: 0, downloading: 0, uploading: 0, done: 0, failed: 0 },
  }),
}))
