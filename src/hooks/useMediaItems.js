// useMediaItems.js — v2.1
// PURPOSE: Google Photos Picker session lifecycle + upload pipeline management.
// v2.1: clearAndReset() now calls cleanupSession() to delete local thumbnail
// files on the backend before resetting the store. All other logic unchanged
// from v2.0 Stage 2.
import { useCallback, useEffect, useRef } from 'react'
import {
  createPickerSession, getPickerSession,
  fetchPickerItems, deletePickerSession,
  startUpload, getUploadStatus, getReadyUploads,
  cleanupSession,
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
    id: r.uploadId,                   // numeric uploads.id — used as React key AND thumb URL key
    ourMediaItemId: r.ourMediaItemId, // used for swipe/album writes
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
  const seenReadyIdsRef   = useRef(new Set())
  const popupClosedCountRef = useRef(0)
  const SOFT_CLOSE_GRACE_POLLS = 12

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const stopUploadPolling = useCallback(() => {
    if (uploadPollRef.current) { clearInterval(uploadPollRef.current); uploadPollRef.current = null }
  }, [])

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
      popupRef.current?.close()

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
      if (popupRef.current?.closed) {
        popupClosedCountRef.current++
        if (popupClosedCountRef.current >= SOFT_CLOSE_GRACE_POLLS) {
          stopPolling()
          setPickerState('idle')
          savePickerSession(null)
          return
        }
      } else {
        popupClosedCountRef.current = 0
      }

      try {
        const session = await getPickerSession(sessionId)
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

  useEffect(() => {
    function onMessage(e) {
      if (e.origin !== window.location.origin) return
      if (e.data?.type !== 'PICKER_DONE') return
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
      sessionRef.current = session.id
      savePickerSession(session.id)

      const w = 520, h = 760
      const left = window.screenX + (window.outerWidth  - w) / 2
      const top  = window.screenY + (window.outerHeight - h) / 2
      popupRef.current = window.open(
        session.pickerUri, 'google-picker',
        `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`
      )

      if (!popupRef.current) {
        setPickerError(`POPUP_BLOCKED:${session.pickerUri}`)
      }

      setPickerState('waiting')
      startPolling(session.id, append)
    } catch (err) {
      setPickerError(err.message)
      setPickerState('idle')
    }
  }, [startPolling, setPickerState, setPickerError])

  // v2.1: call backend cleanup before resetting local state
  const clearAndReset = useCallback(async () => {
    stopPolling()
    stopUploadPolling()
    popupRef.current?.close()
    clearItemsCache()
    saveLastItem(null)
    savePickerSession(null)
    clearAuthedImageCache()
    seenReadyIdsRef.current = new Set()

    try {
      await cleanupSession()
    } catch (err) {
      console.warn('[clearAndReset] cleanup call failed (non-fatal):', err.message)
    }

    useAppStore.getState().resetItems()
  }, [stopPolling, stopUploadPolling])

  const cancelPickerSession = useCallback(() => {
    stopPolling()
    stopUploadPolling()
    popupRef.current?.close()
    const sid = sessionRef.current
    if (sid) deletePickerSession(sid).catch(() => {})
    sessionRef.current = null
    savePickerSession(null)
    setPickerState('idle')
  }, [stopPolling, stopUploadPolling, setPickerState])

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

  return {
    items, pickerState, uploadStatus,
    startPickerSession, clearAndReset, cancelPickerSession,
    loading: pickerState === 'creating' || pickerState === 'loading' || pickerState === 'uploading',
  }
}
