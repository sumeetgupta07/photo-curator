// BandwidthMeter.jsx — v1.0
// PURPOSE: Shows bytes uploaded today vs the 15 GB daily soft cap.
// Reads bandwidthToday from appStore (session-persisted, resets at midnight).
// Shows a warning bar when >80% consumed, red when >95%.
// Hidden when no uploads have occurred today.

import React from 'react'
import { useAppStore } from '../store/appStore.js'
import styles from './BandwidthMeter.module.css'

const DAILY_CAP_BYTES = 15 * 1024 * 1024 * 1024 // 15 GB

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export default function BandwidthMeter() {
  const bandwidthToday = useAppStore(s => s.bandwidthToday)
  if (bandwidthToday === 0) return null

  const pct     = Math.min(bandwidthToday / DAILY_CAP_BYTES, 1)
  const pctDisp = Math.round(pct * 100)
  const isWarn  = pct >= 0.8
  const isDanger = pct >= 0.95

  return (
    <div className={`${styles.root} ${isWarn ? styles.warn : ''} ${isDanger ? styles.danger : ''}`}>
      <div className={styles.row}>
        <span className={styles.label}>
          {isDanger ? '⚠ Near daily limit' : isWarn ? '⚠ Bandwidth high' : 'Uploaded today'}
        </span>
        <span className={styles.value}>{formatBytes(bandwidthToday)} / 15 GB ({pctDisp}%)</span>
      </div>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${pct * 100}%` }}/>
      </div>
    </div>
  )
}
