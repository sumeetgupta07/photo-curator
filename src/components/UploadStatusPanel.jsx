// UploadStatusPanel.jsx — v2.0 Stage 2 (new file)
//
// PURPOSE: Shows live background re-upload queue status — per user
// request, this is QUEUE-LEVEL (counts), not per-file progress bars.
// Rendered whenever there's any non-terminal activity (pending/
// downloading/uploading) or any failures, regardless of pickerState —
// the upload pipeline runs in the background independently of the picker
// UI flow, so this needs its own visibility condition rather than being
// tied to pickerState the way the old picker status bar was.
import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import styles from './UploadStatusPanel.module.css'

export default function UploadStatusPanel({ status }) {
  const { pending = 0, downloading = 0, uploading = 0, done = 0, failed = 0 } = status || {}
  const inFlight = pending + downloading + uploading
  const total = inFlight + done + failed
  const visible = total > 0 && (inFlight > 0 || failed > 0)

  return (
    <AnimatePresence>
      {visible && (
        <motion.div className={styles.panel}
          initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
          <div className={styles.row}>
            {inFlight > 0 && (
              <span className={styles.item}>
                <span className={styles.spinner} />
                Uploading to Google Photos… {done}/{total} done
              </span>
            )}
            {inFlight === 0 && failed > 0 && (
              <span className={styles.item}>{done}/{total} done</span>
            )}
            {failed > 0 && (
              <span className={styles.failedBadge}>{failed} failed</span>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
