// QueueDrawer.jsx — v1.0
// PURPOSE: Floating drawer showing per-item upload/download queue progress.
// Triggered by a floating action button (bottom-right).
// - done items are removed after 2s (handled in useMediaItems)
// - failed items persist until new session or logout
// - visible in both grid and swipe views

import React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from '../store/appStore.js'

const STATUS_ICON = {
  pending:     { icon: '⏳', label: 'Pending',     color: 'var(--text-3)' },
  downloading: { icon: '⬇️', label: 'Downloading', color: '#4a9eff' },
  uploading:   { icon: '⬆️', label: 'Uploading',   color: '#a78bfa' },
  done:        { icon: '✓',  label: 'Done',         color: '#4ade80' },
  failed:      { icon: '✕',  label: 'Failed',       color: '#f87171' },
}

function QueueItem({ item }) {
  const meta = STATUS_ICON[item.status] || STATUS_ICON.pending
  const isActive = item.status === 'downloading' || item.status === 'uploading'
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      {/* Status icon / spinner */}
      <div style={{ width: 22, textAlign: 'center', flexShrink: 0 }}>
        {isActive ? (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            style={{
              width: 14, height: 14, borderRadius: '50%', margin: '0 auto',
              border: `2px solid ${meta.color}`,
              borderTopColor: 'transparent',
            }}
          />
        ) : (
          <span style={{ fontSize: 13, color: meta.color, fontWeight: 600 }}>
            {meta.icon}
          </span>
        )}
      </div>

      {/* Filename */}
      <span style={{
        flex: 1, fontSize: 12, color: 'var(--text)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {item.filename || `item #${item.id}`}
      </span>

      {/* Status label */}
      <span style={{ fontSize: 11, color: meta.color, flexShrink: 0, fontWeight: 500 }}>
        {meta.label}
      </span>
    </motion.div>
  )
}

export default function QueueDrawer() {
  const { queueItems, queueOpen, setQueueOpen } = useAppStore()

  const activeCount = (queueItems || []).filter(
    i => i.status === 'downloading' || i.status === 'uploading' || i.status === 'pending'
  ).length
  const failedCount = (queueItems || []).filter(i => i.status === 'failed').length
  const hasItems    = (queueItems || []).length > 0

  // Don't render the FAB at all if there's nothing to show
  if (!hasItems) return null

  const badgeCount = activeCount || failedCount

  return (
    <>
      {/* Floating action button */}
      <motion.button
        onClick={() => setQueueOpen(!queueOpen)}
        whileTap={{ scale: 0.92 }}
        style={{
          position: 'fixed',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 90px)',
          right: 16,
          width: 48, height: 48, borderRadius: '50%',
          background: queueOpen ? 'var(--accent)' : 'rgba(40,40,40,0.92)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', zIndex: 8000, fontSize: 18,
          color: '#fff',
        }}
        aria-label={queueOpen ? 'Hide upload queue' : 'Show upload queue'}
      >
        {queueOpen ? '✕' : '☁'}
        {!queueOpen && badgeCount > 0 && (
          <span style={{
            position: 'absolute', top: 4, right: 4,
            background: failedCount ? '#f87171' : '#4a9eff',
            color: '#fff', borderRadius: 99, fontSize: 9, fontWeight: 700,
            minWidth: 14, height: 14, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: '0 3px',
            border: '1.5px solid rgba(0,0,0,0.5)',
          }}>
            {badgeCount}
          </span>
        )}
      </motion.button>

      {/* Drawer */}
      <AnimatePresence>
        {queueOpen && (
          <motion.div
            key="queue-drawer"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            style={{
              position: 'fixed',
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 150px)',
              right: 12, left: 12,
              maxHeight: '40vh',
              background: 'rgba(22,22,26,0.96)',
              backdropFilter: 'blur(20px)',
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              zIndex: 7999,
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '10px 14px 8px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', letterSpacing: '0.04em' }}>
                UPLOAD QUEUE
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-2)' }}>
                {activeCount > 0 && `${activeCount} active`}
                {activeCount > 0 && failedCount > 0 && ' · '}
                {failedCount > 0 && <span style={{ color: '#f87171' }}>{failedCount} failed</span>}
              </span>
            </div>

            {/* Scrollable list */}
            <div style={{ overflowY: 'auto', padding: '0 14px', flex: 1 }}>
              <AnimatePresence mode="popLayout">
                {(queueItems || []).map(item => (
                  <QueueItem key={item.id} item={item} />
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
