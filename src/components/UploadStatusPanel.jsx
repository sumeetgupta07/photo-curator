// UploadStatusPanel.jsx — v2.0 Stage 2
import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import styles from './UploadStatusPanel.module.css'
export default function UploadStatusPanel({ status }) {
  const { pending=0, downloading=0, uploading=0, done=0, failed=0 } = status || {}
  const inFlight = pending + downloading + uploading
  const total = inFlight + done + failed
  const visible = total > 0 && (inFlight > 0 || failed > 0)
  return (
    <AnimatePresence>
      {visible && (
        <motion.div className={styles.panel} initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }} exit={{ opacity:0, height:0 }}>
          <div className={styles.row}>
            {inFlight > 0 && <span className={styles.item}><span className={styles.spinner} />Uploading to Google Photos… {done}/{total} done</span>}
            {inFlight === 0 && failed > 0 && <span className={styles.item}>{done}/{total} done</span>}
            {failed > 0 && <span className={styles.failedBadge}>{failed} failed</span>}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
