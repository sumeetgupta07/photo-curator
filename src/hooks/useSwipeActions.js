// useSwipeActions.js — v2.3
// PURPOSE: Swipe gesture handling + album write queue.
// v2.3: when activeAlbum is set, swipe view starts from first unreviewed
// photo in the filtered set. "Unreviewed" means no swipe decision yet.

import { useCallback, useRef, useEffect, useState } from 'react'
import { recordSwipe } from '../lib/backendApi.js'
import { ALBUM_GOOD, ALBUM_BAD } from '../lib/config.js'
import { useAppStore } from '../store/appStore.js'
import { applyGrouping } from '../lib/grouping.js'

const QUEUE_KEY  = 'pc_swipe_queue'
const ERRORS_KEY = 'pc_swipe_errors'
const RETRY_MS   = 4000

function loadQueue()    { try { return JSON.parse(localStorage.getItem(QUEUE_KEY)  || '[]') } catch { return [] } }
function saveQueue(q)   { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)) } catch {} }
function clearQueue()   { localStorage.removeItem(QUEUE_KEY) }
function appendError(e) {
  try {
    const errs = JSON.parse(localStorage.getItem(ERRORS_KEY) || '[]')
    errs.push(e); localStorage.setItem(ERRORS_KEY, JSON.stringify(errs.slice(-20)))
  } catch {}
}

export function useSwipeActions() {
  const {
    items, currentIndex, setCurrentIndex, addSwipeResult,
    authState, updateSwipeDecision,
    sortGroup, swipeDecisions, activeAlbum,
  } = useAppStore()

  const queue      = useRef(loadQueue())
  const processing = useRef(false)
  const retryTimer = useRef(null)
  const [writeError,   setWriteError]   = useState(null)
  const [pendingCount, setPendingCount] = useState(queue.current.length)

  // Compute the active item list — filtered+sorted the same way as GridView
  const activeItems = activeAlbum
    ? applyGrouping(items, sortGroup, swipeDecisions, activeAlbum).flatMap(g => g.items)
    : items

  // On mount when activeAlbum is set, start from first unreviewed photo
  useEffect(() => {
    if (!activeAlbum) return
    const firstUnreviewed = activeItems.findIndex(item => {
      const dec = swipeDecisions[item.id] || item.swipeDecision
      return !dec
    })
    setCurrentIndex(firstUnreviewed >= 0 ? firstUnreviewed : 0)
  }, [activeAlbum])

  const processQueue = useCallback(async () => {
    if (processing.current || authState !== 'authenticated') return
    if (queue.current.length === 0) return
    processing.current = true
    setWriteError(null)

    while (queue.current.length > 0) {
      const task = queue.current[0]
      if (!task.ourMediaItemId) {
        queue.current.shift(); saveQueue(queue.current); setPendingCount(queue.current.length); continue
      }
      try {
        await recordSwipe(task.ourMediaItemId, task.decision)
        queue.current.shift(); saveQueue(queue.current); setPendingCount(queue.current.length)
      } catch (err) {
        const msg = err.message || 'Unknown error'
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
    if (authState === 'authenticated' && queue.current.length > 0) processQueue()
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current) }
  }, [authState, processQueue])

  const enqueue = useCallback((uploadId, ourMediaItemId, decision, albumName) => {
    if (!ourMediaItemId) { console.error('[Swipe] enqueue: no ourMediaItemId'); return }
    queue.current = queue.current.filter(t => t.ourMediaItemId !== ourMediaItemId)
    queue.current.push({ ourMediaItemId, decision, albumName })
    saveQueue(queue.current); setPendingCount(queue.current.length)
    updateSwipeDecision(uploadId, decision)
    processQueue()
  }, [processQueue, updateSwipeDecision])

  const total  = activeItems.length
  const goNext = useCallback(() => setCurrentIndex(currentIndex + 1), [currentIndex, setCurrentIndex])
  const goPrev = useCallback(() => { if (currentIndex > 0) setCurrentIndex(currentIndex - 1) }, [currentIndex, setCurrentIndex])

  const swipeRight = useCallback(() => {
    const item = activeItems[currentIndex]; if (!item) return
    enqueue(item.id, item.ourMediaItemId, 'good', ALBUM_GOOD)
    addSwipeResult(item.id, 'good'); goNext()
  }, [activeItems, currentIndex, enqueue, addSwipeResult, goNext])

  const swipeLeft = useCallback(() => {
    const item = activeItems[currentIndex]; if (!item) return
    enqueue(item.id, item.ourMediaItemId, 'bad', ALBUM_BAD)
    addSwipeResult(item.id, 'bad'); goNext()
  }, [activeItems, currentIndex, enqueue, addSwipeResult, goNext])

  const swipeUp = useCallback(() => {
    const item = activeItems[currentIndex]; if (!item) return
    updateSwipeDecision(item.id, 'skip')
    recordSwipe(item.ourMediaItemId, 'skip').catch(() => {})
    addSwipeResult(item.id, 'skip'); goNext()
  }, [activeItems, currentIndex, addSwipeResult, goNext, updateSwipeDecision])

  const swipeDown = useCallback(() => goPrev(), [goPrev])

  return {
    swipeRight, swipeLeft, swipeUp, swipeDown,
    currentIndex, total,
    writeError, pendingCount,
    activeItems,
  }
}
