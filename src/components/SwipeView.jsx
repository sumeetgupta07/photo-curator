// SwipeView.jsx — v2.1
// v2.1: passes item.id (uploadId) instead of item.ourMediaItemId to
// useAuthedMediaItemUrl/preloadAuthedMediaItem — local thumbs are keyed
// by uploadId, not Google's media item ID.
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
  const { items, currentIndex, setView, resetItems } = useAppStore()
  const { swipeRight, swipeLeft, swipeUp, swipeDown, total, writeError, pendingCount } = useSwipeActions()
  useEffect(() => {
    for (let i = currentIndex+1; i <= currentIndex+PRELOAD_AHEAD; i++) {
      if (items[i]?.id) preloadAuthedMediaItem(items[i].id, IMG_SIZES.preload)
    }
  }, [currentIndex, items])
  if (items.length > 0 && currentIndex >= items.length) {
    return <SwipeSummary onContinue={() => setView('grid')} onReset={() => { resetItems(); setView('grid') }} />
  }
  const currentItem = items[currentIndex]
  const nextItem    = items[currentIndex+1]
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
      <div className={styles.bgBlur} style={bgSrc ? { backgroundImage:`url(${bgSrc})` } : undefined}/>
      <div className={styles.stack}>
        {nextItem?.id && nextSrc && (
          <div className={styles.nextCard}><img src={nextSrc} alt="" className={styles.nextImg}/></div>
        )}
        <AnimatePresence mode="wait">
          <SwipeCard key={currentItem.id} item={currentItem} onSwipeRight={swipeRight} onSwipeLeft={swipeLeft} onSwipeUp={swipeUp} onSwipeDown={swipeDown} />
        </AnimatePresence>
      </div>
      <SwipeHUD current={currentIndex+1} total={total} onBack={() => setView('grid')} onSwipeLeft={swipeLeft} onSwipeRight={swipeRight} onSwipeUp={swipeUp} onSwipeDown={swipeDown} hasPrev={currentIndex>0} writeError={writeError} pendingCount={pendingCount} />
    </div>
  )
}
