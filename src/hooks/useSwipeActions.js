// useSwipeActions.js — v2.0 Stage 3
//
// Full rewrite of the swipe-to-album routing. The old v0.7 version has
// been deliberately inert since Stage 1 (its `token`-gated queue never
// fired — see the STALE note in that version). Stage 3 is the first time
// this flow actually works end-to-end, because:
//   1. Auth is now backend-managed (no client-side token needed — cookie)
//   2. Items now have `ourMediaItemId` (Stage 2 re-uploaded them so Google
//      accepts them in batchAddMediaItems — Picker item.id never worked)
//   3. The backend's /api/swipe route handles the album write server-side
//
// "Latest action wins" (from original handover Design Decision #7) is
// preserved: if a user swipes Good then later swipes Bad on the same photo,
// the pending queue de-dups and only sends the most recent decision to the
// backend. Note: due to Google Photos API limitations, we cannot REMOVE
// an item from the Good album if they change their mind to Bad — both
// albums will contain it. This is documented as a known limitation and
// acceptable for a personal curation tool.
//
// Queue persistence: swipe decisions are stored in localStorage (same
// key as before — pc_swipe_queue) and retried every 4s on failure, so
// decisions survive page reloads even if the album write hasn't completed
// yet. The backend also persists the decision on each /api/swipe call
// (swipe_decision column) independently for audit purposes.
import { useCallback, useRef, useEffect, useState } from 'react'
import { recordSwipe } from '../lib/backendApi.js'
import { ALBUM_GOOD, ALBUM_BAD } from '../lib/config.js'
import { useAppStore } from '../store/appStore.js'

const QUEUE_KEY  = 'pc_swipe_queue'
const ERRORS_KEY = 'pc_swipe_errors'
const RETRY_MS   = 4000

function loadQueue()     { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)  || '[]') } catch { return [] } }
function saveQueue(q)    { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)) } catch {} }
function clearQueue()    { localStorage.removeItem(QUEUE_KEY) }
function appendError(e)  {
  try {
    const errs = JSON.parse(localStorage.getItem(ERRORS_KEY) || '[]')
    errs.push(e)
    localStorage.setItem(ERRORS_KEY, JSON.stringify(errs.slice(-20)))
  } catch {}
}

export function useSwipeActions() {
  const { items, currentIndex, setCurrentIndex, addSwipeResult, authState } = useAppStore()

  const queue      = useRef(loadQueue())
  const processing = useRef(false)
  const retryTimer = useRef(null)
  const [writeError, setWriteError] = useState(null)
  const [pendingCount, setPendingCount] = useState(queue.current.length)

  // ── Queue processor ──────────────────────────────────────────────────────────
  const processQueue = useCallback(async () => {
    if (processing.current || authState !== 'authenticated') return
    if (queue.current.length === 0) return
    processing.current = true
    setWriteError(null)

    while (queue.current.length > 0) {
      const task = queue.current[0]

      if (!task.ourMediaItemId) {
        console.error('[Swipe] skipping task with no ourMediaItemId:', task)
        queue.current.shift()
        saveQueue(queue.current)
        setPendingCount(queue.current.length)
        continue
      }

      try {
        console.log(`[Swipe] writing ${task.ourMediaItemId.slice(0, 20)}… → "${task.albumName}"`)
        await recordSwipe(task.ourMediaItemId, task.decision)
        console.log(`[Swipe] ✓ written to "${task.albumName}"`)

        queue.current.shift()
        saveQueue(queue.current)
        setPendingCount(queue.current.length)
      } catch (err) {
        const msg = err.message || 'Unknown error'
        console.error('[Swipe] write failed:', msg, task)
        appendError({ ts: Date.now(), msg, album: task.albumName, id: task.ourMediaItemId })
        setWriteError(msg)
        await new Promise(r => { retryTimer.current = setTimeout(r, RETRY_MS) })
        setWriteError(null)
      }
    }

    processing.current = false
    if (queue.current.length === 0) clearQueue()
  }, [authState])

  useEffect(() => {
    if (authState === 'authenticated' && queue.current.length > 0) {
      console.log(`[Swipe] Resuming ${queue.current.length} pending writes`)
      processQueue()
    }
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current) }
  }, [authState, processQueue])

  // ── Enqueue — latest action wins ─────────────────────────────────────────────
  const enqueue = useCallback((ourMediaItemId, decision, albumName) => {
    if (!ourMediaItemId) {
      console.error('[Swipe] enqueue: no ourMediaItemId — item may not be fully uploaded yet')
      return
    }
    // Remove any prior queued decision for this item
    queue.current = queue.current.filter(t => t.ourMediaItemId !== ourMediaItemId)
    queue.current.push({ ourMediaItemId, decision, albumName })
    saveQueue(queue.current)
    setPendingCount(queue.current.length)
    console.log(`[Swipe] queued "${albumName}" (${decision}) for ${ourMediaItemId.slice(0, 20)}…`)
    processQueue()
  }, [processQueue])

  // ── Navigation ───────────────────────────────────────────────────────────────
  const total = items.length

  const goNext = useCallback(() => {
    setCurrentIndex(currentIndex + 1)
  }, [currentIndex, setCurrentIndex])

  const goPrev = useCallback(() => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1)
  }, [currentIndex, setCurrentIndex])

  // ── Swipe actions ─────────────────────────────────────────────────────────────
  const swipeRight = useCallback(() => {
    const item = items[currentIndex]
    if (!item) return
    console.log('[Swipe] → RIGHT (Good)', { ourMediaItemId: item.ourMediaItemId, filename: item.filename })
    enqueue(item.ourMediaItemId, 'good', ALBUM_GOOD)
    addSwipeResult(item.ourMediaItemId, 'good')
    goNext()
  }, [items, currentIndex, enqueue, addSwipeResult, goNext])

  const swipeLeft = useCallback(() => {
    const item = items[currentIndex]
    if (!item) return
    console.log('[Swipe] ← LEFT (Bad)', { ourMediaItemId: item.ourMediaItemId, filename: item.filename })
    enqueue(item.ourMediaItemId, 'bad', ALBUM_BAD)
    addSwipeResult(item.ourMediaItemId, 'bad')
    goNext()
  }, [items, currentIndex, enqueue, addSwipeResult, goNext])

  const swipeUp = useCallback(() => {
    const item = items[currentIndex]
    if (!item) return
    console.log('[Swipe] ↑ UP (Skip)', item.ourMediaItemId)
    // Skip doesn't write to an album — but still call recordSwipe to
    // persist the decision in the backend for audit/future use.
    recordSwipe(item.ourMediaItemId, 'skip').catch(() => {})
    addSwipeResult(item.ourMediaItemId, 'skip')
    goNext()
  }, [items, currentIndex, addSwipeResult, goNext])

  const swipeDown = useCallback(() => {
    goPrev()
  }, [goPrev])

  return {
    swipeRight, swipeLeft, swipeUp, swipeDown,
    currentIndex, total,
    writeError, pendingCount,
  }
}
