// AlbumDot.jsx — v2.2
// PURPOSE: Small coloured dot badge showing swipe decision for a photo.
// Shown bottom-right of grid thumbnails and swipe cards.
// good → green, bad → red, skip → grey, null → hidden.
import React from 'react'
import styles from './AlbumDot.module.css'

const COLORS = {
  good: 'var(--good)',
  bad:  'var(--bad)',
  skip: 'var(--text-3)',
}

export default function AlbumDot({ decision }) {
  if (!decision || decision === 'duplicate') return null
  const color = COLORS[decision]
  if (!color) return null
  return <span className={styles.dot} style={{ background: color }} title={decision} />
}
