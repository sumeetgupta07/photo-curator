// SwipeView.jsx — v2.5
// PURPOSE: Swipe interface card stack.
// Changelog:
//   v2.5: Passes showShortcuts + onToggleShortcuts to SwipeHUD for ? overlay.
//         Keyboard shortcuts now handled at window level in useSwipeActions —
//         SwipeCard arrow key handler kept as fallback for card-focus users.
//   v2.4: "All done ✓" overlay with auto-redirect instead of SwipeSummary.
//   v2.3: uses activeItems from useSwipeActions (respects album filter + sort order).

import React, { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from '../store/appStore.js'
import { useSwipeActions } from '../hooks/useSwipeActions.js'
import { useAuthedMediaItemUrl, preloadAuthedMediaItem } from '../hooks/useAuthedImage.js'
import { IMG_SIZES } from '../lib/config.js'
import SwipeCard from './SwipeCard.jsx'
import SwipeHUD from './SwipeHUD.jsx'
import styles from './SwipeView.module.css'

const PRELOAD_AHEAD = 3

export default function SwipeView() {
  const { setView } = useAppStore()
  const {
    swipeRight, swipeLeft, swipeUp, swipeDown,
    currentIndex, total, writeError, pendingCount,
    activeItems, showShortcuts, setShowShortcuts,
  } = useSwipeActions()
  const [showDone, setShowDone] = useState(false)

  // Detect stack exhaustion → "All done" → auto-return to gallery
  const isDone = activeItems.length > 0 && currentIndex >= activeItems.length
  useEffect(() => {
    if (!isDone) return
    setShowDone(true)
    const t = setTimeout(() => { setShowDone(false); setView('grid') }, 2000)
    return () => clearTimeout(t)
  }, [isDone, setView])

  // Preload upcoming cards
  useEffect(() => {
    for (let i = currentIndex + 1; i <= currentIndex + PRELOAD_AHEAD; i++) {
      if (activeItems[i]?.id) preloadAuthedMediaItem(activeItems[i].id, IMG_SIZES.preload)
    }
  }, [currentIndex, activeItems])

  const currentItem = activeItems[currentIndex]
  const nextItem    = activeItems[currentIndex + 1]
  const bgSrc   = useAuthedMediaItemUrl(currentItem?.id, IMG_SIZES.thumb)
  const nextSrc = useAuthedMediaItemUrl(nextItem?.id, IMG_SIZES.full)

  if (showDone) {
    return (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', gap: 12 }}
      >
        <div style={{ fontSize: 48 }}>✓</div>
        <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text)' }}>All done!</div>
        <div style={{ fontSize: 14, color: 'var(--text-2)' }}>Returning to gallery…</div>
      </motion.div>
    )
  }

  if (!currentItem) {
    return (
      <div className={styles.empty}>
        <p>No photos loaded.</p>
        <button className={styles.backBtn} onClick={() => setView('grid')}>Back to Gallery</button>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.bgBlur} style={bgSrc ? { backgroundImage: `url(${bgSrc})` } : undefined}/>
      <div className={styles.stack}>
        {nextItem?.id && nextSrc && (
          <div className={styles.nextCard}><img src={nextSrc} alt="" className={styles.nextImg}/></div>
        )}
        <AnimatePresence mode="wait">
          <SwipeCard
            key={currentItem.id}
            item={currentItem}
            onSwipeRight={swipeRight}
            onSwipeLeft={swipeLeft}
            onSwipeUp={swipeUp}
            onSwipeDown={swipeDown}
          />
        </AnimatePresence>
      </div>
      <SwipeHUD
        current={currentIndex + 1}
        total={total}
        onBack={() => setView('grid')}
        onSwipeLeft={swipeLeft}
        onSwipeRight={swipeRight}
        onSwipeUp={swipeUp}
        onSwipeDown={swipeDown}
        hasPrev={currentIndex > 0}
        writeError={writeError}
        pendingCount={pendingCount}
        showShortcuts={showShortcuts}
        onToggleShortcuts={() => setShowShortcuts(v => !v)}
      />
    </div>
  )
}
