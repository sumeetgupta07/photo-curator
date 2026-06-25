// GridView.jsx — v2.0 Stage 2
import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAppStore } from '../store/appStore.js'
import { groupByDate } from '../lib/api.js'
import { IMG_SIZES } from '../lib/config.js'
import { useAuthedMediaItemUrl } from '../hooks/useAuthedImage.js'
import UploadStatusPanel from './UploadStatusPanel.jsx'
import styles from './GridView.module.css'
const PICKER_LABELS = { idle:null, creating:'Opening picker…', waiting:'Waiting for you to finish selecting…', loading:'Loading selected photos…', uploading:'Starting background upload…', done:null }
export default function GridView({ onSignOut, pickerState, onPickPhotos, onAddMorePhotos, onClearSession, onCancelPicker }) {
  const { items, setView, setCurrentIndex, pickerError, uploadStatus } = useAppStore()
  const openSwipe = (index) => { setCurrentIndex(index); setView('swipe') }
  const statusMsg = PICKER_LABELS[pickerState]
  const hasItems = items.length > 0
  const isWorking = ['creating','waiting','loading','uploading'].includes(pickerState)
  const hasUploadActivity = (uploadStatus.pending + uploadStatus.downloading + uploadStatus.uploading) > 0
  const popupBlockedUrl = pickerError?.startsWith('POPUP_BLOCKED:') ? pickerError.replace('POPUP_BLOCKED:','') : null
  const groups = groupByDate(items)
  let runningIndex = 0
  const groupsWithIndex = groups.map(group => { const startIndex = runningIndex; runningIndex += group.items.length; return { ...group, startIndex } })
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <h1 className={styles.logo}>Photo <em>Curator</em></h1>
          <div className={styles.headerActions}>
            {hasItems && <span className={styles.count}>{items.length} photos</span>}
            <button className={styles.iconBtn} onClick={onSignOut} title="Sign out">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            </button>
          </div>
        </div>
      </header>
      <AnimatePresence>
        {(statusMsg || popupBlockedUrl) && (
          <motion.div className={styles.statusBar} initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }} exit={{ opacity:0, height:0 }}>
            {popupBlockedUrl ? (
              <span>Popup blocked. <a href={popupBlockedUrl} target="_blank" rel="noreferrer" className={styles.statusLink}>Open picker manually ↗</a></span>
            ) : (
              <span><span className={styles.statusSpinner}/> {statusMsg}
                {pickerState === 'waiting' && <button type="button" onClick={onCancelPicker} className={styles.statusLink} style={{ marginLeft:12, background:'none', border:'none', cursor:'pointer', textDecoration:'underline', font:'inherit', padding:0 }}>Cancel</button>}
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
            <motion.button className={styles.primaryBtn} onClick={onPickPhotos} whileTap={{ scale:0.96 }}>Select Photos to Curate</motion.button>
          </div>
        )}
        {hasItems && (
          <>
            {groupsWithIndex.map(({ date, label, items:groupItems, startIndex }) => (
              <section key={date} className={styles.group}>
                <h2 className={styles.dateLabel}>{label}</h2>
                <div className={styles.grid}>
                  {groupItems.map((item, i) => <GridThumb key={item.id} item={item} index={startIndex+i} onOpen={openSwipe}/>)}
                </div>
              </section>
            ))}
            <div className={styles.bottomActions}>
              <button className={styles.secondaryBtn} onClick={onAddMorePhotos} disabled={isWorking}>+ Add More Photos</button>
              <button className={styles.dangerBtn} onClick={onClearSession} disabled={isWorking}>Clear Session</button>
            </div>
          </>
        )}
        <div style={{ height:1 }}/>
      </div>
      {hasItems && (
        <motion.button className={styles.fab} onClick={() => { setCurrentIndex(0); setView('swipe') }} initial={{ scale:0 }} animate={{ scale:1 }} whileTap={{ scale:0.92 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          Swipe
        </motion.button>
      )}
    </div>
  )
}
function GridThumb({ item, index, onOpen }) {
  // v2.1: item.id is the numeric uploadId, used as the thumb URL key
  const src = useAuthedMediaItemUrl(item.id, IMG_SIZES.thumb)
  return (
    <motion.button className={styles.thumb} onClick={() => onOpen(index)} whileTap={{ scale:0.95, opacity:0.8 }} transition={{ duration:0.1 }}>
      {src ? <img src={src} alt={item.filename || ''} className={styles.thumbImg} loading="lazy" onError={(e) => { e.target.style.opacity='0.3' }}/> : <div className={styles.thumbImg} style={{ background:'var(--bg-3)' }}/>}
      {item.mediaMetadata?.video && <div className={styles.videoIcon}>▶</div>}
    </motion.button>
  )
}
