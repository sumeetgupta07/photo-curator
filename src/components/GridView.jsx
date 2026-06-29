// GridView.jsx — v2.5
// PURPOSE: Chronological grid of curated photos.
// v2.5 changes:
//   - "Add More Photos" button moved to header (fixed, non-scrolling)
//   - "Clear Session" moved to bottom of scroll area with double-confirmation
//     (first click: turns red + asks "Tap again to confirm"; second click: executes)
//   - Both buttons disabled while picker is active / upload in progress

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../store/appStore.js'
import { applyGrouping } from '../lib/grouping.js'
import { SORT_GROUP_OPTIONS, IMG_SIZES } from '../lib/config.js'
import { useAuthedMediaItemUrl } from '../hooks/useAuthedImage.js'
import UploadStatusPanel from './UploadStatusPanel.jsx'
import AlbumDot from './AlbumDot.jsx'
import AlbumDrawer from './AlbumDrawer.jsx'
import styles from './GridView.module.css'

const PICKER_LABELS = {
  idle: null, creating: 'Opening picker…',
  waiting: 'Waiting for you to finish selecting…',
  loading: 'Loading selected photos…',
  uploading: 'Starting background upload…', done: null,
}

export default function GridView({ onSignOut, pickerState, onPickPhotos, onAddMorePhotos, onClearSession, onCancelPicker }) {
  const {
    items, setView, setCurrentIndex, pickerError, uploadStatus,
    sortGroup, setSortGroup, activeAlbum, setActiveAlbum,
    swipeDecisions, deletedItems,
  } = useAppStore()

  const [drawerOpen,    setDrawerOpen]    = useState(false)
  const [clearPending,  setClearPending]  = useState(false)  // double-confirm state

  const openSwipe = (index) => { setCurrentIndex(index); setView('swipe') }
  const statusMsg  = PICKER_LABELS[pickerState]
  const hasItems   = items.length > 0
  const isWorking  = ['creating','waiting','loading','uploading'].includes(pickerState)
  const hasUploadActivity = (uploadStatus.pending + uploadStatus.downloading + uploadStatus.uploading) > 0
  const popupBlockedUrl = pickerError?.startsWith('POPUP_BLOCKED:') ? pickerError.replace('POPUP_BLOCKED:', '') : null

  const groups = applyGrouping(items, sortGroup, swipeDecisions, activeAlbum)

  // Build flat indexed list matching useSwipeActions activeItems order
  let runningIndex = 0
  const groupsWithIndex = groups.map(group => {
    const startIndex = runningIndex
    runningIndex += group.items.length
    return { ...group, startIndex }
  })

  const ALBUM_LABEL = { good: 'Good', bad: 'Bad', duplicate: 'Duplicates' }

  function handleClearSession() {
    if (!clearPending) {
      setClearPending(true)
      // Auto-cancel after 4 seconds if not confirmed
      setTimeout(() => setClearPending(false), 4000)
      return
    }
    setClearPending(false)
    onClearSession()
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          {activeAlbum ? (
            <>
              <button className={styles.iconBtn} onClick={() => setActiveAlbum(null)} title="All photos">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <polyline points="15,18 9,12 15,6"/>
                </svg>
              </button>
              <h1 className={styles.logo}><em>{ALBUM_LABEL[activeAlbum] || activeAlbum}</em></h1>
            </>
          ) : (
            <h1 className={styles.logo}>Photo <em>Curator</em></h1>
          )}

          <div className={styles.headerActions}>
            {hasItems && <span className={styles.count}>{items.length} photos</span>}

            {/* Add More Photos — fixed in header, always visible when items exist */}
            {hasItems && !activeAlbum && (
              <button
                className={styles.addMoreBtn}
                onClick={onAddMorePhotos}
                disabled={isWorking || hasUploadActivity}
                title="Add more photos"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Add
              </button>
            )}

            {/* Albums drawer trigger */}
            <button className={styles.iconBtn} onClick={() => setDrawerOpen(true)} title="Albums">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
            </button>

            <button className={styles.iconBtn} onClick={onSignOut} title="Sign out">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Sort+Group selector */}
        {!activeAlbum && (
          <div className={styles.sortRow}>
            {SORT_GROUP_OPTIONS.map(opt => (
              <button
                key={opt.key}
                className={`${styles.sortBtn} ${sortGroup === opt.key ? styles.sortBtnActive : ''}`}
                onClick={() => setSortGroup(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </header>

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
            <h2 className={styles.emptyTitle}>No photos selected</h2>
            <p className={styles.emptySub}>Choose photos from your Google Photos library to start curating.</p>
            <motion.button className={styles.primaryBtn} onClick={onPickPhotos} whileTap={{ scale:0.96 }}>
              Select Photos to Curate
            </motion.button>
          </div>
        )}

        {hasItems && groupsWithIndex.length === 0 && activeAlbum && (
          <div className={styles.emptyState}>
            <p className={styles.emptySub}>No photos in this album yet.</p>
            <button className={styles.secondaryBtn} onClick={() => setActiveAlbum(null)}>Back to all photos</button>
          </div>
        )}

        {groupsWithIndex.map(({ key, label, items: groupItems, startIndex }) => (
          <section key={key} className={styles.group}>
            <h2 className={styles.dateLabel}>{label}</h2>
            <div className={styles.grid}>
              {groupItems.map((item, i) => (
                <GridThumb key={item.id} item={item} index={startIndex + i} onOpen={openSwipe} />
              ))}
            </div>
          </section>
        ))}

        {/* Deleted from Google Photos */}
        {!activeAlbum && deletedItems.length > 0 && (
          <section className={styles.group}>
            <h2 className={styles.dateLabel} style={{ color: 'var(--text-3)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Deleted from Google Photos
            </h2>
            <div className={styles.grid}>
              {deletedItems.map(item => (
                <DeletedThumb key={item.id} item={item} />
              ))}
            </div>
          </section>
        )}

        {/* Clear Session — bottom of scroll, double-confirmation */}
        {hasItems && !activeAlbum && (
          <div className={styles.bottomActions}>
            <AnimatePresence mode="wait">
              {clearPending ? (
                <motion.button
                  key="confirm"
                  className={styles.dangerBtnConfirm}
                  onClick={handleClearSession}
                  disabled={isWorking}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                >
                  ⚠ Tap again to confirm — this cannot be undone
                </motion.button>
              ) : (
                <motion.button
                  key="clear"
                  className={styles.dangerBtn}
                  onClick={handleClearSession}
                  disabled={isWorking}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  Clear Session
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        )}

        <div style={{ height: 1 }}/>
      </div>

      {hasItems && (
        <motion.button className={styles.fab}
          onClick={() => { setCurrentIndex(0); setView('swipe') }}
          initial={{ scale:0 }} animate={{ scale:1 }} whileTap={{ scale:0.92 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
          Swipe
        </motion.button>
      )}

      <AlbumDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSelectAlbum={(key) => { setActiveAlbum(key); setSortGroup('album') }}
      />
    </div>
  )
}

function GridThumb({ item, index, onOpen }) {
  const src      = useAuthedMediaItemUrl(item.id, IMG_SIZES.thumb)
  const decision = useAppStore(s => s.swipeDecisions[item.id] || item.swipeDecision)
  return (
    <motion.button className={styles.thumb} onClick={() => onOpen(index)} whileTap={{ scale:0.95, opacity:0.8 }} transition={{ duration:0.1 }}>
      {src
        ? <img src={src} alt={item.filename || ''} className={styles.thumbImg} loading="lazy" onError={(e) => { e.target.style.opacity='0.3' }}/>
        : <div className={styles.thumbImg} style={{ background:'var(--bg-3)' }}/>}
      {item.isLivePhoto && (
        <div className={styles.livePhotoBadge} title="Live Photo">◎</div>
      )}
      {item.mediaMetadata?.video && <div className={styles.videoIcon}>▶</div>}
      <AlbumDot decision={decision} />
    </motion.button>
  )
}

function DeletedThumb({ item }) {
  const src = useAuthedMediaItemUrl(item.id, IMG_SIZES.thumb)
  return (
    <div className={styles.thumb} style={{ cursor: 'default', opacity: 0.6, position: 'relative' }}>
      {src
        ? <img src={src} alt={item.filename || ''} className={styles.thumbImg} loading="lazy" onError={(e) => { e.target.style.opacity='0.3' }}/>
        : <div className={styles.thumbImg} style={{ background:'var(--bg-3)' }}/>}
      <div style={{ position:'absolute', bottom:4, right:4, fontSize:12, lineHeight:1, background:'rgba(0,0,0,0.55)', borderRadius:4, padding:'2px 3px' }}>🗑</div>
    </div>
  )
}
