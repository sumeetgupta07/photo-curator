// SessionMenu.jsx — v1.0
// PURPOSE: Curation session management UI — shown as a bottom sheet/drawer
// from the grid header. Lets user:
//   - See all named sessions with photo counts + active indicator
//   - Switch to a previous session (full grid swap)
//   - Rename any session (inline edit)
//   - Start a New Session (saves current, creates fresh)
//   - Delete a non-active session (single confirm step)

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  getCurationSessions, startNewCurationSession,
  activateCurationSession, renameCurationSession,
  deleteCurationSession,
} from '../lib/backendApi.js'
import styles from './SessionMenu.module.css'

export default function SessionMenu({ isOpen, onClose, onSessionSwitch }) {
  const [sessions,  setSessions]  = useState([])
  const [activeId,  setActiveId]  = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [renamingId, setRenamingId] = useState(null)
  const [renameVal,  setRenameVal]  = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null) // session id pending delete
  const renameInputRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { sessions: list, active } = await getCurationSessions()
      setSessions(list)
      setActiveId(active?.id || null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (isOpen) load() }, [isOpen, load])

  useEffect(() => {
    if (renamingId && renameInputRef.current) renameInputRef.current.focus()
  }, [renamingId])

  async function handleSwitch(id) {
    if (id === activeId) return
    setLoading(true)
    try {
      await activateCurationSession(id)
      onSessionSwitch()   // parent reloads items from backend
      onClose()
    } catch (e) { setError(e.message); setLoading(false) }
  }

  async function handleStartNew() {
    setLoading(true)
    try {
      await startNewCurationSession()
      onSessionSwitch()
      onClose()
    } catch (e) { setError(e.message); setLoading(false) }
  }

  function beginRename(session) {
    setRenamingId(session.id)
    setRenameVal(session.name)
  }

  async function commitRename(id) {
    const name = renameVal.trim()
    if (!name) { setRenamingId(null); return }
    try {
      await renameCurationSession(id, name)
      setSessions(prev => prev.map(s => s.id === id ? { ...s, name } : s))
    } catch (e) { setError(e.message) }
    setRenamingId(null)
  }

  async function handleDelete(id) {
    if (confirmDelete !== id) { setConfirmDelete(id); return }
    setConfirmDelete(null)
    setLoading(true)
    try {
      await deleteCurationSession(id)
      setSessions(prev => prev.filter(s => s.id !== id))
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  function formatDate(unixSec) {
    return new Date(unixSec * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className={styles.backdrop}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {/* Sheet */}
          <motion.div
            className={styles.sheet}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            <div className={styles.handle}/>
            <div className={styles.sheetHeader}>
              <h2 className={styles.sheetTitle}>Sessions</h2>
              <button className={styles.newBtn} onClick={handleStartNew} disabled={loading}>
                + New Session
              </button>
            </div>

            {error && <div className={styles.errorMsg}>⚠ {error}</div>}

            <div className={styles.list}>
              {loading && sessions.length === 0 && (
                <div className={styles.emptyMsg}>Loading…</div>
              )}
              {!loading && sessions.length === 0 && (
                <div className={styles.emptyMsg}>No sessions yet.</div>
              )}

              {sessions.map(session => {
                const isActive  = session.id === activeId
                const isRenaming = renamingId === session.id
                const isConfirmingDelete = confirmDelete === session.id

                return (
                  <div
                    key={session.id}
                    className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
                  >
                    {/* Main tap area — switches session */}
                    <button
                      className={styles.rowMain}
                      onClick={() => handleSwitch(session.id)}
                      disabled={loading || isActive}
                    >
                      <div className={styles.rowLeft}>
                        {isActive && <span className={styles.activeDot}/>}
                        {isRenaming ? (
                          <input
                            ref={renameInputRef}
                            className={styles.renameInput}
                            value={renameVal}
                            onChange={e => setRenameVal(e.target.value)}
                            onBlur={() => commitRename(session.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitRename(session.id)
                              if (e.key === 'Escape') setRenamingId(null)
                              e.stopPropagation()
                            }}
                            onClick={e => e.stopPropagation()}
                          />
                        ) : (
                          <span className={styles.rowName}>{session.name}</span>
                        )}
                        <span className={styles.rowMeta}>
                          {session.photo_count} photo{session.photo_count !== 1 ? 's' : ''} · {formatDate(session.created_at)}
                        </span>
                      </div>
                      {isActive && <span className={styles.activeLabel}>Active</span>}
                    </button>

                    {/* Actions */}
                    <div className={styles.rowActions}>
                      <button
                        className={styles.actionBtn}
                        onClick={e => { e.stopPropagation(); beginRename(session) }}
                        title="Rename"
                        aria-label="Rename session"
                      >
                        ✎
                      </button>
                      {!isActive && (
                        <button
                          className={`${styles.actionBtn} ${isConfirmingDelete ? styles.actionBtnDanger : ''}`}
                          onClick={e => { e.stopPropagation(); handleDelete(session.id) }}
                          title={isConfirmingDelete ? 'Tap again to confirm delete' : 'Delete session'}
                          aria-label="Delete session"
                          disabled={loading}
                        >
                          {isConfirmingDelete ? '✓ Confirm' : '🗑'}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Confirm delete hint */}
            <AnimatePresence>
              {confirmDelete && (
                <motion.div
                  className={styles.deleteHint}
                  initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                >
                  This removes photos from curation only — not from Google Photos.
                  Tap Confirm to proceed.
                  <button className={styles.cancelBtn} onClick={() => setConfirmDelete(null)}>Cancel</button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className={styles.sheetFooter}/>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
