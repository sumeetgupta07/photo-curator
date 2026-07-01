// App.jsx — v2.4
// PURPOSE: Root app shell — auth gate, view switcher, global overlay layer.
// v2.4: Added SessionMenu sheet. startNewSession + reloadFromBackend passed
//       from useMediaItems. clearAndReset removed — replaced by startNewSession.
// v2.3: QueueDrawer, ReauthBanner, DupeToast.

import React, { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAppStore } from './store/appStore.js'
import { useAuth } from './hooks/useAuth.js'
import { useMediaItems } from './hooks/useMediaItems.js'
import { getScopeStatus } from './lib/backendApi.js'
import LoginScreen from './components/LoginScreen.jsx'
import GridView from './components/GridView.jsx'
import SwipeView from './components/SwipeView.jsx'
import LoadingScreen from './components/LoadingScreen.jsx'
import DebugPanel from './components/DebugPanel.jsx'
import QueueDrawer from './components/QueueDrawer.jsx'
import SessionMenu from './components/SessionMenu.jsx'

function ReauthBanner({ onSignOut }) {
  const [show, setShow] = useState(false)
  const { authState } = useAppStore()
  useEffect(() => {
    if (authState !== 'authenticated') return
    getScopeStatus().then(d => { if (d?.needsReauth) setShow(true) }).catch(() => {})
  }, [authState])
  if (!show) return null
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10000,
        background: 'rgba(220,100,0,0.95)', backdropFilter: 'blur(8px)',
        padding: '10px 16px', display: 'flex', alignItems: 'center',
        gap: 10, fontSize: 13, color: '#fff',
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
      }}
    >
      <span style={{ flex: 1 }}>
        🔐 A new permission is needed to detect deleted photos. Please sign out and back in.
      </span>
      <button onClick={onSignOut} style={{ background: 'rgba(255,255,255,0.25)', border: 'none', borderRadius: 8, color: '#fff', padding: '5px 12px', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
        Sign out
      </button>
      <button onClick={() => setShow(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0 }} aria-label="Dismiss">×</button>
    </motion.div>
  )
}

function DupeToast() {
  const { dupeToast } = useAppStore()
  return (
    <AnimatePresence>
      {dupeToast.visible && (
        <motion.div
          key="dupe-toast"
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.25 }}
          style={{
            position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)', left: 16,
            background: 'rgba(30,30,30,0.85)', backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
            padding: '8px 14px', fontSize: 13, color: 'var(--text-2)',
            pointerEvents: 'none', zIndex: 9999,
          }}
        >
          {dupeToast.count} duplicate{dupeToast.count !== 1 ? 's' : ''} skipped
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default function App() {
  const { authState, view } = useAppStore()
  const { signIn, signOut } = useAuth()
  const {
    pickerState, startPickerSession, cancelPickerSession,
    startNewSession, reloadFromBackend,
  } = useMediaItems()

  const [sessionMenuOpen, setSessionMenuOpen] = useState(false)

  if (authState === 'loading') return <LoadingScreen />
  if (authState === 'unauthenticated') return <LoginScreen onSignIn={signIn} />

  return (
    <>
      <ReauthBanner onSignOut={signOut} />
      <AnimatePresence mode="wait">
        {view === 'grid' ? (
          <motion.div key="grid" initial={{ opacity:0, x:-20 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-20 }} transition={{ duration:0.25 }} style={{ height:'100%' }}>
            <GridView
              onSignOut={signOut}
              pickerState={pickerState}
              onPickPhotos={() => startPickerSession(false)}
              onAddMorePhotos={() => startPickerSession(true)}
              onStartNewSession={startNewSession}
              onOpenSessionMenu={() => setSessionMenuOpen(true)}
              onCancelPicker={cancelPickerSession}
            />
          </motion.div>
        ) : (
          <motion.div key="swipe" initial={{ opacity:0, scale:0.97 }} animate={{ opacity:1, scale:1 }} exit={{ opacity:0, scale:0.97 }} transition={{ duration:0.25 }} style={{ height:'100%' }}>
            <SwipeView />
          </motion.div>
        )}
      </AnimatePresence>

      <SessionMenu
        isOpen={sessionMenuOpen}
        onClose={() => setSessionMenuOpen(false)}
        onSessionSwitch={async () => {
          // Re-fetch active session's uploads into store after switch
          await reloadFromBackend()
        }}
      />

      <DupeToast />
      <QueueDrawer />
      <DebugPanel />
    </>
  )
}
