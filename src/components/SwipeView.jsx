// SwipeView.jsx — v2.3
// PURPOSE: Swipe interface card stack.
// v2.3: uses activeItems from useSwipeActions (respects album filter +
// sort order). Passes item.id for local thumb URLs.

import React, { useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useAppStore } from '../store/appStore.js'
import { useSwipeActions } from '../hooks/useSwipeActions.js'
import { useAuthedMediaItemUrl, preloadAuthedMediaItem } from '../hooks/useAuthedImage.js'
import { IMG_SIZES } from '../lib/config.js'
import SwipeCard from './SwipeCard.jsx'
import SwipeHUD from './SwipeHUD.jsx'
import SwipeSummary from './SwipeSummary.jsx'
import styles from './SwipeView.module.css'

const PRELOAD_AHEAD = 3

export default function SwipeView() {
  const { setView, resetItems } = useAppStore()
  const { swipeRight, swipeLeft, swipeUp, swipeDown, currentIndex, total, writeError, pendingCount, activeItems } = useSwipeActions()

  useEffect(() => {
    for (let i = currentIndex + 1; i <= currentIndex + PRELOAD_AHEAD; i++) {
      if (activeItems[i]?.id) preloadAuthedMediaItem(activeItems[i].id, IMG_SIZES.preload)
    }
  }, [currentIndex, activeItems])

  if (activeItems.length > 0 && currentIndex >= activeItems.length) {
    return <SwipeSummary onContinue={() => setView('grid')} onReset={() => { resetItems(); setView('grid') }} />
  }

  const currentItem = activeItems[currentIndex]
  const nextItem    = activeItems[currentIndex + 1]

  const bgSrc   = useAuthedMediaItemUrl(currentItem?.id, IMG_SIZES.thumb)
  const nextSrc = useAuthedMediaItemUrl(nextItem?.id, IMG_SIZES.full)

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
      />
    </div>
  )
}
