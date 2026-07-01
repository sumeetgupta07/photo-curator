// GridView.jsx — v2.10
// PURPOSE: Grid view — thumbnail grid with sort/filter pills and session controls.
// v2.10: "Clear Session" replaced with "Start New Session" (saves current, opens
//        fresh). Sessions icon button (≡) added to header opens SessionMenu sheet.
//        "Add More Photos" stays in fixed header. Double-tap confirmation removed
//        (Start New is a softer action — old photos are preserved not deleted).
// v2.9: grid→swipe sync fix via applyGrouping; processed filter pill.

import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../store/appStore.js'
import { applyGrouping } from '../lib/grouping.js'
import { IMG_SIZES, SORT_GROUP_OPTIONS } from '../lib/config.js'
import { useAuthedMediaItemUrl } from '../hooks/useAuthedImage.js'
import UploadStatusPanel from './UploadStatusPanel.jsx'
import AlbumDot from './AlbumDot.jsx'
import BandwidthMeter from './BandwidthMeter.jsx'
import styles from './GridView.module.css'

const PICKER_LABELS = {
  idle: null, creating: 'Opening picker…', waiting: 'Waiting for you to finish selecting…',
  loading: 'Loading selected photos…', uploading: 'Starting background upload…', done: null,
}

const ALBUM_FILTERS = [
  { key: null,        label: 'All' },
  { key: 'good',      label: '✓ Good' },
  { key: 'bad',       label: '✕ Bad' },
  { key: 'duplicate', label: 'Dupes' },
  { key: 'processed', label: 'Processed' },
]

export default function GridView({
  onSignOut, pickerState, onPickPhotos, onAddMorePhotos,
  onStartNewSession, onOpenSessionMenu, onCancelPicker,
}) {
  const {
    items, setView, setCurrentIndex,
    pickerError, uploadStatus,
    sortGroup, setSortGroup,
    activeAlbum, setActiveAlbum,
    swipeDecisions, processedIds,
  } = useAppStore()

  // ── Active item list (same as useSwipeActions) ────────────────────────────
  const activeItems = React.useMemo(() => {
    if (activeAlbum === 'processed') return items.filter(i => processedIds?.has(i.id))
    return applyGrouping(items, sortGroup, swipeDecisions, activeAlbum).flatMap(g => g.items)
  }, [items, sortGroup, swipeDecisions, activeAlbum, processedIds])

  const groups = React.useMemo(() => {
    if (activeAlbum === 'processed') {
      return activeItems.length > 0 ? [{ key: 'processed', label: 'Processed', items: activeItems }] : []
    }
    return applyGrouping(items, sortGroup, swipeDecisions, activeAlbum)
  }, [items, sortGroup, swipeDecisions, activeAlbum, activeItems])

  // ── Grid→swipe navigation ─────────────────────────────────────────────────
  const openSwipe = React.useCallback((itemId) => {
    const idx = activeItems.findIndex(i => i.id === itemId)
    if (idx === -1) return
    setCurrentIndex(idx)
    setView('swipe')
  }, [activeItems, setCurrentIndex, setView])

  const statusMsg = PICKER_LABELS[pickerState]
  const hasItems  = items.length > 0
  const isWorking = ['creating', 'waiting', 'loading', 'uploading'].includes(pickerState)
  const hasUploadActivity = (uploadStatus.pending + uploadStatus.downloading + uploadStatus.uploading) > 0
  const popupBlockedUrl = pickerError?.startsWith('POPUP_BLOCKED:') ? pickerError.replace('POPUP_BLOCKED:', '') : null

  return (
    <div className={styles.root}>
      {/* ── Fixed header ─────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <h1 className={styles.logo}>Photo <em>Curator</em></h1>
          <div className={styles.headerActions}>
            {hasItems && <span className={styles.count}>{items.length} photos</span>}
            {hasItems && (
              <button className={styles.addMoreBtn} onClick={onAddMorePhotos} disabled={isWorking} title="Add more photos">
                + Add More
              </button>
            )}
            {/* Sessions menu button */}
            <button className={styles.iconBtn} onClick={onOpenSessionMenu} title="Sessions">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="3" y1="6"  x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <button className={styles.iconBtn} onClick={onSignOut} title="Sign out">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Sort + filter pills */}
        {hasItems && (
          <div className={styles.pillBar}>
            <div className={styles.pillGroup}>
              {SORT_GROUP_OPTIONS.map(opt => (
                <button key={opt.key} className={`${styles.pill} ${sortGroup === opt.key ? styles.pillActive : ''}`} onClick={() => setSortGroup(opt.key)}>
                  {opt.label}
                </button>
              ))}
            </div>
            <div className={styles.pillDivider}/>
            <div className={styles.pillGroup}>
              {ALBUM_FILTERS.map(f => (
                <button key={String(f.key)} className={`${styles.pill} ${activeAlbum === f.key ? styles.pillActive : ''}`} onClick={() => setActiveAlbum(activeAlbum === f.key ? null : f.key)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Picker status bar */}
      <AnimatePresence>
        {(statusMsg || popupBlockedUrl) && (
          <motion.div className={styles.statusBar} initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }} exit={{ opacity:0, height:0 }}>
            {popupBlockedUrl ? (
              <span>Popup blocked. <a href={popupBlockedUrl} target="_blank" rel="noreferrer" className={styles.statusLink}>Open picker manually ↗</a></span>
            ) : (
              <span>
                <span className={styles.statusSpinner}/> {statusMsg}
                {pickerState === 'waiting' && (
                  <button type="button" onClick={onCancelPicker} className={styles.statusLink}
                    style={{ marginLeft:12, background:'none', border:'none', cursor:'pointer', textDecoration:'underline', font:'inherit', padding:0 }}>
                    Cancel
                  </button>
                )}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <UploadStatusPanel status={uploadStatus} />
      <BandwidthMeter />

      {/* Scrollable content */}
      <div className={styles.scroll}>
        {!hasItems && !isWorking && !hasUploadActivity && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <rect x="4" y="4" width="40" height="40" rx="10" stroke="var(--border)" strokeWidth="1.5"/>
                <circle cx="17" cy="19" r="3" stroke="var(--text-3)" strokeWidth="1.5"/>
                <path d="M4 30l10-8 8 6 6-5 16 13" stroke="var(--text-3)" strokeWidth="1.5" strokeLinejoin="round"/>
                <circle cx="36" cy="14" r="6" fill="var(--bg-3)" stroke="var(--accent)" strokeWidth="1.5"/>
                <path d="M36 11v6M33 14h6" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <h2 className={styles.emptyTitle}>No photos in this session</h2>
            <p className={styles.emptySub}>Choose photos from your Google Photos library to start curating.</p>
            <motion.button className={styles.primaryBtn} onClick={onPickPhotos} whileTap={{ scale:0.96 }}>
              Select Photos to Curate
            </motion.button>
          </div>
        )}

        {hasItems && groups.length === 0 && (
          <div className={styles.emptyState}>
            <p className={styles.emptySub}>No photos in this filter.</p>
          </div>
        )}

        {hasItems && groups.map(({ key, label, items: groupItems }) => (
          <section key={key} className={styles.group}>
            <h2 className={styles.dateLabel}>{label}</h2>
            <div className={styles.grid}>
              {groupItems.map(item => (
                <GridThumb key={item.id} item={item} onOpen={openSwipe} swipeDecisions={swipeDecisions} processedIds={processedIds} />
              ))}
            </div>
          </section>
        ))}

        {/* Start New Session — replaces "Clear Session" */}
        {hasItems && (
          <div className={styles.bottomActions}>
            <button className={styles.secondaryBtn} onClick={onStartNewSession} disabled={isWorking}>
              Start New Session
            </button>
          </div>
        )}

        <div style={{ height:1 }}/>
      </div>

      {/* Swipe FAB */}
      {hasItems && (
        <motion.button className={styles.fab} onClick={() => { setCurrentIndex(0); setView('swipe') }}
          initial={{ scale:0 }} animate={{ scale:1 }} whileTap={{ scale:0.92 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
          Swipe
        </motion.button>
      )}
    </div>
  )
}

function GridThumb({ item, onOpen, swipeDecisions, processedIds }) {
  const src      = useAuthedMediaItemUrl(item.id, IMG_SIZES.thumb)
  const decision = swipeDecisions?.[item.id] || item.swipeDecision
  const isProcessed = processedIds?.has(item.id)
  return (
    <motion.button
      className={`${styles.thumb} ${isProcessed ? styles.thumbProcessed : ''}`}
      onClick={() => onOpen(item.id)} whileTap={{ scale:0.95, opacity:0.8 }} transition={{ duration:0.1 }}>
      {src
        ? <img src={src} alt={item.filename||''} className={styles.thumbImg} loading="lazy" onError={e => { e.target.style.opacity='0.3' }}/>
        : <div className={styles.thumbImg} style={{ background:'var(--bg-3)' }}/>
      }
      {item.isLivePhoto && <div className={styles.livePhotoBadge}>◎</div>}
      {item.mediaMetadata?.video && !item.isLivePhoto && <div className={styles.videoIcon}>▶</div>}
      <AlbumDot decision={decision} />
    </motion.button>
  )
}
