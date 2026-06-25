// appStore.js — v2.0 Stage 2
import { create } from 'zustand'
import { saveLastItem, saveView, saveItemsCache, getItemsCache, getLastItem } from '../lib/storage.js'
export const useAppStore = create((set, get) => ({
  authState: 'loading',
  setAuthState: (authState) => set({ authState }),
  view: 'grid',
  setView: (view) => { saveView(view); set({ view }) },
  items: [], loadingItems: false, errorItems: null,
  pickerState: 'idle', pickerError: null,
  uploadStatus: { pending: 0, downloading: 0, uploading: 0, done: 0, failed: 0 },
  setUploadStatus: (uploadStatus) => set({ uploadStatus }),
  setItems: (items) => { saveItemsCache(items); set({ items }) },
  appendItems: (newItems) => { const all = [...get().items, ...newItems]; saveItemsCache(all); set({ items: all }) },
  setLoadingItems: (v) => set({ loadingItems: v }),
  setErrorItems:   (v) => set({ errorItems: v }),
  setPickerState:  (v) => set({ pickerState: v }),
  setPickerError:  (v) => set({ pickerError: v }),
  currentIndex: 0,
  setCurrentIndex: (i) => { const { items } = get(); if (items[i]) saveLastItem(items[i].id); set({ currentIndex: i }) },
  swipeHistory: [],
  addSwipeResult: (itemId, action) => set(s => ({ swipeHistory: [...s.swipeHistory, { itemId, action }] })),
  albums: {},
  setAlbum: (name, id) => set(s => ({ albums: { ...s.albums, [name]: id } })),
  hydrateFromCache: () => {
    const items = getItemsCache(); if (!items?.length) return false
    const lastItemId = getLastItem(); const idx = lastItemId ? items.findIndex(i => i.id === lastItemId) : -1
    set({ items, currentIndex: idx !== -1 ? idx : 0, pickerState: 'done' }); return true
  },
  resetItems: () => set({ items: [], currentIndex: 0, swipeHistory: [], pickerState: 'idle', pickerError: null, errorItems: null, uploadStatus: { pending: 0, downloading: 0, uploading: 0, done: 0, failed: 0 } }),
  reset: () => set({ view: 'grid', items: [], currentIndex: 0, swipeHistory: [], albums: {}, pickerState: 'idle', pickerError: null, errorItems: null, uploadStatus: { pending: 0, downloading: 0, uploading: 0, done: 0, failed: 0 } }),
}))
