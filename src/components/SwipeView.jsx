// SwipeView.jsx — v2.0 Stage 2
//
// Card-stack container for the swipe interface: renders the current
// SwipeCard, a blurred background of the current photo, a peek of the
// next card, and prefetches upcoming images ahead of the stack.
//
// v0.6: switched all three image usages (bg-blur, next-card peek,
// prefetch) to the authenticated-fetch helpers in useAuthedImage.js.
//
// v2.0 Stage 1: token removed entirely (auth is now a same-origin cookie).
//
// v2.0 Stage 2: switched all three usages from baseUrl-based to
// ourMediaItemId-based (useAuthedMediaItemUrl/preloadAuthedMediaItem) —
// items in the store are now READY (re-uploaded) items, which don't carry
// a baseUrl at all. See useMediaItems.js v2.0 Stage 2 for the full flow
// change (swipe stack now grows incrementally as background uploads
// complete, rather than being populated all at once from the Picker).
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

  // Prefetch upcoming images (authenticated via cookie — see useAuthedImage.js)
  useEffect(() => {
    for (let i = currentIndex + 1; i <= currentIndex + PRELOAD_AHEAD; i++) {
      if (items[i]?.ourMediaItemId) {
        preloadAuthedMediaItem(items[i].ourMediaItemId, IMG_SIZES.preload)
      }
    }
  }, [currentIndex, items])

  if (items.length > 0 && currentIndex >= items.length) {
    return (
      <SwipeSummary
        onContinue={() => setView('grid')}
        onReset={() => { resetItems(); setView('grid') }}
      />
    )
  }

  const currentItem = items[currentIndex]
  const nextItem    = items[currentIndex + 1]

  // Hooks must run unconditionally — compute both before any early return.
  const bgSrc   = useAuthedMediaItemUrl(currentItem?.ourMediaItemId, IMG_SIZES.thumb)
  const nextSrc = useAuthedMediaItemUrl(nextItem?.ourMediaItemId, IMG_SIZES.full)

  if (!currentItem) {
    return (
      <div className={styles.empty}>
        <p>No photos loaded.</p>
        <button className={styles.emptyBtn} onClick={() => setView('grid')}>Back to Gallery</button>
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.bgBlur}
        style={bgSrc ? { backgroundImage: `url(${bgSrc})` } : undefined}/>

      <div className={styles.stack}>
        {nextItem?.ourMediaItemId && nextSrc && (
          <div className={styles.nextCard}>
            <img src={nextSrc} alt="" className={styles.nextImg}/>
          </div>
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
