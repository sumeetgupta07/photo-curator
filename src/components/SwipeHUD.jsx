// SwipeHUD.jsx — v2.9
// PURPOSE: Top/bottom HUD overlay for swipe view.
// Changelog:
//   v2.9: Added keyboard shortcut guide overlay (§2.4 #18).
//         ? button in top-right opens/closes the guide.
//         Guide shows Q/D/Arrow key mappings.
//   v2.0 Stage 3: initial version

import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import styles from './SwipeHUD.module.css'

export default function SwipeHUD({
  current, total, onBack,
  onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown,
  hasPrev, writeError, pendingCount,
  showShortcuts, onToggleShortcuts,
}) {
  const [toast, setToast] = useState(null)
  function act(fn, msg, type) { fn(); setToast({ msg, type, key: Date.now() }); setTimeout(() => setToast(null), 900) }
  const progress = total > 0 ? (current / total) * 100 : 0

  return (
    <>
      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={onBack} aria-label="Back to gallery">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="15,18 9,12 15,6"/>
          </svg>
          Gallery
        </button>
        <div className={styles.progressWrap}>
          <div className={styles.progressBar}>
            <motion.div className={styles.progressFill}
              animate={{ width: `${progress}%` }}
              transition={{ type: 'spring', stiffness: 200, damping: 30 }}/>
          </div>
          <span className={styles.progressLabel}>{current} / {total}</span>
        </div>
        <div className={styles.badgeSlot}>
          <AnimatePresence>
            {pendingCount > 0 && (
              <motion.div className={styles.pendingBadge}
                initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0, opacity: 0 }}
                title={`${pendingCount} album write${pendingCount > 1 ? 's' : ''} pending`}>
                <span className={styles.pendingDot}/><span className={styles.pendingNum}>{pendingCount}</span>
              </motion.div>
            )}
          </AnimatePresence>
          {/* ? shortcut guide button */}
          <button
            className={styles.shortcutBtn}
            onClick={onToggleShortcuts}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            ?
          </button>
        </div>
      </div>

      {/* ── Write error banner ─────────────────────────────────────────── */}
      <AnimatePresence>
        {writeError && (
          <motion.div className={styles.errorBanner}
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            ⚠ {writeError} — retrying…
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Keyboard shortcut guide overlay (§2.4 #18) ────────────────── */}
      <AnimatePresence>
        {showShortcuts && (
          <motion.div
            className={styles.shortcutOverlay}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            onClick={onToggleShortcuts}
          >
            <motion.div className={styles.shortcutCard} onClick={e => e.stopPropagation()}>
              <div className={styles.shortcutTitle}>Keyboard Shortcuts</div>
              <div className={styles.shortcutList}>
                <ShortcutRow keys={['Q']}                    label="Good" color="var(--good)"/>
                <ShortcutRow keys={['D']}                    label="Bad"  color="var(--bad)"/>
                <ShortcutRow keys={['↑', '→']}              label="Skip"/>
                <ShortcutRow keys={['↓', '←']}              label="Previous"/>
                <ShortcutRow keys={['?']}                    label="Toggle this guide"/>
              </div>
              <button className={styles.shortcutClose} onClick={onToggleShortcuts}>Close</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Bottom action buttons ──────────────────────────────────────── */}
      <div className={styles.bottomBar}>
        <ActionBtn onClick={() => act(onSwipeDown, '← Back', 'back')} disabled={!hasPrev} label="Back" color="rgba(255,255,255,0.2)"
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15,18 9,12 15,6"/></svg>}/>
        <ActionBtn onClick={() => act(onSwipeLeft, '✕ Bad', 'bad')} label="Bad" color="var(--bad)" glow="var(--bad-glow)" large
          icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>}/>
        <ActionBtn onClick={() => act(onSwipeUp, '↑ Skip', 'skip')} label="Skip" color="rgba(255,255,255,0.35)"
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="5,12 12,5 19,12"/><line x1="12" y1="19" x2="12" y2="5"/></svg>}/>
        <ActionBtn onClick={() => act(onSwipeRight, '✓ Good', 'good')} label="Good" color="var(--good)" glow="var(--good-glow)" large
          icon={<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20,6 9,17 4,12"/></svg>}/>
      </div>

      {/* ── Toast ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {toast && (
          <motion.div key={toast.key} className={`${styles.toast} ${styles['toast_' + toast.type]}`}
            initial={{ opacity: 0, y: 24, scale: 0.88 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.9 }} transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}>
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function ActionBtn({ onClick, disabled, label, color, glow, icon, large }) {
  return (
    <motion.button
      className={`${styles.actionBtn} ${large ? styles.actionBtnLarge : ''}`}
      style={{ '--btn-color': color, '--btn-glow': glow || 'transparent' }}
      onClick={onClick} disabled={disabled} aria-label={label}
      whileTap={{ scale: 0.86 }} transition={{ duration: 0.08 }}>
      <span style={{ color }}>{icon}</span>
    </motion.button>
  )
}

function ShortcutRow({ keys, label, color }) {
  return (
    <div className={styles.shortcutRow}>
      <div className={styles.shortcutKeys}>
        {keys.map(k => <kbd key={k} className={styles.kbd}>{k}</kbd>)}
      </div>
      <span className={styles.shortcutLabel} style={color ? { color } : undefined}>{label}</span>
    </div>
  )
}
