// AlbumDrawer.jsx — v2.3 (new file)
// PURPOSE: Slide-up drawer showing app-created albums (Good/Bad/Duplicates).
// Tapping an album closes the drawer and filters the gallery to that album.
// Shows cover photo thumbnail + name + count per album.

import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getAlbums } from '../lib/backendApi.js'
import { authedMediaItemUrl } from '../hooks/useAuthedImage.js'
import { IMG_SIZES } from '../lib/config.js'
import styles from './AlbumDrawer.module.css'

export default function AlbumDrawer({ open, onClose, onSelectAlbum }) {
  const [albums, setAlbums] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    getAlbums()
      .then(data => setAlbums(data))
      .catch(err => console.error('[AlbumDrawer] fetch failed:', err.message))
      .finally(() => setLoading(false))
  }, [open])

  function handleSelect(album) {
    onSelectAlbum(album.key)
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className={styles.backdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {/* Drawer */}
          <motion.div
            className={styles.drawer}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 36 }}
          >
            <div className={styles.handle} />
            <div className={styles.header}>
              <span className={styles.title}>Albums</span>
              <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
            </div>

            {loading && <div className={styles.loading}><span className={styles.spinner}/></div>}

            {!loading && (
              <div className={styles.list}>
                {albums.filter(a => a.count > 0).map(album => (
                  <button key={album.key} className={styles.albumRow} onClick={() => handleSelect(album)}>
                    <div className={styles.cover}>
                      {album.coverId
                        ? <img src={authedMediaItemUrl(album.coverId, IMG_SIZES.thumb)} alt="" className={styles.coverImg}/>
                        : <div className={styles.coverPlaceholder}/>}
                    </div>
                    <div className={styles.info}>
                      <span className={styles.albumName}>{album.label}</span>
                      <span className={styles.albumCount}>{album.count} photo{album.count !== 1 ? 's' : ''}</span>
                    </div>
                    <svg className={styles.chevron} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <polyline points="9,18 15,12 9,6"/>
                    </svg>
                  </button>
                ))}
                {albums.every(a => a.count === 0) && (
                  <p className={styles.empty}>No albums yet — start swiping to create them.</p>
                )}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
