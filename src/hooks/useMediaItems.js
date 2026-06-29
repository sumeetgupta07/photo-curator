// useMediaItems.js — v2.5
// PURPOSE: Picker session lifecycle + upload pipeline management.
// v2.5: mapReadyItem now passes isLivePhoto through from backend rowToItem,
//   so GridView can show the Live Photo badge and SwipeCard can label them.
//   No other logic changes.
// v2.4: fetches /api/uploads/deleted on mount alongside all uploads.
// v2.3: fires dupeToast on duplicate detection during upload polling.

import { useCallback, useEffect, useRef } from 'react'
import {
  createPickerSession, getPickerSession,
  fetchPickerItems, deletePickerSession,
  startUpload, getUploadStatus, getReadyUploads,
  getUploadQueue, getAllUploads, getDeletedUploads, cleanupSession,
} from '../lib/backendApi.js'
import { savePickerSession, getPickerSession as getStoredPickerSession, clearItemsCache, saveLastItem } from '../lib/storage.js'
import { PICKER_POLL_MS } from '../lib/config.js'
import { useAppStore } from '../store/appStore.js'
import { clearAuthedImageCache } from './useAuthedImage.js'

const UPLOAD_POLL_MS = 2000

function mapReadyItem(r) {
  return {
    id:             r.uploadId,
    ourMediaItemId: r.ourMediaItemId,
    pickerItemId:   r.pickerItemId,
    filename:       r.filename,
    isDuplicate:    r.isDuplicate,
    isLivePhoto:    r.isLivePhoto || false,   // v2.5: Live Photo flag
    swipeDecision:  r.swipeDecision || null,
    mediaMetadata: {
      creationTime: r.exif?.dateTaken || null,
      gpsLat:       r.exif?.gpsLat ?? null,
      gpsLon:       r.exif?.gpsLon ?? null,
      cameraMake:   r.exif?.cameraMake || null,
      cameraModel:  r.exif?.cameraModel || null,
    },
  }
}

export function useMediaItems() {
  const {
    appendItems, setPickerState, setPickerError,
    setView, authState, setUploadStatus,
    setItems, setSwipeDecisions, setDeletedItems, setQueueItems,
  } = useAppStore()

  const pollRef             = useRef(null)
  const uploadPollRef       = useRef(null)
  const popupRef            = useRef(null)
  const sessionRef          = useRef(null)
  const seenReadyIdsRef     = useRef(new Set())
  const popupClosedCountRef = useRef(0)
  const SOFT_CLOSE_GRACE    = 12

  const stopPolling       = useCallback(() => { if (pollRef.current)       { clearInterval(pollRef.current);       pollRef.current = null       } }, [])
  const stopUploadPolling = useCallback(() => { if (uploadPollRef.current) { clearInterval(uploadPollRef.current); uploadPollRef.current = null } }, [])

  const startUploadPolling = useCallback((pickerSessionId, append) => {
    stopUploadPolling()
    if (!append) seenReadyIdsRef.current = new Set()

    uploadPollRef.current = setInterval(async () => {
      try {
        const [status, ready, queue] = await Promise.all([
          getUploadStatus(pickerSessionId),
          getReadyUploads(pickerSessionId),
          getUploadQueue(pickerSessionId),
        ])
        setUploadStatus(status)

        setQueueItems(prev => {
          const prevFailed    = (prev || []).filter(i => i.status === 'failed')
          const prevFailedIds = new Set(prevFailed.map(i => i.id))
          return [
            ...queue.filter(i => !prevFailedIds.has(i.id)),
            ...prevFailed.filter(i => !queue.find(q => q.id === i.id)),
          ]
        })
        const doneIds = queue.filter(i => i.status === 'done').map(i => i.id)
        if (doneIds.length > 0) {
          setTimeout(() => {
            setQueueItems(prev => (prev || []).filter(i => !doneIds.includes(i.id) || i.status !== 'done'))
          }, 2000)
        }

        const newOnes = ready.filter(r => !seenReadyIdsRef.current.has(r.uploadId))
        if (newOnes.length > 0) {
          for (const r of newOnes) seenReadyIdsRef.current.add(r.uploadId)
          const mapped = newOnes.map(mapReadyItem)
          appendItems(mapped)
          const dupeCount = newOnes.filter(r => r.isDuplicate).length
          if (dupeCount > 0) {
            const { showDupeToast, hideDupeToast } = useAppStore.getState()
            showDupeToast(dupeCount)
            setTimeout(() => hideDupeToast(), 5000)
          }
          const { swipeDecisions, setSwipeDecisions: sd } = useAppStore.getState()
          const updates = { ...swipeDecisions }
          for (const item of mapped) if (item.swipeDecision) updates[item.id] = item.swipeDecision
          sd(updates)
        }

        const total = status.pending + status.downloading + status.uploading + status.done + status.failed
        if (total > 0 && status.pending === 0 && status.downloading === 0 && status.uploading === 0) {
          stopUploadPolling()
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
      console.log(`[Upload] enqueued ${enqueued} items`)
      startUploadPolling(sessionId, append)
      setPickerState('done')
    } catch (err) {
      console.error('[Picker] loadPickerItems failed:', err.message)
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
        if (popupClosedCountRef.current >= SOFT_CLOSE_GRACE) {
          stopPolling(); setPickerState('idle'); savePickerSession(null); return
        }
      } else { popupClosedCountRef.current = 0 }
      try {
        const session = await getPickerSession(sessionId)
        if (session.mediaItemsSet) { stopPolling(); await loadPickerItems(sessionId, append) }
      } catch (err) {
        console.error('[Picker] poll error:', err.message)
        stopPolling(); setPickerError(err.message); setPickerState('idle')
      }
    }, PICKER_POLL_MS)
  }, [stopPolling, loadPickerItems, setPickerState, setPickerError])

  useEffect(() => {
    function onMessage(e) {
      if (e.origin !== window.location.origin || e.data?.type !== 'PICKER_DONE') return
      popupRef.current?.close()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const startPickerSession = useCallback(async (append = false) => {
    setPickerError(null); setPickerState('creating')
    try {
      const session = await createPickerSession()
      sessionRef.current = session.id
      savePickerSession(session.id)
      const w = 520, h = 760
      const left = window.screenX + (window.outerWidth  - w) / 2
      const top  = window.screenY + (window.outerHeight - h) / 2
      popupRef.current = window.open(session.pickerUri, 'google-picker', `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`)
      if (!popupRef.current) setPickerError(`POPUP_BLOCKED:${session.pickerUri}`)
      setPickerState('waiting')
      startPolling(session.id, append)
    } catch (err) {
      setPickerError(err.message); setPickerState('idle')
    }
  }, [startPolling, setPickerState, setPickerError])

  // On mount: restore all uploads + deleted items from backend
  useEffect(() => {
    if (authState !== 'authenticated') return
    ;(async () => {
      try {
        const [allItems, deletedRaw] = await Promise.all([
          getAllUploads(),
          getDeletedUploads(),
        ])
        if (allItems.length > 0) {
          const mapped = allItems.map(mapReadyItem)
          setItems(mapped)
          const decisions = {}
          for (const item of mapped) if (item.swipeDecision) decisions[item.id] = item.swipeDecision
          setSwipeDecisions(decisions)
          setPickerState('done')
          console.log(`[mount] restored ${mapped.length} uploads from backend`)
        }
        if (deletedRaw.length > 0) {
          setDeletedItems(deletedRaw.map(mapReadyItem))
          console.log(`[mount] restored ${deletedRaw.length} deleted items`)
        }
      } catch (err) {
        console.error('[mount] restore failed:', err.message)
      }
      const pending = getStoredPickerSession()
      if (pending) { sessionRef.current = pending; startPolling(pending, true) }
    })()
  }, [authState])

  const clearAndReset = useCallback(async () => {
    stopPolling(); stopUploadPolling()
    popupRef.current?.close()
    clearItemsCache(); saveLastItem(null); savePickerSession(null)
    clearAuthedImageCache()
    seenReadyIdsRef.current = new Set()
    try { await cleanupSession() } catch (err) { console.warn('[clearAndReset] cleanup failed:', err.message) }
    useAppStore.getState().resetItems()
  }, [stopPolling, stopUploadPolling])

  const cancelPickerSession = useCallback(() => {
    stopPolling(); stopUploadPolling()
    popupRef.current?.close()
    const sid = sessionRef.current
    if (sid) deletePickerSession(sid).catch(() => {})
    sessionRef.current = null; savePickerSession(null); setPickerState('idle')
  }, [stopPolling, stopUploadPolling, setPickerState])

  useEffect(() => () => { stopPolling(); stopUploadPolling() }, [stopPolling, stopUploadPolling])

  const { items, pickerState, uploadStatus } = useAppStore()
  return {
    items, pickerState, uploadStatus,
    startPickerSession, clearAndReset, cancelPickerSession,
    loading: ['creating','loading','uploading'].includes(pickerState),
  }
}
