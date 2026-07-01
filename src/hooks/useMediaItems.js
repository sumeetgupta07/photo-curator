// useMediaItems.js — v2.6
// PURPOSE: Picker session lifecycle + upload pipeline + curation session mgmt.
// v2.6 changes:
//   - reloadFromBackend(): re-fetches /api/uploads/all (now session-scoped on
//     backend) + /api/uploads/deleted, resets store items. Used after session
//     switch so grid reflects the newly active session without page reload.
//   - clearAndReset() now calls POST /api/curation-sessions/start-new instead
//     of /api/cleanup, which: saves the current session name (no-op, already
//     named), creates a fresh curation session, marks it active. Frontend then
//     resets store to empty. Old photos are preserved in their named session
//     and accessible via SessionMenu.
//   - Exposes reloadFromBackend + startNewSession for App/GridView to use.
// v2.5: mapReadyItem passes isLivePhoto.
// v2.4: fetches /api/uploads/deleted on mount.
// v2.3: dupeToast on duplicate detection.

import { useCallback, useEffect, useRef } from 'react'
import {
  createPickerSession, getPickerSession,
  fetchPickerItems, deletePickerSession,
  startUpload, getUploadStatus, getReadyUploads,
  getUploadQueue, getAllUploads, getDeletedUploads,
  startNewCurationSession,
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
    isLivePhoto:    r.isLivePhoto || false,
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
    showDupeToast, hideDupeToast,
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

  // ── Backend restore ────────────────────────────────────────────────────────
  // Fetches active-session uploads + deleted items, resets store.
  // Called on mount AND after session switch.
  const reloadFromBackend = useCallback(async () => {
    try {
      const [allItems, deletedRaw] = await Promise.all([getAllUploads(), getDeletedUploads()])
      if (allItems.length > 0) {
        const mapped = allItems.map(mapReadyItem)
        setItems(mapped)
        const decisions = {}
        for (const item of mapped) if (item.swipeDecision) decisions[item.id] = item.swipeDecision
        setSwipeDecisions(decisions)
        setPickerState('done')
        console.log(`[mount] restored ${mapped.length} uploads from active session`)
      } else {
        setItems([])
        setSwipeDecisions({})
        setPickerState('idle')
      }
      if (deletedRaw.length > 0) setDeletedItems(deletedRaw.map(mapReadyItem))
    } catch (err) {
      console.error('[reloadFromBackend] failed:', err.message)
    }
  }, [setItems, setSwipeDecisions, setPickerState, setDeletedItems])

  // ── Upload polling ─────────────────────────────────────────────────────────
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
  }, [stopUploadPolling, appendItems, setUploadStatus, setQueueItems, showDupeToast, hideDupeToast])

  // ── Picker session flow ───────────────────────────────────────────────────
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
    } catch (err) { setPickerError(err.message); setPickerState('idle') }
  }, [startPolling, setPickerState, setPickerError])

  // ── Start New Session ──────────────────────────────────────────────────────
  // Saves the current session (already named on backend — no rename needed),
  // creates a fresh curation session on backend, resets frontend store.
  const startNewSession = useCallback(async () => {
    stopPolling(); stopUploadPolling()
    popupRef.current?.close()
    savePickerSession(null); saveLastItem(null)
    clearAuthedImageCache()
    seenReadyIdsRef.current = new Set()
    try {
      await startNewCurationSession()
    } catch (err) {
      console.warn('[startNewSession] backend call failed (non-fatal):', err.message)
    }
    useAppStore.getState().resetItems()
    clearItemsCache()
  }, [stopPolling, stopUploadPolling])

  // ── On mount: restore active session ──────────────────────────────────────
  useEffect(() => {
    if (authState !== 'authenticated') return
    ;(async () => {
      await reloadFromBackend()
      const pending = getStoredPickerSession()
      if (pending) { sessionRef.current = pending; startPolling(pending, true) }
    })()
  }, [authState])  // eslint-disable-line react-hooks/exhaustive-deps

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
    startPickerSession, cancelPickerSession,
    startNewSession,
    reloadFromBackend,   // exposed for SessionMenu onSessionSwitch
    loading: ['creating','loading','uploading'].includes(pickerState),
  }
}
