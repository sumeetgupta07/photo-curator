// useMediaItems.js — v2.0 Stage 2
//
// Manages the Google Photos Picker session lifecycle AND the Stage 2
// upload pipeline that follows it.
//
// v0.5: popup.closed COOP unreliability fix + explicit cancelPickerSession().
// v0.6: clearAndReset() clears the authenticated-image cache.
// v2.0 Stage 1: Picker calls moved server-side (lib/backendApi.js).
//
// v2.0 Stage 2 — SIGNIFICANT FLOW CHANGE: once Picker items load, they are
// no longer used directly as the swipeable `items` in the store. Instead:
//   1. Picker items are immediately sent to the backend via startUpload(),
//      which enqueues each as a background download/re-upload job.
//   2. A new poll loop (separate from the Picker session poll above it)
//      calls getReadyUploads() every UPLOAD_POLL_MS and merges any newly-
//      completed items into the store's `items` array.
//   3. The swipe stack therefore grows incrementally as background uploads
//      finish — per the agreed design, the user can start swiping on item
//      #1 while items #2-75 are still uploading. `items` now represents
//      READY (re-uploaded) items, not raw Picker selections.
//   4. uploadStatus (pending/downloading/uploading/done/failed counts) is
//      exposed for the new UploadStatusPanel component to render.
//
// Each ready item's shape (from /api/uploads/ready) differs from the old
// raw Picker item shape — see the mapping in mergeReadyItems() below for
// exactly how this is normalized for GridView/SwipeCard/SwipeView to
// consume via useAuthedMediaItemUrl() instead of useAuthedImageUrl().
import { useCallback, useEffect, useRef } from 'react'
import {
  createPickerSession, getPickerSession,
  fetchPickerItems, deletePickerSession,
  startUpload, getUploadStatus, getReadyUploads,
} from '../lib/backendApi.js'
import {
  savePickerSession,
  getPickerSession as getStoredPickerSession,
  clearItemsCache, saveLastItem,
} from '../lib/storage.js'
import { PICKER_POLL_MS } from '../lib/config.js'
import { useAppStore } from '../store/appStore.js'
import { clearAuthedImageCache } from './useAuthedImage.js'

const UPLOAD_POLL_MS = 2000

function mapReadyItem(r) {
  return {
    id: r.uploadId,                 // local primary key — stable, used as React key
    ourMediaItemId: r.ourMediaItemId, // used for image display (by-id proxy) AND Stage 3's swipe/album call
    pickerItemId: r.pickerItemId,
    filename: r.filename,
    isDuplicate: r.isDuplicate,
    mediaMetadata: {
      creationTime: r.exif?.dateTaken || null,
      gpsLat: r.exif?.gpsLat ?? null,
      gpsLon: r.exif?.gpsLon ?? null,
      cameraMake: r.exif?.cameraMake || null,
      cameraModel: r.exif?.cameraModel || null,
    },
  }
}

export function useMediaItems() {
  const {
    items, setItems, appendItems,
    setPickerState, setPickerError,
    setView, hydrateFromCache, pickerState, authState,
    setUploadStatus, uploadStatus,
  } = useAppStore()

  const pollRef       = useRef(null)
  const uploadPollRef = useRef(null)
  const popupRef       = useRef(null)
  const sessionRef      = useRef(null)
  const appendRef        = useRef(false)
  const seenReadyIdsRef   = useRef(new Set())  // upload row ids already merged into `items`, avoids re-adding/duplicating on each poll tick
  const popupClosedCountRef = useRef(0)
  const SOFT_CLOSE_GRACE_POLLS = 12  // ~30s at PICKER_POLL_MS=2500ms

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const stopUploadPolling = useCallback(() => {
    if (uploadPollRef.current) { clearInterval(uploadPollRef.current); uploadPollRef.current = null }
  }, [])

  // Polls /api/uploads/ready + /api/uploads/status for a given picker
  // session until all items reach a terminal state (done+failed === total
  // enqueued), merging newly-ready items into the store as they appear.
  const startUploadPolling = useCallback((pickerSessionId, append) => {
    stopUploadPolling()
    seenReadyIdsRef.current = append ? seenReadyIdsRef.current : new Set()

    uploadPollRef.current = setInterval(async () => {
      try {
        const [status, ready] = await Promise.all([
          getUploadStatus(pickerSessionId),
          getReadyUploads(pickerSessionId),
        ])
        setUploadStatus(status)

        const newOnes = ready.filter(r => !seenReadyIdsRef.current.has(r.uploadId))
        if (newOnes.length > 0) {
          for (const r of newOnes) seenReadyIdsRef.current.add(r.uploadId)
          appendItems(newOnes.map(mapReadyItem))
        }

        const total = status.pending + status.downloading + status.uploading + status.done + status.failed
        if (total > 0 && status.pending === 0 && status.downloading === 0 && status.uploading === 0) {
          stopUploadPolling()
          console.log('[Upload] pipeline finished:', status)
        }
      } catch (err) {
        console.error('[Upload] status poll error:', err.message)
        // Don't stop polling on a transient error — next tick retries.
      }
    }, UPLOAD_POLL_MS)
  }, [stopUploadPolling, appendItems, setUploadStatus])

  const loadPickerItems = useCallback(async (sessionId, append) => {
    setPickerState('loading')
    try {
      const pickerItems = await fetchPickerItems(sessionId)
      deletePickerSession(sessionId).catch(() => {})
      savePickerSession(null)
      sessionRef.current = null
      popupRef.current?.close()  // close picker popup once items loaded

      // Hand off to the upload pipeline rather than setting `items`
      // directly — see file header for the full Stage 2 flow change.
      setPickerState('uploading')
      const { enqueued } = await startUpload(sessionId, pickerItems)
      console.log(`[Upload] enqueued ${enqueued} items for background re-upload`)
      startUploadPolling(sessionId, append)
      setPickerState('done')
    } catch (err) {
      console.error('[Picker] loadPickerItems/startUpload failed:', err.message)
      setPickerError(err.message)
      setPickerState('idle')
    }
  }, [setPickerState, setPickerError, startUploadPolling])

  const startPolling = useCallback((sessionId, append) => {
    stopPolling()
    popupClosedCountRef.current = 0

    pollRef.current = setInterval(async () => {
      // Soft safety net only — popup.closed is unreliable cross-origin (COOP).
      if (popupRef.current?.closed) {
        popupClosedCountRef.current++
        if (popupClosedCountRef.current >= SOFT_CLOSE_GRACE_POLLS) {
          stopPolling()
          setPickerState('idle')
          savePickerSession(null)
          console.log('[Picker] popup appears closed (soft safety-net triggered after grace period)')
          return
        }
      } else {
        popupClosedCountRef.current = 0
      }

      try {
        const session = await getPickerSession(sessionId)
        console.log('[Picker] session poll — mediaItemsSet:', session.mediaItemsSet)
        if (session.mediaItemsSet) {
          stopPolling()
          await loadPickerItems(sessionId, append)
        }
      } catch (err) {
        console.error('[Picker] poll error:', err.message)
        stopPolling()
        setPickerError(err.message)
        setPickerState('idle')
      }
    }, PICKER_POLL_MS)
  }, [stopPolling, loadPickerItems, setPickerState, setPickerError])

  // postMessage from picker-callback.html — fires immediately when picker closes
  useEffect(() => {
    function onMessage(e) {
      if (e.origin !== window.location.origin) return
      if (e.data?.type !== 'PICKER_DONE') return
      console.log('[Picker] PICKER_DONE postMessage received')
      popupRef.current?.close()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [loadPickerItems, stopPolling])

  const startPickerSession = useCallback(async (append = false) => {
    appendRef.current = append
    setPickerError(null)
    setPickerState('creating')

    try {
      const session = await createPickerSession()
      console.log('[Picker] session created:', session.id)
      console.log('[Picker] pickerUri:', session.pickerUri)
      sessionRef.current = session.id
      savePickerSession(session.id)

      const w = 520, h = 760
      const left = window.screenX + (window.outerWidth  - w) / 2
      const top  = window.screenY + (window.outerHeight - h) / 2
      popupRef.current = window.open(
        session.pickerUri,
        'google-picker',
        `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`
      )

      if (!popupRef.current) {
        console.warn('[Picker] popup was blocked by browser')
        setPickerError(`POPUP_BLOCKED:${session.pickerUri}`)
      } else {
        console.log('[Picker] popup opened successfully')
      }

      setPickerState('waiting')
      startPolling(session.id, append)
    } catch (err) {
      console.error('[Picker] create session error:', err.message)
      setPickerError(err.message)
      setPickerState('idle')
    }
  }, [startPolling, setPickerState, setPickerError])

  const clearAndReset = useCallback(() => {
    stopPolling()
    stopUploadPolling()
    popupRef.current?.close()
    clearItemsCache()
    saveLastItem(null)
    savePickerSession(null)
    clearAuthedImageCache()
    seenReadyIdsRef.current = new Set()
    useAppStore.getState().resetItems()
  }, [stopPolling, stopUploadPolling])

  const cancelPickerSession = useCallback(() => {
    stopPolling()
    stopUploadPolling()
    popupRef.current?.close()
    const sid = sessionRef.current
    if (sid) {
      deletePickerSession(sid).catch(() => {})
    }
    sessionRef.current = null
    savePickerSession(null)
    setPickerState('idle')
    console.log('[Picker] session cancelled by user')
  }, [stopPolling, stopUploadPolling, setPickerState])

  // Hydrate on mount — gated on authState now instead of a token, since
  // there's no client-side token to check anymore.
  useEffect(() => {
    if (authState !== 'authenticated') return
    const hydrated = hydrateFromCache()
    if (hydrated) {
      const { currentIndex, items } = useAppStore.getState()
      if (items.length > 0 && currentIndex > 0) setView('swipe')
      return
    }
    const pending = getStoredPickerSession()
    if (pending) {
      sessionRef.current = pending
      startPolling(pending, false)
    }
  }, [authState])

  useEffect(() => () => { stopPolling(); stopUploadPolling() }, [stopPolling, stopUploadPolling])

  return { items, pickerState, uploadStatus, startPickerSession, clearAndReset, cancelPickerSession,
    loading: pickerState === 'creating' || pickerState === 'loading' || pickerState === 'uploading' }
}
